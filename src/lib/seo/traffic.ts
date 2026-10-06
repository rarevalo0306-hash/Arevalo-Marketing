// Visitas de tu competencia e historial (estilo "Traffic Analytics" / "Organic Research" de Semrush), con DataForSEO Labs.
// Para tu dominio y hasta 3 competidores del último reporte de competencia (sin directorios):
//   - Historial: POST /dataforseo_labs/google/historical_rank_overview/live (docs.dataforseo.com/v3/dataforseo_labs/google/historical_rank_overview/live)
//     Un dominio por llamada; items[] = un mes cada uno (year, month, metrics.organic: etv, count, pos_1, pos_2_3,
//     pos_4_10, estimated_paid_traffic_cost). Sin date_from da solo 6 meses: se pide desde hace 12 meses (13 meses).
//     "Hoy" es el último mes del historial: así no hace falta domain_rank_overview (misma información, una llamada
//     más por dominio) ni bulk_traffic_estimation (solo trae etv y count, sin top 3/top 10 ni valor).
//   - Mejores páginas (solo competidores): POST /dataforseo_labs/google/relevant_pages/live, limit 10, ordenadas por
//     metrics.organic.etv. La búsqueda principal de cada página sale gratis del último reporte de competencia
//     (ranked_keywords ya trae la url de cada búsqueda); no se hace una llamada por página.
// Labs trabaja por PAÍS: se usa el de la zona principal del negocio (resolveLocation, igual que la competencia).
// Precio (dataforseo.com/pricing/dataforseo-labs): USD 0.012 por llamada + 0.00012 por fila devuelta.
import { bi } from "@/lib/i18n";
import {
  type BiText,
  type CompetitorsLocation,
  type CompetitorsReport,
  type RankedKeyword,
  isDirectory,
  normalizeDomain,
  resolveLocation,
  sameSite,
} from "@/lib/seo/competitors";
import { dfsPost } from "@/lib/seo/dataforseo";
import { LABS_ITEM_COST, LABS_TASK_COST } from "@/lib/seo/gap";

export const TRAFFIC_KIND = "traffic";
/** Reportes de visitas que se guardan por negocio. */
export const TRAFFIC_KEEP = 10;
export const TRAFFIC_MAX_COMPETITORS = 3;
/** Meses hacia atrás del historial (más el mes actual = 13 filas por dominio). */
export const TRAFFIC_HISTORY_MONTHS = 12;
/** Páginas por competidor. */
export const TRAFFIC_PAGES_LIMIT = 10;

/** Un mes del historial. `month` es "AAAA-MM". */
export type TrafficMonth = { month: string; etv: number | null; keywords: number | null; top3: number | null; top10: number | null; value: number | null };

/** Lo de hoy (el último mes con datos). */
export type TrafficNow = {
  /** Visitas al mes estimadas desde Google (en el país). */
  etv: number | null;
  /** Búsquedas por las que sale en Google. */
  keywords: number | null;
  /** De ellas, cuántas en los 3 primeros lugares. */
  top3: number | null;
  /** De ellas, cuántas en la primera página (top 10). */
  top10: number | null;
  /** Lo que costarían esas visitas en anuncios de Google (USD al mes). */
  value: number | null;
  /** El mes de estos datos ("AAAA-MM"). */
  month: string | null;
};

export type TrafficPage = {
  url: string;
  etv: number | null;
  keywords: number | null;
  top3: number | null;
  value: number | null;
  /** La búsqueda que más le trae (del reporte de competencia), si se sabe. */
  topKeyword: string | null;
  /** El tema según la dirección de la página ("/ventanas-y-puertas-de-pvc" → "ventanas y puertas de pvc"). */
  topic: string | null;
};

export type TrafficDomain = {
  domain: string;
  isYou: boolean;
  now: TrafficNow | null;
  pages: TrafficPage[];
  history: TrafficMonth[];
  /** DataForSEO no pudo leer este dominio (error de la llamada, no "sin datos"). */
  failed?: boolean;
};

