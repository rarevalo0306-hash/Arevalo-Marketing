// Palabras clave con datos reales de Google Ads (DataForSEO): cuánta gente busca cada palabra al mes,
// cuánto pagan los anunciantes por clic, la competencia en anuncios y los últimos 12 meses.
// Cada corrida hace, por cada zona elegida, 1 llamada "live" de volúmenes (unos $0.075) y, solo para la zona
// principal, 1 llamada más de ideas nuevas. Con 3 zonas: 4 llamadas ≈ $0.30.
import { intlLocale, type UiLang } from "@/lib/i18n";
import { dfsPost, type Zone } from "@/lib/seo/dataforseo";

export type Competition = "high" | "medium" | "low";

export type KwRow = {
  keyword: string;
  /** Búsquedas al mes (promedio de los últimos 12 meses). */
  volume: number | null;
  /** Lo que pagan los anunciantes por clic, en USD. */
  cpc: number | null;
  /** Competencia en los anuncios de Google (no en los resultados normales). */
  competition: Competition | null;
  /** 0 a 100. */
  competitionIndex: number | null;
  /** Búsquedas de cada mes, del más viejo al más nuevo (hasta 12). */
  trend: number[];
};

export type KeywordsReport = {
  location: string;
  locationCode: number;
  language: "es" | "en";
  /** Las palabras medidas: las que sigue el negocio y las del estudio. */
  keywords: KwRow[];
  /** Ideas nuevas de Google Ads, las de más búsquedas primero, sin repetir las medidas. */
  ideas: KwRow[];
  /** Lo que costó en DataForSEO (USD). */
  cost: number;
  createdAt: string;
  /** La búsqueda de ideas falló (los volúmenes sí se guardaron). */
  ideasFailed?: boolean;
};

export const MAX_TRACKED = 25;
export const MAX_MEASURED = 100;
/** keywords_for_keywords acepta hasta 20; con 5 bastan para buenas ideas. */
export const MAX_SEEDS = 5;
export const MAX_IDEAS = 50;
/** Precio aproximado de cada llamada "live" de Google Ads en DataForSEO (USD). */
export const KEYWORDS_CALL_COST = 0.075;

/** Costo estimado de actualizar: una llamada de volúmenes por zona + una de ideas (solo la zona principal). */
export function keywordsCostEstimate(zones: number): number {
  return Math.round(KEYWORDS_CALL_COST * (Math.max(1, zones) + 1) * 1000) / 1000;
}

/** Así viene cada palabra de search_volume y keywords_for_keywords. */
type ApiMonth = { year?: unknown; month?: unknown; search_volume?: unknown };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/**
 * Deja la palabra como la acepta Google Ads: minúsculas, sin símbolos raros ni emojis,
 * máximo 10 palabras y 80 letras. Vacía si no queda nada.
 */
export function cleanKeyword(k: string): string {
  return k
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'&.\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 10)
    .join(" ")
    .slice(0, 80)
    .trim();
}

/** Las palabras sin repetir (sin importar mayúsculas), limpias y hasta `max`. */
export function uniqueKeywords(list: string[], max = MAX_MEASURED): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const k = cleanKeyword(raw);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= max) break;
  }
  return out;
}

/** Los volúmenes de cada mes ordenados del más viejo al más nuevo (la API los manda del más nuevo al más viejo). */
export function monthlyTrend(months: unknown, n = 12): number[] {
  if (!Array.isArray(months)) return [];
  return months
    .filter((m): m is ApiMonth => typeof m === "object" && m !== null)
    .map((m) => ({ at: Number(m.year) * 12 + Number(m.month), v: num(m.search_volume) ?? 0 }))
    .filter((m) => Number.isFinite(m.at))
    .sort((a, b) => a.at - b.at)
    .slice(-n)
    .map((m) => m.v);
}

const asCompetition = (v: unknown): Competition | null => {
  const c = typeof v === "string" ? v.toLowerCase() : "";
  return c === "high" || c === "medium" || c === "low" ? c : null;
};

/** Convierte un resultado de la API en una fila; null si no tiene palabra. */
export function normalizeRow(item: unknown): KwRow | null {
  if (typeof item !== "object" || item === null) return null;
  const r = item as Record<string, unknown>;
  const keyword = typeof r.keyword === "string" ? r.keyword.trim().toLowerCase() : "";
  if (!keyword) return null;
  const index = num(r.competition_index);
  return {
    keyword,
    volume: num(r.search_volume),
    cpc: num(r.cpc),
    competition: asCompetition(r.competition),
    competitionIndex: index === null ? null : Math.min(100, Math.round(index)),
    trend: monthlyTrend(r.monthly_searches),
  };
}

