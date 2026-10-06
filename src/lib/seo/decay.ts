// "Páginas para actualizar" (estilo Content Audit de Semrush): páginas del sitio que están perdiendo visitas desde Google
// y el motivo en palabras simples. Usa Search Console (gratis): los últimos 28 días contra los 28 anteriores y contra
// los mismos 28 días de hace 3 meses. El análisis (puro) está separado de las llamadas a Google para poder probarlo.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { T } from "@/lib/i18n";
import { day, gscConnection, gscRanges, minusDays, query, toPair, toRow, type ApiRow, type GscPageQuery, type GscRange, type GscRow } from "@/lib/seo/gsc";

export const DECAY_KIND = "decay";
/** Cuántos reportes "decay" se guardan por negocio. */
export const DECAY_KEEP = 6;
/** Cuántas páginas se muestran (las que más clics perdieron). */
export const DECAY_LIMIT = 15;

/** Para que el ruido no aparezca: la página tenía que tener al menos esto antes. */
export const MIN_CLICKS_BEFORE = 10;
export const MIN_IMPRESSIONS_BEFORE = 200;
/** Cuenta como pérdida de visitas: al menos 3 clics y al menos el 20 % de los que tenía. */
export const MIN_CLICKS_LOST = 3;
export const MIN_CLICKS_DROP = 0.2;
/** O, si casi no tenía clics, que la vieran mucho menos (≥ 30 % y ≥ 100 veces menos). */
export const MIN_IMPRESSIONS_DROP = 0.3;
export const MIN_IMPRESSIONS_LOST = 100;
/** "Bajó de posición": la posición promedio empeoró al menos 2 lugares. */
export const POSITION_DROP = 2;
/** Impresiones "estables": no bajaron más del 25 %. CTR "bajó": cayó al menos 25 %. */
export const STABLE_RATIO = 0.75;
export const CTR_DROP_RATIO = 0.75;

export type DecayCompare = "previous" | "quarter";
/** position = bajó de posición · demand = menos gente lo busca · ctr = te ven pero no hacen clic · queries = perdió búsquedas clave. */
export type DecayReason = "position" | "demand" | "ctr" | "queries";

export type PageStat = { clicks: number; impressions: number; ctr: number; position: number };
export type LostQuery = { query: string; clicksBefore: number; clicksNow: number; impressionsBefore: number; impressionsNow: number; positionBefore: number; positionNow: number };

export type DecayPage = {
  /** La dirección como la da Google (de la versión con más clics antes). */
  url: string;
  /** Con qué periodo se compara: los 28 días anteriores o los mismos 28 días de hace 3 meses. */
  compare: DecayCompare;
  before: PageStat;
  now: PageStat;
  clicksLost: number;
  reason: DecayReason;
  /** Las (hasta) 3 búsquedas que más clics perdieron en esta página. */
  lostQueries: LostQuery[];
  /** Si también perdió visitas en la otra comparación. */
  also: { compare: DecayCompare; clicksBefore: number; clicksNow: number } | null;
};

/** Lo que se guarda en SeoReport.data (kind "decay"). ctr va de 0 a 1, como lo da Google. */
export type DecayReport = {
  version: 1;
  siteUrl: string;
  fetchedAt: string;
  range: GscRange;
  previousRange: GscRange;
  quarterRange: GscRange;
  /** Páginas con suficientes visitas antes para revisarlas (en alguna de las dos comparaciones). */
  pagesChecked: number;
  /** Cuántas páginas perdieron visitas (antes de recortar a las 15 primeras). */
  decaying: number;
  pages: DecayPage[];
};

/** Datos de un periodo: por página y por página + búsqueda. */
export type DecayPeriod = { pages: GscRow[]; pairs: GscPageQuery[] };

// ---------- Fechas ----------

/** Los 28 días de ahora, los 28 anteriores y los mismos 28 días de hace 3 meses (13 semanas: mismos días de la semana). */
export function decayRanges(now = new Date()): { range: GscRange; previousRange: GscRange; quarterRange: GscRange } {
  const { range, previousRange } = gscRanges(now);
  const shift = (iso: string) => day(minusDays(new Date(`${iso}T00:00:00Z`), 91));
  return { range, previousRange, quarterRange: { start: shift(range.start), end: shift(range.end) } };
}

// ---------- Análisis (puro) ----------

