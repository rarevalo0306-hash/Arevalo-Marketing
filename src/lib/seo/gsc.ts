// Google Search Console ("Tus búsquedas en Google"): con qué búsquedas aparece la página del negocio,
// cuántos clics e impresiones recibe, su CTR y su posición promedio. Datos reales de Google, gratis.
import { decryptJson, encryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { googleAccess } from "@/lib/google-oauth";
import { bi, type T } from "@/lib/i18n";
import { fetchJson } from "@/lib/publishers/http";
import { saveReport } from "@/lib/seo/reports";

/** Cookie cifrada (15 minutos) con el permiso y la lista de sitios cuando hay que elegir uno. */
export const GSC_COOKIE = "am_gsc";
export const GSC_CHANNEL = "gsc";

export type GscSite = { siteUrl: string; permissionLevel: string };
export type GscPending = { refreshToken: string; businessId: string; sites: string[] };

export type GscRow = { key: string; clicks: number; impressions: number; ctr: number; position: number };
export type GscTotals = { clicks: number; impressions: number; ctr: number; position: number };
export type GscRange = { start: string; end: string };

/** Lo que se guarda en SeoReport.data (kind "gsc"). ctr va de 0 a 1, como lo entrega Google. */
export type GscReport = {
  version: 1;
  siteUrl: string;
  fetchedAt: string;
  range: GscRange;
  previousRange: GscRange;
  totals: GscTotals;
  previous: GscTotals;
  /** Las 50 búsquedas con más clics. */
  queries: GscRow[];
  /** Las 20 páginas con más clics. */
  pages: GscRow[];
  devices: GscRow[];
  /** Los 5 países con más clics (código ISO de 3 letras, en minúsculas). */
  countries: GscRow[];
  /** Casi en la primera página: posición 4–20 y al menos 20 impresiones. */
  opportunities: GscRow[];
  /** Arriba (posición ≤ 5) pero casi nadie hace clic (CTR < 2 %). */
  lowCtr: GscRow[];
};

// ---------- Elegir el sitio que corresponde a la página del negocio ----------

/** El dominio de la página web del negocio, sin "www." ni protocolo. */
export function siteHost(website: string): string | null {
  const w = website.trim();
  if (!w) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(w) ? w : `https://${w}`);
    return u.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/**
 * La propiedad de Search Console que corresponde a la página del negocio, o null.
 * Primero una propiedad de dominio (sc-domain:, cubre http/https, www y subdominios);
 * si no, una de prefijo de URL del mismo dominio (prefiere la raíz, https y el mismo www que la página).
 */
export function matchSite(website: string, sites: string[]): string | null {
  const host = siteHost(website);
  if (!host) return null;
  const w = website.trim();
  let wantsWww = false;
  let path = "/";
  try {
    const u = new URL(/^https?:\/\//i.test(w) ? w : `https://${w}`);
    wantsWww = u.hostname.toLowerCase().startsWith("www.");
    path = u.pathname || "/";
  } catch {
    // siteHost ya validó la dirección
  }

  const domains = sites
    .filter((s) => s.toLowerCase().startsWith("sc-domain:"))
    .map((s) => ({ s, d: s.slice("sc-domain:".length).toLowerCase().replace(/^www\./, "") }));
  const exact = domains.find((x) => x.d === host);
  if (exact) return exact.s;
  const parent = domains.filter((x) => host.endsWith(`.${x.d}`)).sort((a, b) => b.d.length - a.d.length)[0];
  if (parent) return parent.s;

  const prefixes = sites
    .filter((s) => /^https?:\/\//i.test(s))
    .flatMap((s) => {
      try {
        const u = new URL(s);
        const h = u.hostname.toLowerCase();
        if (h.replace(/^www\./, "") !== host) return [];
        const p = u.pathname || "/";
        if (p !== "/" && !path.startsWith(p)) return [];
        // Menor puntaje = mejor.
        const score = (p === "/" ? 0 : 4) + (u.protocol === "https:" ? 0 : 2) + (h.startsWith("www.") === wantsWww ? 0 : 1);
        return [{ s, score }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.score - b.score);
  return prefixes[0]?.s ?? null;
}

/** Los sitios de Search Console que la cuenta puede ver (sin los que no están verificados). */
export async function listGscSites(accessToken: string): Promise<string[]> {
  const r = await fetchJson<{ siteEntry?: GscSite[] }>("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return (r.siteEntry ?? []).filter((s) => s.siteUrl && s.permissionLevel !== "siteUnverifiedUser").map((s) => s.siteUrl);
}

/** Guarda la conexión con el sitio elegido. */
export async function saveGscSite(businessId: string, refreshToken: string, siteUrl: string) {
  const secret = encryptJson({ refreshToken, siteUrl });
  await db.connection.upsert({
    where: { businessId_channel: { businessId, channel: GSC_CHANNEL } },
    create: { businessId, channel: GSC_CHANNEL, secret, label: siteUrl },
    update: { secret, label: siteUrl },
  });
}

/** Cómo se ve el sitio para una persona: "ejemplo.com (todo el dominio)" o la dirección tal cual. */
export const siteLabel = (siteUrl: string, t: T) =>
  siteUrl.startsWith("sc-domain:") ? t(`${siteUrl.slice(10)} (todo el dominio)`, `${siteUrl.slice(10)} (whole domain)`) : siteUrl;

// ---------- Oportunidades (puro) ----------

/** Búsquedas casi en la primera página de Google (posición 4–20, ≥ 20 impresiones), de más a menos impresiones. */
export function findOpportunities(rows: GscRow[], limit = 10): GscRow[] {
  return rows
    .filter((r) => r.position >= 4 && r.position <= 20 && r.impressions >= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

/** Búsquedas donde sales arriba (posición ≤ 5) pero el CTR es menor a 2 % (≥ 20 impresiones para que cuente). */
export function findLowCtr(rows: GscRow[], limit = 10): GscRow[] {
  return rows
    .filter((r) => r.position > 0 && r.position <= 5 && r.ctr < 0.02 && r.impressions >= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

// ---------- Fechas ----------

const day = (d: Date) => d.toISOString().slice(0, 10);
const minusDays = (d: Date, n: number) => new Date(d.getTime() - n * 86_400_000);

/** Últimos 28 días terminando hace 3 días (Search Console tarda en tener los datos) y los 28 días anteriores. */
export function gscRanges(now = new Date()): { range: GscRange; previousRange: GscRange } {
  const end = minusDays(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), 3);
  const start = minusDays(end, 27);
  const prevEnd = minusDays(start, 1);
  const prevStart = minusDays(prevEnd, 27);
  return { range: { start: day(start), end: day(end) }, previousRange: { start: day(prevStart), end: day(prevEnd) } };
}

// ---------- Leer datos de Google ----------

type ApiRow = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function toRow(r: ApiRow): GscRow {
  return { key: String(r.keys?.[0] ?? ""), clicks: num(r.clicks), impressions: num(r.impressions), ctr: num(r.ctr), position: num(r.position) };
}

const totalsOf = (rows: ApiRow[]): GscTotals => {
  const { clicks, impressions, ctr, position } = toRow(rows[0] ?? {});
  return { clicks, impressions, ctr, position };
};

async function query(accessToken: string, siteUrl: string, range: GscRange, dimensions: string[], rowLimit: number): Promise<ApiRow[]> {
  const r = await fetchJson<{ rows?: ApiRow[] }>(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: range.start, endDate: range.end, dimensions, rowLimit, type: "web" }),
    },
  );
  return r.rows ?? [];
}

/** Arma el reporte completo con la conexión guardada (fila Connection con channel "gsc"). */
export async function searchConsoleReport(conn: { secret: string }, now = new Date()): Promise<GscReport> {
  let creds: { refreshToken?: string; siteUrl?: string };
  try {
    creds = decryptJson<{ refreshToken?: string; siteUrl?: string }>(conn.secret);
  } catch {
    throw bi("No se pudo leer la conexión con Search Console. Vuelve a conectarla.", "Couldn't read the Search Console connection. Please connect it again.");
  }
  if (!creds.refreshToken || !creds.siteUrl)
    throw bi("A la conexión con Search Console le faltan datos. Vuelve a conectarla.", "The Search Console connection is missing data. Please connect it again.");
  const siteUrl = creds.siteUrl;
  const token = await googleAccess(creds.refreshToken);
  const { range, previousRange } = gscRanges(now);
  const [totals, previous, queries, pages, devices, countries] = await Promise.all([
    query(token, siteUrl, range, [], 1),
    query(token, siteUrl, previousRange, [], 1),
    // Se piden más búsquedas de las que se muestran para encontrar oportunidades con pocos clics.
    query(token, siteUrl, range, ["query"], 250),
    query(token, siteUrl, range, ["page"], 20),
    query(token, siteUrl, range, ["device"], 5),
    query(token, siteUrl, range, ["country"], 5),
  ]);
  const allQueries = queries.map(toRow);
  return {
    version: 1,
    siteUrl,
    fetchedAt: now.toISOString(),
    range,
    previousRange,
    totals: totalsOf(totals),
    previous: totalsOf(previous),
    queries: allQueries.slice(0, 50),
    pages: pages.map(toRow),
    devices: devices.map(toRow),
    countries: countries.map(toRow),
    opportunities: findOpportunities(allQueries),
    lowCtr: findLowCtr(allQueries),
  };
}

/** Primeros datos justo después de conectar; si fallan, el botón "Actualizar datos" muestra el motivo. */
export async function tryFirstGscReport(businessId: string) {
  try {
    const conn = await db.connection.findUnique({ where: { businessId_channel: { businessId, channel: GSC_CHANNEL } } });
    if (conn) await saveReport(businessId, "gsc", await searchConsoleReport(conn));
  } catch {
    // se reintenta desde el panel
  }
}

// ---------- Leer reportes guardados (con cuidado: pueden venir de versiones viejas) ----------

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const rowsOf = (v: unknown): GscRow[] =>
  Array.isArray(v)
    ? v.map(obj).map((r) => ({ key: String(r.key ?? ""), clicks: num(r.clicks), impressions: num(r.impressions), ctr: num(r.ctr), position: num(r.position) }))
    : [];
const totalsFrom = (v: unknown): GscTotals => {
  const o = obj(v);
  return { clicks: num(o.clicks), impressions: num(o.impressions), ctr: num(o.ctr), position: num(o.position) };
};
const rangeOf = (v: unknown): GscRange => {
  const o = obj(v);
  return { start: String(o.start ?? ""), end: String(o.end ?? "") };
};

/** Un reporte guardado, normalizado; null si no parece un reporte de Search Console. */
export function asGscReport(data: unknown): GscReport | null {
  const o = obj(data);
  if (!("totals" in o)) return null;
  return {
    version: 1,
    siteUrl: String(o.siteUrl ?? ""),
    fetchedAt: String(o.fetchedAt ?? ""),
    range: rangeOf(o.range),
    previousRange: rangeOf(o.previousRange),
    totals: totalsFrom(o.totals),
    previous: totalsFrom(o.previous),
    queries: rowsOf(o.queries),
    pages: rowsOf(o.pages),
    devices: rowsOf(o.devices),
    countries: rowsOf(o.countries),
    opportunities: rowsOf(o.opportunities),
    lowCtr: rowsOf(o.lowCtr),
  };
}

// ---------- Errores comunes, en palabras claras ----------

export function explainGscError(msg: string, t: T): string {
  if (/invalid_grant|expired or revoked/i.test(msg))
    return t(
      "El permiso de Google venció o se quitó. Desconecta y vuelve a conectar Search Console. (Si tu app de Google está en modo de prueba, Google vence el permiso cada 7 días.)",
      "Google access expired or was revoked. Disconnect and connect Search Console again. (If your Google app is in testing mode, Google expires access every 7 days.)",
    );
  if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(msg))
    return t(
      "Activa la Google Search Console API en Google Cloud (en el mismo proyecto de GOOGLE_CLIENT_ID), espera unos minutos y vuelve a intentarlo.",
      "Turn on the Google Search Console API in Google Cloud (in the same project as GOOGLE_CLIENT_ID), wait a few minutes and try again.",
    );
  if (/insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/i.test(msg))
    return t(
      "No diste el permiso para ver Search Console. Vuelve a conectar y marca la casilla de Search Console.",
      "You didn't grant permission to view Search Console. Connect again and check the Search Console box.",
    );
  if (/^403|PERMISSION_DENIED|forbidden|sufficient permission/i.test(msg))
    return t(
      "Esa cuenta de Google no tiene acceso a esta página en Search Console. Entra con la cuenta que la verificó o pide que te agreguen como usuario.",
      "That Google account doesn't have access to this site in Search Console. Sign in with the account that verified it, or ask to be added as a user.",
    );
  if (/quota|RATE_LIMIT|^429/i.test(msg))
    return t("Google limitó las consultas por ahora. Intenta de nuevo en unos minutos.", "Google is limiting requests right now. Try again in a few minutes.");
  return t(`Google respondió: ${msg}`, `Google responded: ${msg}`);
}
