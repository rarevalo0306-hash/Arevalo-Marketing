// DataForSEO Labs: lo que comparten varias secciones de SEO (precio, dificultad, intención y los datos de una palabra).
// PURO (sin red ni servidor): lo usan también los componentes del navegador. La llamada está en labs.ts.
// Labs trabaja por PAÍS (docs.dataforseo.com/v3/dataforseo_labs/locations_and_languages): la zona del negocio se
// convierte a su país con resolveLocation (competitors.ts).
// Precio (dataforseo.com/pricing/dataforseo-labs): US$0.012 por llamada + US$0.00012 por fila devuelta. Las palabras
// que Labs no tiene no vuelven y no se cobran.

export const LABS_TASK_COST = 0.012;
export const LABS_ITEM_COST = 0.00012;

/** Lo máximo que cuestan `calls` llamadas que devuelven `items` filas en total (USD, redondeado a milésimas hacia arriba). */
export function labsCost(items: number, calls = 1): number {
  const usd = Math.max(1, calls) * LABS_TASK_COST + Math.max(0, items) * LABS_ITEM_COST;
  // Sin el redondeo previo, 0.012 + 0.018 da 0.030000000000000002 y subiría a 0.031.
  return Math.ceil(Math.round(usd * 1e6) / 1e3) / 1000;
}

// ---------- Intención y dificultad ----------

export const SEARCH_INTENTS = ["informational", "navigational", "commercial", "transactional"] as const;
export type SearchIntent = (typeof SEARCH_INTENTS)[number];
export const asIntent = (v: unknown): SearchIntent | null => ((SEARCH_INTENTS as readonly unknown[]).includes(v) ? (v as SearchIntent) : null);

/** Lo que busca la gente con esa frase, en palabras simples. */
export const INTENT_LABEL: Record<SearchIntent, { es: string; en: string }> = {
  transactional: { es: "quieren comprar", en: "ready to buy" },
  commercial: { es: "comparan opciones", en: "comparing options" },
  informational: { es: "buscan información", en: "looking for info" },
  navigational: { es: "buscan un sitio", en: "looking for a site" },
};

/** ¿Esa búsqueda trae clientes (quieren comprar o están comparando)? */
export const sellsIntent = (i: SearchIntent | null | undefined) => i === "transactional" || i === "commercial";

export type DifficultyLevel = "easy" | "medium" | "hard";

/** Fácil (menos de 30), media (30 a 59) o difícil (60 o más). null sin dato. */
export function difficultyLevel(d: number | null | undefined): DifficultyLevel | null {
  if (typeof d !== "number" || !Number.isFinite(d)) return null;
  return d < 30 ? "easy" : d < 60 ? "medium" : "hard";
}

/** [estilo de la píldora, español, inglés]. */
export const DIFFICULTY_LABEL: Record<DifficultyLevel, [string, string, string]> = {
  easy: ["done", "fácil", "easy"],
  medium: ["partial", "media", "medium"],
  hard: ["failed", "difícil", "hard"],
};

// ---------- Lectura de la respuesta ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Los volúmenes de cada mes ordenados del más viejo al más nuevo (la API los manda del más nuevo al más viejo). */
export function monthlyTrend(months: unknown, n = 12): number[] {
  if (!Array.isArray(months)) return [];
  return months
    .filter((m): m is { year?: unknown; month?: unknown; search_volume?: unknown } => typeof m === "object" && m !== null)
    .map((m) => ({ at: Number(m.year) * 12 + Number(m.month), v: Math.max(0, num(m.search_volume) ?? 0) }))
    .filter((m) => Number.isFinite(m.at))
    .sort((a, b) => a.at - b.at)
    .slice(-n)
    .map((m) => m.v);
}

/** Los datos de una palabra según Labs (en el país). */
export type KeywordOverview = {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  /** 0 a 100 (escala logarítmica de DataForSEO): qué tan difícil es salir en la primera página. */
  difficulty: number | null;
  intent: SearchIntent | null;
  trend: number[];
};

/** Una palabra de Labs (keyword_overview, keyword_suggestions, keyword_ideas): todas traen la misma forma. null sin palabra. */
export function parseLabsItem(raw: unknown): KeywordOverview | null {
  const it = obj(raw);
  // keyword_suggestions trae la palabra arriba; otras respuestas la anidan en keyword_data.
  const data = Object.keys(obj(it.keyword_data)).length ? obj(it.keyword_data) : it;
  const keyword = typeof data.keyword === "string" ? data.keyword.replace(/\s+/g, " ").trim().toLowerCase() : "";
  if (!keyword) return null;
  const info = obj(data.keyword_info);
  const volume = num(info.search_volume);
  const cpc = num(info.cpc);
  const difficulty = num(obj(data.keyword_properties).keyword_difficulty);
  return {
    keyword,
    volume: volume !== null && volume >= 0 ? volume : null,
    cpc: cpc !== null && cpc >= 0 ? cpc : null,
    difficulty: difficulty !== null ? Math.max(0, Math.min(100, Math.round(difficulty))) : null,
    intent: asIntent(obj(data.search_intent_info).main_intent),
    trend: monthlyTrend(info.monthly_searches),
  };
}

/**
 * Lee keyword_overview: result[0].items[] con keyword, keyword_info (search_volume, cpc, monthly_searches),
 * keyword_properties.keyword_difficulty y search_intent_info.main_intent.
 * Docs: docs.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live
 */
export function parseKeywordOverview(result: unknown[]): KeywordOverview[] {
  return arr(obj(result[0]).items)
    .map(parseLabsItem)
    .filter((x): x is KeywordOverview => x !== null);
}

/**
 * Las palabras de TODOS los elementos de la respuesta, sin repetir (keyword_suggestions puede traer la palabra semilla
 * en un elemento y las ideas en otro). Devuelve también el total que dice tener DataForSEO.
 */
export function parseLabsItemsAll(result: unknown[]): { rows: KeywordOverview[]; total: number | null } {
  const seen = new Set<string>();
  const rows: KeywordOverview[] = [];
  let total: number | null = null;
  for (const el of arr(result)) {
    const o = obj(el);
    const t = num(o.total_count);
    if (t !== null) total = Math.max(total ?? 0, t);
    const seed = obj(o.seed_keyword_data);
    for (const raw of [...(Object.keys(seed).length ? [seed] : []), ...arr(o.items)]) {
      const r = parseLabsItem(raw);
      if (!r || seen.has(r.keyword)) continue;
      seen.add(r.keyword);
      rows.push(r);
    }
  }
  return { rows, total };
}

/** Máximo de palabras por llamada de keyword_overview. */
export const OVERVIEW_MAX = 700;
