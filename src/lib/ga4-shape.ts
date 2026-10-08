// Google Analytics 4 («Visitas a tu página»): la forma del reporte guardado (SeoReport kind "ga4") y cómo se leen las
// respuestas de Google (Admin API: accountSummaries / dataStreams / keyEvents; Data API: runReport). PURO: sin red ni
// base de datos, se prueba en tests/ga4.test.ts. Quien llama a Google y guarda es src/lib/ga4.ts.

export const GA4_CHANNEL = "ga4";

/** Una propiedad de GA4 que la cuenta de Google puede ver. `id` = solo el número ("123456789"). */
export type Ga4Property = {
  id: string;
  name: string;
  account: string;
  /** Direcciones de sus flujos web (ej. "https://fameseg.com"), si se pudieron leer. */
  urls: string[];
};

/** Lo que se guarda cifrado en Connection.secret (channel "ga4"). */
export type Ga4Secret = {
  refreshToken: string;
  /** La propiedad elegida (vacío = todavía hay que elegir). */
  propertyId?: string;
  propertyName?: string;
  /** Las propiedades que se encontraron al conectar (para elegir o cambiar sin volver a conectar). */
  properties?: Ga4Property[];
  /** Último intento automático que falló (para no repetirlo en cada visita) y su motivo. */
  lastTryAt?: string;
  lastError?: string;
};

export type Ga4Range = { start: string; end: string };

export type Ga4Totals = {
  users: number;
  newUsers: number;
  sessions: number;
  engagedSessions: number;
  /** 0 a 1, como lo entrega Google. */
  engagementRate: number;
  /** Tiempo de interacción promedio por persona, en segundos. */
  avgEngagementSec: number;
  keyEvents: number;
  pageViews: number;
};

/** Una fila con su valor actual y el de los 28 días anteriores. */
export type Ga4Row = { key: string; sessions: number; prevSessions: number; engagedSessions: number; keyEvents: number };
export type Ga4Landing = { key: string; sessions: number; engagementRate: number; keyEvents: number; avgEngagementSec: number };
export type Ga4Place = { key: string; country: string; sessions: number };
export type Ga4Event = { key: string; count: number; prevCount: number };
export type Ga4Day = { date: string; sessions: number };

/** Lo que se guarda en SeoReport.data (kind "ga4"). */
export type Ga4Report = {
  version: 1;
  propertyId: string;
  propertyName: string;
  fetchedAt: string;
  timeZone: string;
  range: Ga4Range;
  previousRange: Ga4Range;
  totals: Ga4Totals;
  previous: Ga4Totals;
  /** De dónde llegan (sessionDefaultChannelGroup), de más a menos visitas. */
  channels: Ga4Row[];
  /** Las páginas por donde entran (las 15 con más visitas). */
  landingPages: Ga4Landing[];
  cities: Ga4Place[];
  countries: Ga4Place[];
  devices: Ga4Row[];
  /** Acciones importantes (key events) que pasaron, por nombre. */
  keyEvents: Ga4Event[];
  /** Los nombres de las acciones importantes configuradas en GA4 (null = no se pudo leer). */
  keyEventsConfigured: string[] | null;
  /** Visitas desde Google (búsqueda gratis) por día, los 28 días (con ceros). */
  organicTrend: Ga4Day[];
};

// ---------- Fechas ----------

const day = (d: Date) => d.toISOString().slice(0, 10);
const minusDays = (d: Date, n: number) => new Date(d.getTime() - n * 86_400_000);

/** Los últimos 28 días completos (hasta ayer) y los 28 días anteriores. */
export function ga4Ranges(now = new Date()): { range: Ga4Range; previousRange: Ga4Range } {
  const end = minusDays(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), 1);
  const start = minusDays(end, 27);
  const prevEnd = minusDays(start, 1);
  const prevStart = minusDays(prevEnd, 27);
  return { range: { start: day(start), end: day(end) }, previousRange: { start: day(prevStart), end: day(prevEnd) } };
}