export type TrafficReport = {
  domain: string;
  /** El país de los datos (Labs no tiene ciudades). */
  country: string;
  location: CompetitorsLocation | null;
  domains: TrafficDomain[];
  notes: BiText[];
  cost: number;
  createdAt: string;
};

// ---------- Ayudantes puros ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const nonNeg = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n >= 0 ? n : null;
};
const sum = (...vs: (number | null)[]): number | null => (vs.every((v) => v === null) ? null : vs.reduce<number>((a, v) => a + (v ?? 0), 0));
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "AAAA-MM" de un año y mes (1-12). */
export const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/** Suma (o resta) meses a "AAAA-MM". */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return monthKey(Math.floor(total / 12), (total % 12) + 1);
}

/** Desde cuándo pedir el historial: el día 1 del mes de hace `months` meses ("2025-10-01" si hoy es octubre 2026). */
export function historyStart(now: Date, months = TRAFFIC_HISTORY_MONTHS): string {
  return `${addMonths(monthKey(now.getUTCFullYear(), now.getUTCMonth() + 1), -months)}-01`;
}

/** Lo máximo que puede costar una corrida: historial de cada dominio + páginas de cada competidor. */
export function trafficCostEstimate(competitors: number, pagesLimit = TRAFFIC_PAGES_LIMIT): number {
  const c = Math.max(0, Math.min(TRAFFIC_MAX_COMPETITORS, competitors));
  const history = (1 + c) * (LABS_TASK_COST + (TRAFFIC_HISTORY_MONTHS + 1) * LABS_ITEM_COST);
  const pages = c * (LABS_TASK_COST + pagesLimit * LABS_ITEM_COST);
  return Math.round((history + pages) * 1000) / 1000;
}

/**
 * Con quién compararte: los competidores del último reporte de competencia, en su orden, sin directorios ni redes
 * (Páginas Amarillas, Facebook…), salvo los que agregó el dueño. Con la lista de sus búsquedas (para las páginas).
 */
export function pickTrafficCompetitors(report: Pick<CompetitorsReport, "competitors" | "domain"> | null, self?: string | null): { domain: string; top: RankedKeyword[] }[] {
  if (!report) return [];
  return report.competitors
    .filter((c) => (c.source === "owner" || !isDirectory(c.domain)) && !(self && sameSite(c.domain, self)))
    .slice(0, TRAFFIC_MAX_COMPETITORS)
    .map((c) => ({ domain: c.domain, top: c.top }));
}

/** Lo que trae un mes de DataForSEO (metrics.organic) en nuestra forma. */
function organicMonth(month: string, metrics: unknown): TrafficMonth {
  const o = obj(obj(metrics).organic);
  const pos1 = nonNeg(o.pos_1);
  const pos23 = nonNeg(o.pos_2_3);
  const pos410 = nonNeg(o.pos_4_10);
  const top3 = sum(pos1, pos23);
  return { month, etv: nonNeg(o.etv), keywords: nonNeg(o.count), top3, top10: pos410 === null && top3 === null ? null : sum(top3, pos410), value: nonNeg(o.estimated_paid_traffic_cost) };
}