/** De más búsquedas a menos; las que no tienen dato al final. Empate: menos competencia primero. */
export function byVolume(a: KwRow, b: KwRow): number {
  return (b.volume ?? -1) - (a.volume ?? -1) || (a.competitionIndex ?? 101) - (b.competitionIndex ?? 101) || a.keyword.localeCompare(b.keyword);
}

/** Las mejores ideas: con búsquedas, sin repetir y sin las que ya se miden. */
export function pickIdeas(ideas: KwRow[], exclude: string[], n = MAX_IDEAS): KwRow[] {
  const seen = new Set(exclude.map((k) => k.trim().toLowerCase()));
  const out: KwRow[] = [];
  for (const r of [...ideas].filter((r) => (r.volume ?? 0) > 0).sort(byVolume)) {
    const k = r.keyword.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

/** Las semillas para buscar ideas: las palabras que sigue el negocio con más búsquedas, o las primeras. */
export function pickSeeds(tracked: string[], measured: KwRow[], n = MAX_SEEDS): string[] {
  const volume = new Map(measured.map((r) => [r.keyword, r.volume ?? 0]));
  const list = uniqueKeywords(tracked, MAX_TRACKED * 2);
  return list
    .map((k, i) => ({ k, i, v: volume.get(k) ?? 0 }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .slice(0, n)
    .map((x) => x.k);
}

export type TrendDirection = "up" | "down" | "flat";

/** ¿Suben o bajan las búsquedas? Compara los últimos 3 meses con los 3 anteriores (cambio de 10% o más). */
export function trendDirection(trend: number[]): TrendDirection {
  if (trend.length < 6) return "flat";
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const last = sum(trend.slice(-3));
  const prev = sum(trend.slice(-6, -3));
  if (prev === 0) return last > 0 ? "up" : "flat";
  const change = (last - prev) / prev;
  return change >= 0.1 ? "up" : change <= -0.1 ? "down" : "flat";
}

/** El costo para mostrar: "$0.15", "$0.075". */
export function costText(cost: number): string {
  const c = Number.isFinite(cost) && cost > 0 ? cost : 0;
  const three = c.toFixed(3);
  return `$${three.endsWith("0") ? c.toFixed(2) : three}`;
}

/** Para mostrar búsquedas al mes: "1.300" en español, "1,300" en inglés. */
export const volumeFormat = (lang: UiLang) => new Intl.NumberFormat(intlLocale(lang), { useGrouping: "always" });

const readRow = (v: unknown): KwRow | null => {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.keyword !== "string" || !r.keyword.trim()) return null;
  return {
    keyword: r.keyword.trim(),
    volume: num(r.volume),
    cpc: num(r.cpc),
    competition: asCompetition(r.competition),
    competitionIndex: num(r.competitionIndex),
    trend: Array.isArray(r.trend) ? r.trend.map((x) => num(x) ?? 0).slice(-12) : [],
  };
};

/** Lee un reporte guardado; null si falta o tiene otro formato. */
export function readKeywordsReport(json: unknown): KeywordsReport | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const r = json as Record<string, unknown>;
  if (!Array.isArray(r.keywords)) return null;
  const rows = (v: unknown) => (Array.isArray(v) ? v.map(readRow).filter((x): x is KwRow => x !== null) : []);
  return {
    location: typeof r.location === "string" ? r.location : "",
    locationCode: typeof r.locationCode === "number" ? r.locationCode : 0,
    language: r.language === "en" ? "en" : "es",
    keywords: rows(r.keywords),
    ideas: rows(r.ideas),
    cost: num(r.cost) ?? 0,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
    ...(r.ideasFailed === true ? { ideasFailed: true } : {}),
  };
}

/** Busca una palabra en el reporte (medidas e ideas), sin importar mayúsculas. */
export function reportLookup(report: KeywordsReport | null): Map<string, KwRow> {
  const map = new Map<string, KwRow>();
  if (!report) return map;
  for (const r of [...report.ideas, ...report.keywords]) map.set(r.keyword.trim().toLowerCase(), r);
  return map;
}

/**
 * Mide las palabras (las que sigue el negocio + las del estudio, hasta 100) y busca ideas nuevas
 * a partir de hasta 5 semillas. Docs: docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/live
 * y docs.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live (máx. 12 llamadas por minuto).
 */
export async function keywordReport(opts: {
  keywords: string[];
  seeds: string[];
  locationCode: number;
  locationName?: string;
  language: "es" | "en";
  /** Buscar ideas nuevas (cuesta otra llamada). Solo para la zona principal. Por defecto sí. */
  ideas?: boolean;
}): Promise<KeywordsReport> {
  const keywords = uniqueKeywords(opts.keywords, MAX_MEASURED);
  const base = { location_code: opts.locationCode, language_code: opts.language };
  const volumes = await dfsPost<unknown>("/keywords_data/google_ads/search_volume/live", { ...base, keywords }, 120_000);
  const found = new Map(volumes.result.map(normalizeRow).filter((r): r is KwRow => r !== null).map((r) => [r.keyword, r]));
  // Las que Google no devolvió quedan sin datos (muy pocas búsquedas o símbolos que no acepta).
  const rows = keywords.map((k) => found.get(k) ?? { keyword: k, volume: null, cpc: null, competition: null, competitionIndex: null, trend: [] });
  let cost = volumes.cost;

  let ideas: KwRow[] = [];
  let ideasFailed = false;
  const seeds = pickSeeds(opts.seeds.length ? opts.seeds : keywords, rows);
  if (seeds.length && opts.ideas !== false) {
    try {
      const r = await dfsPost<unknown>("/keywords_data/google_ads/keywords_for_keywords/live", { ...base, keywords: seeds, sort_by: "search_volume" }, 120_000);
      cost += r.cost;
      ideas = pickIdeas(r.result.map(normalizeRow).filter((x): x is KwRow => x !== null), keywords);
    } catch {
      ideasFailed = true;
    }
  }

  return {
    location: opts.locationName ?? "",
    locationCode: opts.locationCode,
    language: opts.language,
    keywords: rows.sort(byVolume),
    ideas,
    cost: Math.round(cost * 10000) / 10000,
    createdAt: new Date().toISOString(),
    ...(ideasFailed ? { ideasFailed: true } : {}),
  };
}

// ---------- Varias zonas ----------

/**
 * Las búsquedas al mes de una palabra en cada zona, en el orden de las zonas.
 * undefined = esa zona no tiene reporte o no midió esa palabra; null = Google no tiene datos.
 */
export function zoneVolumes(keyword: string, zones: Zone[], byZone: Map<number, KeywordsReport>): (number | null | undefined)[] {
  const key = keyword.trim().toLowerCase();
  return zones.map((z) => {
    const report = byZone.get(z.code);
    if (!report) return undefined;
    const row = reportLookup(report).get(key);
    return row ? row.volume : undefined;
  });
}

/** Suma de las búsquedas de las zonas que tienen el dato; null si ninguna lo tiene. */
export function zoneTotal(volumes: (number | null | undefined)[]): number | null {
  const known = volumes.filter((v): v is number => typeof v === "number");
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

export type ZoneKwRow = {
  /** Los datos de la zona principal (tendencia, competencia, CPC). */
  row: KwRow;
  /** Búsquedas al mes en cada zona (ver zoneVolumes). */
  volumes: (number | null | undefined)[];
};

/**
 * Une las palabras de todas las zonas: tendencia, competencia y CPC de la zona principal, y una columna
 * de búsquedas por zona. Ordenadas por las búsquedas en la zona principal y luego por el total.
 */
export function mergeZoneRows(keywords: string[], zones: Zone[], byZone: Map<number, KeywordsReport>): ZoneKwRow[] {
  const main = zones[0] ? byZone.get(zones[0].code) : undefined;
  const lookup = reportLookup(main ?? null);
  const seen = new Set<string>();
  const out: ZoneKwRow[] = [];
  for (const k of keywords) {
    const key = k.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const row = lookup.get(key) ?? { keyword: key, volume: null, cpc: null, competition: null, competitionIndex: null, trend: [] };
    out.push({ row, volumes: zoneVolumes(key, zones, byZone) });
  }
  return out.sort((a, b) => (b.row.volume ?? -1) - (a.row.volume ?? -1) || (zoneTotal(b.volumes) ?? -1) - (zoneTotal(a.volumes) ?? -1) || a.row.keyword.localeCompare(b.row.keyword));
}