/** Todos los días de un rango ("YYYY-MM-DD"). */
export function daysOf(range: Ga4Range): string[] {
  const out: string[] = [];
  const start = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  for (let d = start; d <= end && out.length < 400; d = new Date(d.getTime() + 86_400_000)) out.push(day(d));
  return out;
}

// ---------- Elegir la propiedad ----------

export type AccountSummariesResponse = {
  accountSummaries?: {
    account?: string;
    displayName?: string;
    propertySummaries?: { property?: string; displayName?: string; propertyType?: string }[];
  }[];
  nextPageToken?: string;
};

/** Las propiedades de GA4 de la respuesta de accountSummaries.list (sin las de prueba ni las repetidas). */
export function parseAccountSummaries(r: AccountSummariesResponse): Ga4Property[] {
  const out: Ga4Property[] = [];
  const seen = new Set<string>();
  for (const a of r.accountSummaries ?? [])
    for (const p of a.propertySummaries ?? []) {
      const id = String(p.property ?? "").replace(/^properties\//, "");
      if (!/^\d+$/.test(id) || seen.has(id)) continue;
      if (p.propertyType && p.propertyType !== "PROPERTY_TYPE_ORDINARY") continue;
      seen.add(id);
      out.push({ id, name: String(p.displayName ?? "").trim() || id, account: String(a.displayName ?? "").trim(), urls: [] });
    }
  return out;
}

export type DataStreamsResponse = { dataStreams?: { type?: string; webStreamData?: { defaultUri?: string } }[] };

/** Las direcciones de los flujos web de una propiedad. */
export function parseDataStreams(r: DataStreamsResponse): string[] {
  return (r.dataStreams ?? []).map((s) => String(s.webStreamData?.defaultUri ?? "").trim()).filter(Boolean);
}

export type KeyEventsResponse = { keyEvents?: { eventName?: string }[] };

export function parseKeyEventsList(r: KeyEventsResponse): string[] {
  return [...new Set((r.keyEvents ?? []).map((k) => String(k.eventName ?? "").trim()).filter(Boolean))];
}

/** El dominio sin "www." ni protocolo (null si no se entiende). */
export function hostOf(url: string): string | null {
  const w = url.trim();
  if (!w) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(w) ? w : `https://${w}`);
    return u.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** La propiedad cuyo flujo web es la página del negocio (mismo dominio o subdominio), o null. */
export function suggestProperty(website: string, props: Ga4Property[]): Ga4Property | null {
  const host = hostOf(website);
  if (!host) return null;
  const score = (p: Ga4Property) => {
    let best = 0;
    for (const u of p.urls) {
      const h = hostOf(u);
      if (!h) continue;
      if (h === host) best = Math.max(best, 2);
      else if (h.endsWith(`.${host}`) || host.endsWith(`.${h}`)) best = Math.max(best, 1);
    }
    return best;
  };
  const ranked = props.map((p) => ({ p, s: score(p) })).filter((x) => x.s > 0);
  if (!ranked.length) return null;
  const top = Math.max(...ranked.map((x) => x.s));
  const winners = ranked.filter((x) => x.s === top);
  return winners.length === 1 ? winners[0].p : null;
}

/** Se elige sola si solo hay una propiedad; si no, la persona elige (con la sugerida primero). */
export function autoPick(props: Ga4Property[]): Ga4Property | null {
  return props.length === 1 ? props[0] : null;
}

/** La lista para elegir: la sugerida primero, las demás por nombre. */
export function orderForPicker(website: string, props: Ga4Property[]): { list: Ga4Property[]; suggested: string | null } {
  const s = suggestProperty(website, props);
  const rest = props.filter((p) => p.id !== s?.id).sort((a, b) => a.name.localeCompare(b.name));
  return { list: s ? [s, ...rest] : rest, suggested: s?.id ?? null };
}

// ---------- Leer runReport ----------

export type RunReportResponse = {
  dimensionHeaders?: { name?: string }[];
  metricHeaders?: { name?: string }[];
  rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
  metadata?: { timeZone?: string };
};

/** Una fila de runReport como objeto: { dims: {nombre: valor}, m: {métrica: número} }. */
export type ParsedRow = { dims: Record<string, string>; m: Record<string, number> };

const toNum = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function parseRunReport(r: RunReportResponse): ParsedRow[] {
  const dh = (r.dimensionHeaders ?? []).map((h) => String(h.name ?? ""));
  const mh = (r.metricHeaders ?? []).map((h) => String(h.name ?? ""));
  return (r.rows ?? []).map((row) => {
    const dims: Record<string, string> = {};
    const m: Record<string, number> = {};
    dh.forEach((n, i) => (dims[n] = String(row.dimensionValues?.[i]?.value ?? "")));
    mh.forEach((n, i) => (m[n] = toNum(row.metricValues?.[i]?.value)));
    return { dims, m };
  });
}

/** Nombres de los rangos en las consultas con comparación (aparecen en la dimensión "dateRange"). */
export const CUR = "cur";
export const PREV = "prev";

export const TOTAL_METRICS = ["totalUsers", "newUsers", "sessions", "engagedSessions", "engagementRate", "userEngagementDuration", "activeUsers", "keyEvents", "screenPageViews"];

function totalsFromRow(m: Record<string, number> | undefined): Ga4Totals {
  const x = m ?? {};
  const users = toNum(x.totalUsers);
  const active = toNum(x.activeUsers) || users;
  return {
    users,
    newUsers: toNum(x.newUsers),
    sessions: toNum(x.sessions),
    engagedSessions: toNum(x.engagedSessions),
    engagementRate: toNum(x.engagementRate),
    avgEngagementSec: active > 0 ? toNum(x.userEngagementDuration) / active : 0,
    keyEvents: toNum(x.keyEvents),
    pageViews: toNum(x.screenPageViews),
  };
}

/** Totales de los dos rangos (consulta sin dimensiones con dos dateRanges). Sin filas = ceros. */
export function parseTotals(rows: ParsedRow[]): { totals: Ga4Totals; previous: Ga4Totals } {
  const cur = rows.find((r) => (r.dims.dateRange ?? CUR) === CUR);
  const prev = rows.find((r) => r.dims.dateRange === PREV);
  return { totals: totalsFromRow(cur?.m), previous: totalsFromRow(prev?.m) };
}

/** Filas por una dimensión con los dos rangos juntos (actual y anterior), de más a menos visitas. */
export function parseCompared(rows: ParsedRow[], dim: string, limit = 12): Ga4Row[] {
  const map = new Map<string, Ga4Row>();
  for (const r of rows) {
    const key = r.dims[dim] ?? "";
    if (!key) continue;
    const row = map.get(key) ?? { key, sessions: 0, prevSessions: 0, engagedSessions: 0, keyEvents: 0 };
    if ((r.dims.dateRange ?? CUR) === PREV) row.prevSessions += toNum(r.m.sessions);
    else {
      row.sessions += toNum(r.m.sessions);
      row.engagedSessions += toNum(r.m.engagedSessions);
      row.keyEvents += toNum(r.m.keyEvents);
    }
    map.set(key, row);
  }
  return [...map.values()].filter((r) => r.sessions > 0 || r.prevSessions > 0).sort((a, b) => b.sessions - a.sessions || b.prevSessions - a.prevSessions).slice(0, limit);
}

/** Acciones importantes por nombre (eventName + keyEvents, dos rangos): solo las que pasaron alguna vez. */
export function parseKeyEvents(rows: ParsedRow[], limit = 10): Ga4Event[] {
  const map = new Map<string, Ga4Event>();
  for (const r of rows) {
    const key = r.dims.eventName ?? "";
    if (!key) continue;
    const e = map.get(key) ?? { key, count: 0, prevCount: 0 };
    if ((r.dims.dateRange ?? CUR) === PREV) e.prevCount += toNum(r.m.keyEvents);
    else e.count += toNum(r.m.keyEvents);
    map.set(key, e);
  }
  return [...map.values()].filter((e) => e.count > 0 || e.prevCount > 0).sort((a, b) => b.count - a.count || b.prevCount - a.prevCount).slice(0, limit);
}

/** Las páginas por donde entran: solo la ruta (sin "(not set)"), de más a menos visitas. */
export function parseLanding(rows: ParsedRow[], limit = 15): Ga4Landing[] {
  return rows
    .map((r) => ({
      key: r.dims.landingPagePlusQueryString ?? r.dims.landingPage ?? "",
      sessions: toNum(r.m.sessions),
      engagementRate: toNum(r.m.engagementRate),
      keyEvents: toNum(r.m.keyEvents),
      avgEngagementSec: toNum(r.m.sessions) > 0 ? toNum(r.m.userEngagementDuration) / toNum(r.m.sessions) : 0,
    }))
    .filter((r) => r.key && r.key !== "(not set)" && r.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit);
}

export function parsePlaces(rows: ParsedRow[], dim: "city" | "country", limit = 8): Ga4Place[] {
  return rows
    .map((r) => ({ key: r.dims[dim] ?? "", country: r.dims.country ?? "", sessions: toNum(r.m.sessions) }))
    .filter((r) => r.key && r.key !== "(not set)" && r.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit);
}

/** Visitas por día (dimensión "date" = "YYYYMMDD"), con cero en los días sin visitas. */
export function parseTrend(rows: ParsedRow[], range: Ga4Range): Ga4Day[] {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const d = r.dims.date ?? "";
    const iso = /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
    byDay.set(iso, (byDay.get(iso) ?? 0) + toNum(r.m.sessions));
  }
  return daysOf(range).map((date) => ({ date, sessions: byDay.get(date) ?? 0 }));
}