/** historical_rank_overview: items[] con year, month y metrics.organic. Devuelve los meses del más viejo al más nuevo. */
export function parseHistory(result: unknown[]): TrafficMonth[] {
  const byMonth = new Map<string, TrafficMonth>();
  for (const raw of arr(obj(result[0]).items)) {
    const it = obj(raw);
    const year = num(it.year);
    const month = num(it.month);
    if (year === null || month === null || month < 1 || month > 12) continue;
    const key = monthKey(year, month);
    if (!byMonth.has(key)) byMonth.set(key, organicMonth(key, it.metrics));
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Lo de hoy: el último mes del historial (null si no hay historial). */
export function nowFromHistory(history: TrafficMonth[]): TrafficNow | null {
  const last = history[history.length - 1];
  if (!last) return null;
  return { etv: last.etv, keywords: last.keywords, top3: last.top3, top10: last.top10, value: last.value, month: last.month };
}

/** Una dirección comparable: sin protocolo, sin www, sin ?…/#…, sin "/" al final, en minúsculas. */
export function normalizeUrl(url: string): string {
  const s = String(url ?? "").trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\d*\./, "");
  return s.split(/[?#]/)[0].replace(/\/+$/, "");
}

/** El tema de una página según su dirección: la última parte, con espacios ("/blog/portones-corredizos.html" → "portones corredizos"). */
export function slugTopic(url: string): string | null {
  const path = normalizeUrl(url).split("/").slice(1).filter(Boolean);
  const last = path[path.length - 1];
  if (!last) return null;
  let words: string;
  try {
    words = decodeURIComponent(last);
  } catch {
    words = last;
  }
  const list = words
    .replace(/\.(html?|php|aspx?)$/, "")
    .split(/[-_+\s]+/)
    .filter((w) => w && !/\d/.test(w));
  if (list.length < 2) return null;
  return list.slice(0, 6).join(" ");
}

/** La búsqueda que más visitas le trae a una página, entre las que se conocen (la de más volumen y mejor posición). */
export function topKeywordForPage(url: string, keywords: RankedKeyword[]): string | null {
  const key = normalizeUrl(url);
  if (!key) return null;
  const hits = keywords.filter((k) => k.url && normalizeUrl(k.url) === key);
  hits.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || a.position - b.position);
  return hits[0]?.keyword ?? null;
}

/** relevant_pages: items[] con page_address y metrics.organic. Ordenadas por visitas. */
export function parseRelevantPages(result: unknown[], keywords: RankedKeyword[] = [], limit = TRAFFIC_PAGES_LIMIT): TrafficPage[] {
  const out: TrafficPage[] = [];
  for (const raw of arr(obj(result[0]).items)) {
    const it = obj(raw);
    const url = str(it.page_address).trim();
    if (!url || out.some((p) => normalizeUrl(p.url) === normalizeUrl(url))) continue;
    const m = organicMonth("", it.metrics);
    out.push({ url, etv: m.etv, keywords: m.keywords, top3: m.top3, value: m.value, topKeyword: topKeywordForPage(url, keywords), topic: slugTopic(url) });
  }
  return out.sort((a, b) => (b.etv ?? -1) - (a.etv ?? -1) || (b.keywords ?? -1) - (a.keywords ?? -1)).slice(0, limit);
}

/** Si un dominio no tiene ningún dato (sitios chicos o nuevos que DataForSEO no mide). */
export function hasData(d: Pick<TrafficDomain, "now" | "history" | "pages">): boolean {
  return Boolean((d.now && (d.now.etv !== null || d.now.keywords !== null)) || d.history.length || d.pages.length);
}

/** El mes más nuevo entre todos los dominios. */
export function latestMonth(domains: Pick<TrafficDomain, "history">[]): string | null {
  let best: string | null = null;
  for (const d of domains) for (const h of d.history) if (!best || h.month > best) best = h.month;
  return best;
}

/**
 * Visitas de un dominio en un mes. Si el dominio tiene historial pero ese mes no viene, es que ese mes no salía en
 * Google (0). Sin historial: null (sin datos).
 */
export function etvAt(d: Pick<TrafficDomain, "history">, month: string): number | null {
  if (!d.history.length) return null;
  const hit = d.history.find((h) => h.month === month);
  if (hit) return hit.etv ?? 0;
  // Antes del primer mes o después del último mes con datos: no salía en Google.
  return 0;
}

export type TrafficSeries = { domain: string; isYou: boolean; values: (number | null)[] };

/** Los datos de la gráfica: los últimos `span` meses (hasta el más nuevo) y las visitas de cada dominio con datos. */
export function trafficTimeline(domains: TrafficDomain[], span = TRAFFIC_HISTORY_MONTHS + 1): { months: string[]; series: TrafficSeries[] } {
  const end = latestMonth(domains);
  if (!end) return { months: [], series: [] };
  const months = Array.from({ length: span }, (_, i) => addMonths(end, i - span + 1));
  const series = domains.filter((d) => d.history.length).map((d) => ({ domain: d.domain, isYou: d.isYou, values: months.map((m) => etvAt(d, m)) }));
  return { months, series };
}

/** Visitas de hace `monthsAgo` meses y de ahora (para "pasó de 20 a 45"). null si no hay historial. */
export function trafficDelta(d: Pick<TrafficDomain, "history">, monthsAgo: number, end?: string | null): { from: number; to: number } | null {
  const last = end ?? d.history[d.history.length - 1]?.month;
  if (!last || !d.history.length) return null;
  return { from: etvAt(d, addMonths(last, -monthsAgo)) ?? 0, to: etvAt(d, last) ?? 0 };
}

/** Visitas redondeadas para leer: "menos de 1" si es más que 0 pero menos que 1. */
export function visitsText(v: number | null, lang: "es" | "en"): string {
  if (v === null) return lang === "en" ? "no data" : "sin datos";
  if (v > 0 && v < 1) return lang === "en" ? "less than 1" : "menos de 1";
  return new Intl.NumberFormat(lang === "en" ? "en-US" : "es", { maximumFractionDigits: 0 }).format(Math.round(v));
}

/** Nombre corto de un dominio para las frases: "cormetal.com.ni" → "Cormetal". */
export function siteName(domain: string): string {
  const labels = domain.split(".");
  let i = labels.length - 2;
  if (i > 0 && labels[i].length <= 3 && ["co", "com", "net", "org", "gob", "gov", "edu"].includes(labels[i])) i--;
  const name = labels[Math.max(0, i)] ?? domain;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Si no cambió (mismo número redondeado y del mismo lado de "menos de 1"). */
const unchanged = (d: { from: number; to: number }) => Math.round(d.from) === Math.round(d.to) && d.from >= 1 === d.to >= 1 && d.from > 0 === d.to > 0;

/** "Cormetal pasó de 20 a 45 visitas al mes" / "tú de 1 a 3", en los dos idiomas. */
export function changeText(name: string | null, d: { from: number; to: number }): BiText {
  const es = (v: number) => visitsText(v, "es");
  const en = (v: number) => visitsText(v, "en");
  if (name === null)
    return unchanged(d) ? { es: `tú te quedaste en ${es(d.to)}`, en: `you stayed at ${en(d.to)}` } : { es: `tú de ${es(d.from)} a ${es(d.to)}`, en: `you from ${en(d.from)} to ${en(d.to)}` };
  return unchanged(d)
    ? { es: `${name} se quedó en ${es(d.to)} visitas al mes`, en: `${name} stayed at ${en(d.to)} visits a month` }
    : { es: `${name} pasó de ${es(d.from)} a ${es(d.to)} visitas al mes`, en: `${name} went from ${en(d.from)} to ${en(d.to)} visits a month` };
}

/**
 * El resumen en palabras simples: quién recibe más visitas hoy, cómo cambió cada uno en un año (o en 6 meses si no
 * hay un año de datos) y qué dominios no tienen datos.
 */
export function trafficSummary(report: Pick<TrafficReport, "domains">): BiText[] {
  const out: BiText[] = [];
  const withData = report.domains.filter((d) => hasData(d));
  const noData = report.domains.filter((d) => !hasData(d) && !d.failed);
  const you = report.domains.find((d) => d.isYou);
  const rivals = withData.filter((d) => !d.isYou);
  const etv = (d: TrafficDomain) => d.now?.etv ?? 0;

  // 1) Quién recibe más visitas hoy.
  const leader = [...withData].sort((a, b) => etv(b) - etv(a))[0];
  if (leader && etv(leader) > 0) {
    if (leader.isYou)
      out.push({
        es: `Hoy tú eres quien más visitas recibe desde Google: unas ${visitsText(etv(leader), "es")} al mes. ¡Bien! Sigue escribiendo para no perder el lugar.`,
        en: `Today you get the most visits from Google: about ${visitsText(etv(leader), "en")} a month. Nice! Keep writing to hold your spot.`,
      });
    else {
      const mine = you && hasData(you) ? etv(you) : 0;
      const times = mine >= 1 ? Math.round(etv(leader) / mine) : null;
      out.push({
        es:
          `Hoy ${siteName(leader.domain)} es quien más visitas recibe desde Google: unas ${visitsText(etv(leader), "es")} al mes` +
          (times && times >= 2 ? `, ${times} veces más que tú.` : mine >= 1 ? "." : "; tú casi no recibes visitas todavía."),
        en:
          `Today ${siteName(leader.domain)} gets the most visits from Google: about ${visitsText(etv(leader), "en")} a month` +
          (times && times >= 2 ? `, ${times} times more than you.` : mine >= 1 ? "." : "; you barely get any visits yet."),
      });
    }
  } else if (withData.length) {
    out.push({
      es: "Por ahora ni tú ni tu competencia reciben visitas medibles desde Google en tu país: quien empiece a escribir primero se lleva esas búsquedas.",
      en: "For now neither you nor your competitors get measurable visits from Google in your country: whoever starts writing first takes those searches.",
    });
  }

  // 2) Cómo cambió cada uno en un año: "Cormetal pasó de 20 a 45 visitas al mes; tú de 1 a 3".
  const end = latestMonth(report.domains);
  const rivalParts = rivals.map((d) => ({ d, delta: trafficDelta(d, 12, end) })).filter((x): x is { d: TrafficDomain; delta: { from: number; to: number } } => x.delta !== null);
  const youDelta = you && hasData(you) ? trafficDelta(you, 12, end) : null;
  if (rivalParts.length || youDelta) {
    const parts = rivalParts.map(({ d, delta }) => changeText(siteName(d.domain), delta));
    if (youDelta)
      parts.push(
        rivalParts.length
          ? changeText(null, youDelta)
          : unchanged(youDelta)
            ? { es: `te quedaste en ${visitsText(youDelta.to, "es")} visitas al mes`, en: `you stayed at ${visitsText(youDelta.to, "en")} visits a month` }
            : { es: `pasaste de ${visitsText(youDelta.from, "es")} a ${visitsText(youDelta.to, "es")} visitas al mes`, en: `you went from ${visitsText(youDelta.from, "en")} to ${visitsText(youDelta.to, "en")} visits a month` },
      );
    out.push({ es: `En un año, ${parts.map((p) => p.es).join("; ")}.`, en: `Over a year, ${parts.map((p) => p.en).join("; ")}.` });
  }

  // 3) Quién crece más rápido (de los que tenían visitas hace un año).
  const growing = rivalParts.filter(({ delta }) => delta.to >= 5 && delta.to >= 2 * Math.max(1, delta.from)).sort((a, b) => b.delta.to - a.delta.to)[0];
  if (growing)
    out.push({
      es: `${siteName(growing.d.domain)} está creciendo rápido: revisa sus mejores páginas (abajo) para ver sobre qué escribe.`,
      en: `${siteName(growing.d.domain)} is growing fast: check its best pages (below) to see what it writes about.`,
    });

  // 4) Sin datos.
  if (noData.length) {
    const names = noData.map((d) => (d.isYou ? (d.domain + " (tú)") : d.domain));
    const namesEn = noData.map((d) => (d.isYou ? (d.domain + " (you)") : d.domain));
    out.push({
      es: `Sin datos de ${names.join(", ")}: ${noData.length === 1 ? "su página es muy nueva o muy chica" : "sus páginas son muy nuevas o muy chicas"} para que DataForSEO la${noData.length === 1 ? "" : "s"} mida. No es un error.`,
      en: `No data for ${namesEn.join(", ")}: ${noData.length === 1 ? "the site is" : "the sites are"} too new or too small for DataForSEO to measure. It's not an error.`,
    });
  }
  return out;
}

/** Lee un reporte guardado; null si no tiene la forma esperada. Tolera campos que falten. */
export function readTrafficReport(json: unknown): TrafficReport | null {
  const r = obj(json);
  if (!Array.isArray(r.domains)) return null;
  const readMonth = (v: unknown): TrafficMonth | null => {
    const m = obj(v);
    const month = str(m.month);
    if (!MONTH_RE.test(month)) return null;
    return { month, etv: nonNeg(m.etv), keywords: nonNeg(m.keywords), top3: nonNeg(m.top3), top10: nonNeg(m.top10), value: nonNeg(m.value) };
  };
  const domains: TrafficDomain[] = arr(r.domains)
    .map((raw) => {
      const d = obj(raw);
      const domain = str(d.domain);
      const n = d.now && typeof d.now === "object" ? obj(d.now) : null;
      const history = arr(d.history)
        .map(readMonth)
        .filter((m): m is TrafficMonth => m !== null)
        .sort((a, b) => a.month.localeCompare(b.month));
      const pages: TrafficPage[] = arr(d.pages)
        .map((raw2) => {
          const p = obj(raw2);
          return {
            url: str(p.url),
            etv: nonNeg(p.etv),
            keywords: nonNeg(p.keywords),
            top3: nonNeg(p.top3),
            value: nonNeg(p.value),
            topKeyword: str(p.topKeyword) || null,
            topic: str(p.topic) || null,
          };
        })
        .filter((p) => p.url);
      const now: TrafficNow | null = n
        ? { etv: nonNeg(n.etv), keywords: nonNeg(n.keywords), top3: nonNeg(n.top3), top10: nonNeg(n.top10), value: nonNeg(n.value), month: MONTH_RE.test(str(n.month)) ? str(n.month) : null }
        : nowFromHistory(history);
      return { domain, isYou: d.isYou === true, now, pages, history, ...(d.failed === true ? { failed: true } : {}) };
    })
    .filter((d) => d.domain);
  if (!domains.length) return null;
  const loc = r.location && typeof r.location === "object" ? obj(r.location) : null;
  const location: CompetitorsLocation | null = loc
    ? {
        code: num(loc.code),
        name: str(loc.name),
        local: loc.local === true,
        countryCode: num(loc.countryCode) ?? 0,
        countryName: str(loc.countryName),
        countryIso: str(loc.countryIso),
        language: str(loc.language) || "es",
      }
    : null;
  const notes: BiText[] = arr(r.notes)
    .map((x) => obj(x))
    .filter((x) => typeof x.es === "string" && typeof x.en === "string")
    .map((x) => ({ es: x.es as string, en: x.en as string }));
  return {
    domain: str(r.domain) || (domains.find((d) => d.isYou)?.domain ?? ""),
    country: str(r.country) || location?.countryName || "",
    location,
    domains,
    notes,
    cost: num(r.cost) ?? 0,
    createdAt: str(r.createdAt),
  };
}

// ---------- Llamadas a DataForSEO ----------

type RunInput = {
  website: string;
  locationCode: number | null;
  locationName: string;
  language: string;
  /** Hasta 3 competidores con sus búsquedas conocidas (pickTrafficCompetitors). */
  competitors: { domain: string; top: RankedKeyword[] }[];
  now?: Date;
};

/** Hace la revisión completa: 1 + N llamadas de historial y N de páginas, todas a la vez (unos USD 0.05 a 0.10). */
export async function runTrafficReport(input: RunInput): Promise<TrafficReport> {
  const self = normalizeDomain(input.website);
  if (!self) throw bi("La dirección de tu página web no parece válida. Revísala en Ajustes del negocio.", "Your website address doesn't look valid. Check it in Business settings.");
  const location = await resolveLocation(input.locationCode, input.locationName, input.language);
  const base = { location_code: location.countryCode, language_code: location.language };
  const dateFrom = historyStart(input.now ?? new Date());
  const rivals = input.competitors
    .map((c) => ({ ...c, domain: normalizeDomain(c.domain) ?? "" }))
    .filter((c, i, list) => c.domain && !sameSite(c.domain, self) && list.findIndex((o) => o.domain === c.domain) === i)
    .slice(0, TRAFFIC_MAX_COMPETITORS);
  const targets = [{ domain: self, isYou: true, top: [] as RankedKeyword[] }, ...rivals.map((c) => ({ ...c, isYou: false }))];

  const history = (target: string) =>
    dfsPost<unknown>("/dataforseo_labs/google/historical_rank_overview/live", { target, ...base, date_from: dateFrom });
  const pages = (target: string) =>
    dfsPost<unknown>("/dataforseo_labs/google/relevant_pages/live", {
      target,
      ...base,
      item_types: ["organic"],
      limit: TRAFFIC_PAGES_LIMIT,
      order_by: ["metrics.organic.etv,desc"],
    });

  // Todas a la vez; si fallan todas (sin saldo, clave mala…) se avisa el error.
  const [hist, pgs] = await Promise.all([Promise.allSettled(targets.map((t) => history(t.domain))), Promise.allSettled(rivals.map((c) => pages(c.domain)))]);
  const all = [...hist, ...pgs];
  const firstError = all.find((x): x is PromiseRejectedResult => x.status === "rejected");
  if (firstError && all.every((x) => x.status === "rejected")) throw firstError.reason;

  const notes: BiText[] = [];
  if (location.language !== input.language)
    notes.push({
      es: `DataForSEO no tiene datos en ${input.language === "en" ? "inglés" : "español"} para ${location.countryName}; se usó "${location.language}".`,
      en: `DataForSEO has no ${input.language === "en" ? "English" : "Spanish"} data for ${location.countryName}; used "${location.language}".`,
    });
  let cost = 0;
  const domains: TrafficDomain[] = targets.map((t, i) => {
    const h = hist[i];
    let months: TrafficMonth[] = [];
    let failed = false;
    if (h.status === "fulfilled") {
      cost += h.value.cost;
      months = parseHistory(h.value.result);
    } else {
      failed = true;
      notes.push({ es: `No se pudo leer el historial de ${t.domain}.`, en: `Couldn't read ${t.domain}'s history.` });
    }
    let list: TrafficPage[] = [];
    if (!t.isYou) {
      const p = pgs[i - 1];
      if (p?.status === "fulfilled") {
        cost += p.value.cost;
        list = parseRelevantPages(p.value.result, t.top);
      } else if (p) notes.push({ es: `No se pudieron leer las mejores páginas de ${t.domain}.`, en: `Couldn't read ${t.domain}'s best pages.` });
    }
    return { domain: t.domain, isYou: t.isYou, now: nowFromHistory(months), pages: list, history: months, ...(failed ? { failed: true } : {}) };
  });

  return {
    domain: self,
    country: location.countryName,
    location,
    domains,
    notes,
    cost: Math.round(cost * 10000) / 10000,
    createdAt: new Date().toISOString(),
  };
}

/** El tope del eje de la gráfica: el primer 1, 2 o 5 × 10ⁿ que alcanza al valor más alto (mínimo 5). */
export function niceMax(v: number): number {
  if (!Number.isFinite(v) || v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].map((m) => m * p).find((x) => x >= v) ?? 10 * p);
}
