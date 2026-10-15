// «Ideas de palabras» (como el «Keyword Magic Tool» de Semrush): a partir de una palabra (ej. «techos»), cientos de
// búsquedas que la contienen, con búsquedas al mes, dificultad, intención y CPC, para filtrar (preguntas, fáciles,
// para vender) y seguir las mejores. Datos de DataForSEO Labs en el país de la zona principal:
// keyword_suggestions (las que contienen la palabra; hasta IDEAS_LIMIT) y, si salen muy pocas, keyword_ideas (las del
// mismo tema aunque no la contengan). Una llamada ≈ US$0.012 + US$0.00012 por palabra (300 palabras ≈ US$0.05).
// Lo puro (lectura, filtros) está en ideas-shared.ts (lo usa también el navegador) y se prueba en tests/seo-ideas.test.ts.
import { bi } from "@/lib/i18n";
import { resolveLocation } from "@/lib/seo/competitors";
import { dfsPost, type Zone } from "@/lib/seo/dataforseo";
import { IDEAS_FEW, IDEAS_LIMIT, type IdeasReport, cleanSeed, sortIdeas } from "@/lib/seo/ideas-shared";
import { parseLabsItemsAll } from "@/lib/seo/labs";

export * from "@/lib/seo/ideas-shared";

// ---------- Llamada ----------

/** Busca las ideas de una palabra en el país de la zona principal. */
export async function runIdeas(input: { seed: string; zone: Zone; language: string }): Promise<IdeasReport> {
  const seed = cleanSeed(input.seed);
  if (!seed) throw bi("Escribe una palabra para buscar ideas (ej.: lo que vendes).", "Type a word to look for ideas (e.g. what you sell).");
  const loc = await resolveLocation(input.zone.code, input.zone.name, input.language);
  const base = { location_code: loc.countryCode, language_code: loc.language };
  const first = await dfsPost<unknown>(
    "/dataforseo_labs/google/keyword_suggestions/live",
    { ...base, keyword: seed, include_seed_keyword: true, limit: IDEAS_LIMIT, order_by: ["keyword_info.search_volume,desc"] },
    120_000,
  );
  let cost = first.cost;
  let { rows, total } = parseLabsItemsAll(first.result);
  let related = false;
  if (rows.length < IDEAS_FEW) {
    try {
      const more = await dfsPost<unknown>("/dataforseo_labs/google/keyword_ideas/live", { ...base, keywords: [seed], limit: IDEAS_LIMIT - rows.length, order_by: ["keyword_info.search_volume,desc"] }, 120_000);
      cost += more.cost;
      const seen = new Set(rows.map((r) => r.keyword));
      const extra = parseLabsItemsAll(more.result).rows.filter((r) => !seen.has(r.keyword));
      rows = [...rows, ...extra];
      related = extra.length > 0;
      total = Math.max(total ?? 0, rows.length);
    } catch {
      /* con lo que haya */
    }
  }
  return { seed, country: loc.countryName, language: loc.language, total, rows: sortIdeas(rows, "volume"), related, cost: Math.round(cost * 10000) / 10000, createdAt: new Date().toISOString() };
}