// ---------- Comparaciones y cuentas ----------

/** Cambio contra los 28 días anteriores: "up" / "down" / "same" / "new" (antes 0) / "none" (sin datos). */
export type Trend = { dir: "up" | "down" | "same" | "new" | "none"; pct: number };

/** Para cantidades (visitas, personas, acciones). pct = cambio relativo (0.25 = 25 %). Menos de 1 % = igual. */
export function compareCount(cur: number, prev: number): Trend {
  if (!prev) return cur > 0 ? { dir: "new", pct: 0 } : { dir: "none", pct: 0 };
  const pct = (cur - prev) / prev;
  if (Math.abs(pct) < 0.01) return { dir: "same", pct: 0 };
  return { dir: pct > 0 ? "up" : "down", pct: Math.abs(pct) };
}

/** Para tasas de 0 a 1 (porcentaje de interés): pct = diferencia en puntos (0.05 = 5 puntos). */
export function compareRate(cur: number, prev: number): Trend {
  if (!prev && !cur) return { dir: "none", pct: 0 };
  const pts = cur - prev;
  if (Math.abs(pts) < 0.005) return { dir: "same", pct: 0 };
  return { dir: pts > 0 ? "up" : "down", pct: Math.abs(pts) };
}

export const ORGANIC = "Organic Search";