/** La misma página con o sin https, www, barra final, parámetros de campaña o #sección cuenta como una sola. */
export function pageKey(url: string): string {
  const raw = url.trim();
  try {
    const u = new URL(raw);
    const keep = [...u.searchParams.entries()].filter(([k]) => !/^(utm_|gclid$|fbclid$|srsltid$)/i.test(k));
    const qs = keep.length ? `?${new URLSearchParams(keep)}` : "";
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${path}${qs}`;
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/#.*$/, "").replace(/\/+$/, "") || "/";
  }
}

/** La ruta corta de una página para mostrarla ("/blog/precios"), decodificada. */
export function shortPath(url: string): string {
  try {
    const u = new URL(url);
    const p = `${u.pathname}${u.search}`;
    try {
      return decodeURI(p) || "/";
    } catch {
      return p || "/";
    }
  } catch {
    return url;
  }
}

type Acc = { url: string; topClicks: number; clicks: number; impressions: number; posWeight: number };

/** Junta las filas de la misma página (ver pageKey): suma clics e impresiones; la posición se promedia por impresiones. */
export function mergePages(rows: GscRow[]): Map<string, PageStat & { url: string }> {
  const acc = new Map<string, Acc>();
  for (const r of rows) {
    if (!r.key) continue;
    const k = pageKey(r.key);
    const a = acc.get(k) ?? { url: r.key, topClicks: -1, clicks: 0, impressions: 0, posWeight: 0 };
    if (r.clicks > a.topClicks) {
      a.url = r.key;
      a.topClicks = r.clicks;
    }
    a.clicks += r.clicks;
    a.impressions += r.impressions;
    a.posWeight += r.position * r.impressions;
    acc.set(k, a);
  }
  const out = new Map<string, PageStat & { url: string }>();
  for (const [k, a] of acc)
    out.set(k, {
      url: a.url,
      clicks: a.clicks,
      impressions: a.impressions,
      ctr: a.impressions ? a.clicks / a.impressions : 0,
      position: a.impressions ? a.posWeight / a.impressions : 0,
    });
  return out;
}

type QAcc = { clicks: number; impressions: number; posWeight: number };

/** Por página (pageKey) y búsqueda (en minúsculas): clics, impresiones y posición promedio. */
function mergePairs(pairs: GscPageQuery[]): Map<string, Map<string, QAcc>> {
  const out = new Map<string, Map<string, QAcc>>();
  for (const p of pairs) {
    if (!p.page || !p.query) continue;
    const k = pageKey(p.page);
    const q = p.query.trim().toLowerCase();
    const m = out.get(k) ?? new Map<string, QAcc>();
    const a = m.get(q) ?? { clicks: 0, impressions: 0, posWeight: 0 };
    a.clicks += p.clicks;
    a.impressions += p.impressions;
    a.posWeight += p.position * p.impressions;
    m.set(q, a);
    out.set(k, m);
  }
  return out;
}

const avgPos = (a: QAcc | undefined) => (a && a.impressions ? a.posWeight / a.impressions : 0);

/** Las búsquedas de una página que más clics perdieron (si ninguna perdió clics: las que más impresiones perdieron). */
export function lostQueries(before: Map<string, QAcc> | undefined, now: Map<string, QAcc> | undefined, limit = 3): LostQuery[] {
  if (!before) return [];
  const rows: LostQuery[] = [];
  for (const [query, b] of before) {
    const n = now?.get(query);
    rows.push({
      query,
      clicksBefore: b.clicks,
      clicksNow: n?.clicks ?? 0,
      impressionsBefore: b.impressions,
      impressionsNow: n?.impressions ?? 0,
      positionBefore: avgPos(b),
      positionNow: avgPos(n),
    });
  }
  const clicksLost = (r: LostQuery) => r.clicksBefore - r.clicksNow;
  const imprLost = (r: LostQuery) => r.impressionsBefore - r.impressionsNow;
  const byClicks = rows.filter((r) => clicksLost(r) > 0).sort((a, b) => clicksLost(b) - clicksLost(a) || imprLost(b) - imprLost(a));
  if (byClicks.length) return byClicks.slice(0, limit);
  return rows
    .filter((r) => imprLost(r) >= 20)
    .sort((a, b) => imprLost(b) - imprLost(a))
    .slice(0, limit);
}

/** La página tenía suficientes visitas antes como para que una baja no sea ruido. */
export const isEligible = (before: PageStat) => before.clicks >= MIN_CLICKS_BEFORE || before.impressions >= MIN_IMPRESSIONS_BEFORE;

/** ¿Perdió visitas? Clics (≥ 3 y ≥ 20 %) o, si casi no tenía clics, muchas menos veces en Google. */
export function isDecaying(before: PageStat, now: PageStat): boolean {
  if (!isEligible(before)) return false;
  const lost = before.clicks - now.clicks;
  if (lost >= MIN_CLICKS_LOST && lost >= before.clicks * MIN_CLICKS_DROP) return true;
  const imprLost = before.impressions - now.impressions;
  return now.clicks <= before.clicks && imprLost >= MIN_IMPRESSIONS_LOST && imprLost >= before.impressions * MIN_IMPRESSIONS_DROP;
}

/**
 * El motivo, en este orden:
 * 1. Bajó de posición: la posición promedio empeoró ≥ 2 lugares (al bajar de lugar también te ven menos; la causa es la posición).
 * 2. Menos gente lo busca: te ven ≥ 25 % menos y la posición está igual.
 * 3. Te ven pero no hacen clic: te ven igual o más, pero el CTR cayó ≥ 25 %.
 * 4. Si no, perdió búsquedas clave (ver lostQueries).
 */
export function classify(before: PageStat, now: PageStat): DecayReason {
  const posWorse = before.position > 0 && now.position > 0 ? now.position - before.position : 0;
  const imprRatio = before.impressions ? now.impressions / before.impressions : 1;
  // Ya no sale en Google para nada: no es la demanda, perdió todas sus búsquedas.
  if (before.impressions > 0 && now.impressions === 0) return "queries";
  if (posWorse >= POSITION_DROP) return "position";
  if (imprRatio < STABLE_RATIO && posWorse < POSITION_DROP) return "demand";
  if (imprRatio >= STABLE_RATIO && before.ctr > 0 && now.ctr <= before.ctr * CTR_DROP_RATIO) return "ctr";
  return "queries";
}

const ZERO: PageStat = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
const stat = (s: PageStat | undefined): PageStat => (s ? { clicks: s.clicks, impressions: s.impressions, ctr: s.ctr, position: s.position } : ZERO);

type Candidate = Omit<DecayPage, "also">;

/** Las páginas que perdieron visitas en una comparación (sin ordenar ni recortar). */
export function compareDecay(now: DecayPeriod, before: DecayPeriod, compare: DecayCompare): { eligible: Set<string>; pages: Map<string, Candidate> } {
  const nowPages = mergePages(now.pages);
  const beforePages = mergePages(before.pages);
  const nowPairs = mergePairs(now.pairs);
  const beforePairs = mergePairs(before.pairs);
  const eligible = new Set<string>();
  const pages = new Map<string, Candidate>();
  for (const [k, b] of beforePages) {
    const prev = stat(b);
    if (!isEligible(prev)) continue;
    eligible.add(k);
    const cur = stat(nowPages.get(k));
    if (!isDecaying(prev, cur)) continue;
    pages.set(k, {
      url: nowPages.get(k)?.url ?? b.url,
      compare,
      before: prev,
      now: cur,
      clicksLost: Math.max(0, prev.clicks - cur.clicks),
      reason: classify(prev, cur),
      lostQueries: lostQueries(beforePairs.get(k), nowPairs.get(k)),
    });
  }
  return { eligible, pages };
}

const impressionsLost = (p: Candidate) => p.before.impressions - p.now.impressions;
/** Pesa más la comparación que perdió más clics; si empatan, la que perdió más impresiones; si no, la de 28 días. */
const worse = (a: Candidate, b: Candidate) => b.clicksLost - a.clicksLost || impressionsLost(b) - impressionsLost(a);

/** El reporte: une las dos comparaciones por página, ordena por clics perdidos y deja las 15 primeras. */
export function buildDecay(
  data: { now: DecayPeriod; previous: DecayPeriod; quarter: DecayPeriod },
  meta: { siteUrl: string; fetchedAt: string; range: GscRange; previousRange: GscRange; quarterRange: GscRange },
  limit = DECAY_LIMIT,
): DecayReport {
  const prev = compareDecay(data.now, data.previous, "previous");
  const quarter = compareDecay(data.now, data.quarter, "quarter");
  const keys = new Set([...prev.pages.keys(), ...quarter.pages.keys()]);
  const merged: DecayPage[] = [];
  for (const k of keys) {
    const a = prev.pages.get(k);
    const b = quarter.pages.get(k);
    const [main, other] = a && b ? (worse(a, b) <= 0 ? [a, b] : [b, a]) : [(a ?? b) as Candidate, undefined];
    merged.push({ ...main, also: other ? { compare: other.compare, clicksBefore: other.before.clicks, clicksNow: other.now.clicks } : null });
  }
  merged.sort((x, y) => worse(x, y) || x.url.localeCompare(y.url));
  return {
    version: 1,
    ...meta,
    pagesChecked: new Set([...prev.eligible, ...quarter.eligible]).size,
    decaying: merged.length,
    pages: merged.slice(0, limit),
  };
}

// ---------- Palabras simples ----------

export function reasonLabel(r: DecayReason, t: T): string {
  return {
    position: t("Bajó de posición", "Dropped in rankings"),
    demand: t("Menos gente lo busca", "Fewer people search for it"),
    ctr: t("Te ven pero no hacen clic", "People see it but don't click"),
    queries: t("Perdió búsquedas clave", "Lost key searches"),
  }[r];
}

/** La explicación del motivo en una frase. */
export function reasonWhy(p: DecayPage, t: T): string {
  switch (p.reason) {
    case "position":
      return t(
        "Google la está mostrando más abajo que antes, así que menos gente llega a verla y a entrar.",
        "Google is showing it lower than before, so fewer people see it and click.",
      );
    case "demand":
      return t(
        "Sigue saliendo en el mismo lugar, pero ahora menos gente busca estos temas en Google. No es culpa de tu página.",
        "It still shows up in the same spot, but fewer people are searching for these topics on Google. It's not your page's fault.",
      );
    case "ctr":
      return t(
        "La siguen viendo en Google igual que antes, pero menos personas hacen clic en ella.",
        "People still see it on Google as before, but fewer of them click on it.",
      );
    case "queries":
      if (p.now.impressions === 0)
        return t("Ya no aparece en Google para ninguna búsqueda.", "It no longer shows up on Google for any search.");
      return t(
        "Dejó de traer visitas con algunas búsquedas que antes le funcionaban.",
        "It stopped getting visits from some searches that used to work for it.",
      );
  }
}

/** 1-2 cosas concretas para hacer, según el motivo. */
export function decayActions(p: DecayPage, t: T): string[] {
  const q = p.lostQueries[0]?.query;
  switch (p.reason) {
    case "position":
      return [
        t(
          "Actualiza y amplía el contenido: agrega información nueva, precios, fotos de trabajos recientes y preguntas frecuentes de este año.",
          "Update and expand the content: add new information, prices, photos of recent jobs and this year's frequently asked questions.",
        ),
        t(
          "Ponle enlaces desde otras páginas tuyas (el inicio, el blog) usando las palabras que busca la gente.",
          "Link to it from your other pages (home page, blog) using the words people search for.",
        ),
      ];
    case "demand":
      return [
        t(
          "Puede ser temporada: revisa si pasa lo mismo cada año en estas fechas. No hace falta cambiar la página por esto.",
          "It may be seasonal: check whether the same thing happens every year around this time. You don't need to change the page for this.",
        ),
        t(
          "Si quieres más visitas, agrégale temas parecidos que la gente sí está buscando ahora.",
          "If you want more visits, add related topics that people are searching for right now.",
        ),
      ];
    case "ctr":
      return [
        t(
          "Reescribe el título y la descripción que salen en Google: di el beneficio, la ciudad o el precio para que den ganas de entrar.",
          "Rewrite the title and description shown on Google: mention the benefit, the city or the price so people want to click.",
        ),
        t(
          "Busca tu página en Google y mira qué sale arriba (anuncios, mapas, competidores): tu título tiene que destacar frente a ellos.",
          "Search for your page on Google and see what shows above it (ads, maps, competitors): your title has to stand out against them.",
        ),
      ];
    case "queries":
      if (p.now.impressions === 0)
        return [
          t(
            "Ya no sale en Google: abre la página y revisa que funcione (que no dé error, no pida contraseña y no mande a otra dirección).",
            "It no longer shows up on Google: open the page and check that it works (no error, no password, no redirect to another address).",
          ),
          t(
            "Si la cambiaste de dirección a propósito, pon una redirección 301 de la vieja a la nueva para no perder sus visitas.",
            "If you moved it to a new address on purpose, add a 301 redirect from the old one to the new one so you keep its visits.",
          ),
        ];
      return [
        q
          ? t(
              `Revisa que la página siga respondiendo bien a «${q}»: agrega una sección clara sobre eso.`,
              `Make sure the page still answers “${q}” well: add a clear section about it.`,
            )
          : t("Revisa que la página siga respondiendo bien a lo que la gente busca.", "Make sure the page still answers what people search for."),
        t(
          "Si otra página tuya empezó a salir para esas búsquedas, enlázalas entre sí para que no compitan.",
          "If another of your pages started showing up for those searches, link them to each other so they don't compete.",
        ),
      ];
  }
}

export const compareLabel = (c: DecayCompare, t: T) =>
  c === "previous" ? t("vs. los 28 días anteriores", "vs. the previous 28 days") : t("vs. hace 3 meses", "vs. 3 months ago");

// ---------- Leer de Google ----------

const PAGE_ROWS = 1000;
const PAIR_ROWS = 5000;

/** Trae los tres periodos de Search Console (6 consultas, gratis) y arma el reporte. */
export async function decayReport(conn: { secret: string }, now = new Date()): Promise<DecayReport> {
  const { token, siteUrl } = await gscConnection(conn);
  const { range, previousRange, quarterRange } = decayRanges(now);
  const period = async (r: GscRange): Promise<DecayPeriod> => {
    const [pages, pairs] = await Promise.all([
      query(token, siteUrl, r, ["page"], PAGE_ROWS),
      query(token, siteUrl, r, ["page", "query"], PAIR_ROWS).catch(() => [] as ApiRow[]),
    ]);
    return { pages: pages.map(toRow), pairs: pairs.map(toPair).filter((p) => p.page && p.query) };
  };
  const [cur, previous, quarter] = await Promise.all([period(range), period(previousRange), period(quarterRange)]);
  return buildDecay({ now: cur, previous, quarter }, { siteUrl, fetchedAt: now.toISOString(), range, previousRange, quarterRange });
}

// ---------- Guardar y leer ----------

/** Guarda el reporte y deja solo los últimos 6. */
export async function saveDecayReport(businessId: string, report: DecayReport) {
  await db.seoReport.create({ data: { businessId, kind: DECAY_KIND, data: report as unknown as Prisma.InputJsonValue } });
  const old = await db.seoReport.findMany({ where: { businessId, kind: DECAY_KIND }, orderBy: { createdAt: "desc" }, skip: DECAY_KEEP, select: { id: true } });
  if (old.length) await db.seoReport.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

export async function latestDecayReports(businessId: string, take = 1) {
  return db.seoReport.findMany({ where: { businessId, kind: DECAY_KIND }, orderBy: { createdAt: "desc" }, take });
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const rangeOf = (v: unknown): GscRange => ({ start: str(obj(v).start), end: str(obj(v).end) });
const statOf = (v: unknown): PageStat => {
  const o = obj(v);
  return { clicks: num(o.clicks), impressions: num(o.impressions), ctr: num(o.ctr), position: num(o.position) };
};
const REASONS: DecayReason[] = ["position", "demand", "ctr", "queries"];
const compareOf = (v: unknown): DecayCompare => (v === "quarter" ? "quarter" : "previous");

/** Un reporte guardado, normalizado; null si no parece uno de "Páginas para actualizar". */
export function readDecayReport(data: unknown): DecayReport | null {
  const o = obj(data);
  if (o.version !== 1 || !Array.isArray(o.pages)) return null;
  return {
    version: 1,
    siteUrl: str(o.siteUrl),
    fetchedAt: str(o.fetchedAt),
    range: rangeOf(o.range),
    previousRange: rangeOf(o.previousRange),
    quarterRange: rangeOf(o.quarterRange),
    pagesChecked: num(o.pagesChecked),
    decaying: num(o.decaying),
    pages: o.pages
      .map(obj)
      .filter((p) => str(p.url))
      .map((p) => {
        const also = obj(p.also);
        return {
          url: str(p.url),
          compare: compareOf(p.compare),
          before: statOf(p.before),
          now: statOf(p.now),
          clicksLost: num(p.clicksLost),
          reason: REASONS.includes(p.reason as DecayReason) ? (p.reason as DecayReason) : "queries",
          lostQueries: Array.isArray(p.lostQueries)
            ? p.lostQueries
                .map(obj)
                .filter((q) => str(q.query))
                .map((q) => ({
                  query: str(q.query),
                  clicksBefore: num(q.clicksBefore),
                  clicksNow: num(q.clicksNow),
                  impressionsBefore: num(q.impressionsBefore),
                  impressionsNow: num(q.impressionsNow),
                  positionBefore: num(q.positionBefore),
                  positionNow: num(q.positionNow),
                }))
            : [],
          also: p.also && typeof p.also === "object" ? { compare: compareOf(also.compare), clicksBefore: num(also.clicksBefore), clicksNow: num(also.clicksNow) } : null,
        };
      }),
  };
}
