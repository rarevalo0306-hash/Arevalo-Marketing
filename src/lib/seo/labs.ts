// DataForSEO Labs: la llamada keyword_overview. Lo puro (precios, etiquetas, lectura) está en labs-shared.ts.
import { dfsPost } from "@/lib/seo/dataforseo";
import { type KeywordOverview, OVERVIEW_MAX, parseKeywordOverview } from "@/lib/seo/labs-shared";

export * from "@/lib/seo/labs-shared";

/** Pide a Labs los datos de varias palabras en un país (una llamada). */
export async function keywordOverview(keywords: string[], where: { countryCode: number; language: string }): Promise<{ rows: KeywordOverview[]; cost: number }> {
  const list = [...new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))].slice(0, OVERVIEW_MAX);
  if (!list.length) return { rows: [], cost: 0 };
  const r = await dfsPost<unknown>("/dataforseo_labs/google/keyword_overview/live", { keywords: list, location_code: where.countryCode, language_code: where.language }, 120_000);
  return { rows: parseKeywordOverview(r.result), cost: r.cost };
}