/** Qué parte de las visitas llega desde Google (búsqueda gratis), de 0 a 1. */
export function organicShare(r: Pick<Ga4Report, "channels" | "totals">): number {
  const total = r.totals.sessions || r.channels.reduce((s, c) => s + c.sessions, 0);
  if (!total) return 0;
  return (r.channels.find((c) => c.key === ORGANIC)?.sessions ?? 0) / total;
}

/** Menos de esto de «visitas con interés» en una página con muchas visitas = la gente entra y se va. */
export const GA4_LOW_ENGAGEMENT = 0.3;
/** Visitas mínimas (en 28 días) para que una página cuente como «con muchas visitas». */
export const GA4_BUSY_PAGE = 20;

/** ¿Página con muchas visitas (≥ 20 y ≥ 10 % del total) donde casi nadie se queda? */
export function isLowEngagementPage(p: Pick<Ga4Landing, "sessions" | "engagementRate">, totalSessions: number): boolean {
  return p.sessions >= Math.max(GA4_BUSY_PAGE, totalSessions * 0.1) && p.engagementRate < GA4_LOW_ENGAGEMENT;
}

/** Eventos que GA4 marca solo (no los configuró el dueño): no cuentan como «acciones importantes configuradas». */
const DEFAULT_KEY_EVENTS = new Set(["purchase"]);

/** ¿Tiene marcadas sus acciones importantes (llamadas, formularios…)? null = no se sabe. */
export function hasKeyEventsSetUp(r: Pick<Ga4Report, "keyEvents" | "keyEventsConfigured" | "totals">): boolean | null {
  if (r.totals.keyEvents > 0 || r.keyEvents.some((e) => e.count > 0)) return true;
  if (r.keyEventsConfigured === null) return null;
  return r.keyEventsConfigured.some((n) => !DEFAULT_KEY_EVENTS.has(n));
}

// ---------- Leer reportes guardados (con cuidado: pueden venir de versiones viejas) ----------

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown) => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const rangeOf = (v: unknown): Ga4Range => ({ start: str(obj(v).start), end: str(obj(v).end) });
const totalsOf = (v: unknown): Ga4Totals => {
  const o = obj(v);
  return {
    users: toNum(o.users),
    newUsers: toNum(o.newUsers),
    sessions: toNum(o.sessions),
    engagedSessions: toNum(o.engagedSessions),
    engagementRate: toNum(o.engagementRate),
    avgEngagementSec: toNum(o.avgEngagementSec),
    keyEvents: toNum(o.keyEvents),
    pageViews: toNum(o.pageViews),
  };
};

/** Un reporte guardado, normalizado; null si no parece un reporte de GA4. */
export function readGa4Report(data: unknown): Ga4Report | null {
  const o = obj(data);
  if (!("totals" in o) || !("channels" in o)) return null;
  return {
    version: 1,
    propertyId: str(o.propertyId),
    propertyName: str(o.propertyName),
    fetchedAt: str(o.fetchedAt),
    timeZone: str(o.timeZone),
    range: rangeOf(o.range),
    previousRange: rangeOf(o.previousRange),
    totals: totalsOf(o.totals),
    previous: totalsOf(o.previous),
    channels: arr(o.channels).map((r) => ({ key: str(r.key), sessions: toNum(r.sessions), prevSessions: toNum(r.prevSessions), engagedSessions: toNum(r.engagedSessions), keyEvents: toNum(r.keyEvents) })).filter((r) => r.key),
    landingPages: arr(o.landingPages).map((r) => ({ key: str(r.key), sessions: toNum(r.sessions), engagementRate: toNum(r.engagementRate), keyEvents: toNum(r.keyEvents), avgEngagementSec: toNum(r.avgEngagementSec) })).filter((r) => r.key),
    cities: arr(o.cities).map((r) => ({ key: str(r.key), country: str(r.country), sessions: toNum(r.sessions) })).filter((r) => r.key),
    countries: arr(o.countries).map((r) => ({ key: str(r.key), country: str(r.country), sessions: toNum(r.sessions) })).filter((r) => r.key),
    devices: arr(o.devices).map((r) => ({ key: str(r.key), sessions: toNum(r.sessions), prevSessions: toNum(r.prevSessions), engagedSessions: toNum(r.engagedSessions), keyEvents: toNum(r.keyEvents) })).filter((r) => r.key),
    keyEvents: arr(o.keyEvents).map((r) => ({ key: str(r.key), count: toNum(r.count), prevCount: toNum(r.prevCount) })).filter((r) => r.key),
    keyEventsConfigured: Array.isArray(o.keyEventsConfigured) ? o.keyEventsConfigured.map(str).filter(Boolean) : null,
    organicTrend: arr(o.organicTrend).map((r) => ({ date: str(r.date), sessions: toNum(r.sessions) })).filter((r) => r.date),
  };
}

/** ¿Hay que traer datos nuevos? Una vez al día (20 h para que la visita de cada mañana lo actualice). */
export const GA4_STALE_MS = 20 * 3_600_000;
/** Si el último intento automático falló, se espera esto antes de volver a intentar solo. */
export const GA4_RETRY_MS = 24 * 3_600_000;

export function needsRefresh(input: { fetchedAt: string | null; lastTryAt?: string; now?: Date }): boolean {
  const now = (input.now ?? new Date()).getTime();
  const fetched = input.fetchedAt ? Date.parse(input.fetchedAt) : NaN;
  if (Number.isFinite(fetched) && now - fetched < GA4_STALE_MS) return false;
  const tried = input.lastTryAt ? Date.parse(input.lastTryAt) : NaN;
  if (Number.isFinite(tried) && now - tried < GA4_RETRY_MS && (!Number.isFinite(fetched) || tried > fetched)) return false;
  return true;
}

// ---------- Errores comunes, en palabras claras ----------

type Tr = (es: string, en: string) => string;

export function explainGa4Error(msg: string, t: Tr): string {
  if (/invalid_grant|expired or revoked/i.test(msg))
    return t(
      "El permiso de Google venció o se quitó. Vuelve a conectar Google Analytics. (Si tu app de Google está en modo de prueba, Google vence el permiso cada 7 días.)",
      "Google access expired or was revoked. Connect Google Analytics again. (If your Google app is in testing mode, Google expires access every 7 days.)",
    );
  if (/invalid_client|unauthorized_client/i.test(msg))
    return t(
      "El cliente de Google de la app no es válido (revisa GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el servidor).",
      "The app's Google client isn't valid (check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server).",
    );
  if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(msg)) {
    const which = /admin/i.test(msg) ? "Google Analytics Admin API" : /data/i.test(msg) ? "Google Analytics Data API" : "Google Analytics Data API y Google Analytics Admin API";
    const whichEn = which.replace(" y ", " and ");
    return t(
      `Falta activar la ${which} en Google Cloud (en el mismo proyecto de GOOGLE_CLIENT_ID). Actívala, espera unos minutos y vuelve a intentarlo.`,
      `The ${whichEn} needs to be turned on in Google Cloud (in the same project as GOOGLE_CLIENT_ID). Turn it on, wait a few minutes and try again.`,
    );
  }
  if (/insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/i.test(msg))
    return t(
      "No diste el permiso para ver Google Analytics. Vuelve a conectar y marca la casilla de Analytics.",
      "You didn't grant permission to view Google Analytics. Connect again and check the Analytics box.",
    );
  if (/^403|PERMISSION_DENIED|forbidden|sufficient permission/i.test(msg))
    return t(
      "Esa cuenta de Google no tiene acceso a esta propiedad de Google Analytics. Entra con una cuenta que la pueda ver, o pide que te agreguen como usuario (Lector basta).",
      "That Google account doesn't have access to this Google Analytics property. Sign in with an account that can see it, or ask to be added as a user (Viewer is enough).",
    );
  if (/^404|NOT_FOUND/i.test(msg))
    return t("Esa propiedad de Google Analytics ya no existe. Elige otra o vuelve a conectar.", "That Google Analytics property no longer exists. Pick another one or connect again.");
  if (/quota|RATE_LIMIT|RESOURCE_EXHAUSTED|^429/i.test(msg))
    return t("Google limitó las consultas por ahora. Intenta de nuevo en un rato.", "Google is limiting requests right now. Try again in a while.");
  return t(`Google respondió: ${msg}`, `Google responded: ${msg}`);
}
