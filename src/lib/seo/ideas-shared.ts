// «Ideas de palabras» (como el «Keyword Magic Tool» de Semrush): a partir de una palabra (ej. «techos»), cientos de
// búsquedas que la contienen, con búsquedas al mes, dificultad, intención y CPC, para filtrar (preguntas, fáciles,
// para vender) y seguir las mejores. Datos de DataForSEO Labs en el país de la zona principal:
// keyword_suggestions (las que contienen la palabra; hasta IDEAS_LIMIT) y, si salen muy pocas, keyword_ideas (las del
// mismo tema aunque no la contengan). Una llamada ≈ US$0.012 + US$0.00012 por palabra (300 palabras ≈ US$0.05).
// PURO (sin red ni servidor): lo usa también la tabla del navegador (IdeasTable). La llamada está en ideas.ts.
// Se prueba en tests/seo-ideas.test.ts.
import { asIntent, type KeywordOverview, labsCost, sellsIntent } from "@/lib/seo/labs-shared";

/** Minúsculas, sin acentos ni signos (igual que norm de writer.ts, que no se puede usar en el navegador). */
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export const IDEAS_KIND = "ideas";
/** Palabras que se piden de una vez (las más buscadas primero). */
export const IDEAS_LIMIT = 300;
/** Si salen menos que esto, se buscan también las del mismo tema (keyword_ideas). */
export const IDEAS_FEW = 40;
/** Cuántas búsquedas de ideas se guardan (para volver a verlas sin pagar). */
export const IDEAS_KEEP = 8;

export const ideasCostEstimate = () => labsCost(IDEAS_LIMIT);

export type IdeaRow = KeywordOverview;

export type IdeasReport = {
  seed: string;
  country: string;
  language: string;
  /** Cuántas hay en total en DataForSEO (se traen las IDEAS_LIMIT más buscadas). */
  total: number | null;
  rows: IdeaRow[];
  /** También se trajeron ideas del mismo tema (keyword_ideas) porque salieron pocas. */
  related: boolean;
  cost: number;
  createdAt: string;
};

// ---------- Filtros ----------

export type IdeaFilter = "all" | "questions" | "easy" | "buyers" | "local";

const QUESTION_RE = /^(como|que|cual|cuales|cuanto|cuanta|cuantos|cuantas|por que|porque|donde|cuando|quien|quienes|es|son|puedo|se puede|debo|how|what|which|why|when|where|who|can|do|does|is|are|should|will)\b/;

/** ¿Es una pregunta? (empieza como pregunta, en español o inglés). */
export const isQuestion = (keyword: string) => QUESTION_RE.test(norm(keyword));

/** ¿Nombra un lugar? («cerca de mí», «near me» o alguna de las zonas del negocio). */
export function isLocal(keyword: string, places: string[] = []): boolean {
  const k = ` ${norm(keyword)} `;
  if (/ (cerca de mi|cerca de aqui|near me|nearby|en mi zona|local) /.test(k)) return true;
  return places.map((p) => norm(p)).filter((p) => p.length >= 3).some((p) => k.includes(` ${p} `));
}

/** Aplica el filtro, las palabras que debe tener o no tener y el mínimo de búsquedas al mes. */
export function filterIdeas(rows: IdeaRow[], opts: { filter?: IdeaFilter; include?: string; exclude?: string; minVolume?: number; places?: string[] }): IdeaRow[] {
  const inc = norm(opts.include ?? "")
    .split(" ")
    .filter(Boolean);
  const exc = norm(opts.exclude ?? "")
    .split(" ")
    .filter(Boolean);
  const min = Math.max(0, opts.minVolume ?? 0);
  return rows.filter((r) => {
    const k = ` ${norm(r.keyword)} `;
    if (inc.some((w) => !k.includes(` ${w}`))) return false;
    if (exc.some((w) => k.includes(` ${w}`))) return false;
    if (min && (r.volume ?? 0) < min) return false;
    switch (opts.filter ?? "all") {
      case "questions":
        return isQuestion(r.keyword);
      case "easy":
        return r.difficulty !== null && r.difficulty < 30;
      case "buyers":
        return sellsIntent(r.intent);
      case "local":
        return isLocal(r.keyword, opts.places);
      default:
        return true;
    }
  });
}

export type IdeaSort = "volume" | "difficulty" | "cpc";

/** Ordena: más búsquedas, más fácil o más CPC primero. Los que no tienen el dato van al final. */
export function sortIdeas(rows: IdeaRow[], by: IdeaSort): IdeaRow[] {
  const list = [...rows];
  if (by === "difficulty") return list.sort((a, b) => (a.difficulty ?? 101) - (b.difficulty ?? 101) || (b.volume ?? -1) - (a.volume ?? -1));
  if (by === "cpc") return list.sort((a, b) => (b.cpc ?? -1) - (a.cpc ?? -1) || (b.volume ?? -1) - (a.volume ?? -1));
  return list.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || a.keyword.localeCompare(b.keyword));
}

/** Cuántas hay de cada filtro (para los botones). */
export function filterCounts(rows: IdeaRow[], places: string[] = []): Record<IdeaFilter, number> {
  return {
    all: rows.length,
    questions: rows.filter((r) => isQuestion(r.keyword)).length,
    easy: rows.filter((r) => r.difficulty !== null && r.difficulty < 30).length,
    buyers: rows.filter((r) => sellsIntent(r.intent)).length,
    local: rows.filter((r) => isLocal(r.keyword, places)).length,
  };
}

/** La palabra semilla como la acepta Labs: minúsculas, sin símbolos raros, máximo 6 palabras. */
export function cleanSeed(raw: string): string {
  return raw
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'&.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 6)
    .join(" ")
    .slice(0, 60)
    .trim();
}

// ---------- Guardado ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Lee unas ideas guardadas sin confiar en su forma; null si no son válidas. */
export function readIdeasReport(json: unknown): IdeasReport | null {
  const r = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  if (!r || !str(r.seed) || !Array.isArray(r.rows)) return null;
  const rows: IdeaRow[] = r.rows
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      keyword: str(x.keyword),
      volume: num(x.volume),
      cpc: num(x.cpc),
      difficulty: num(x.difficulty),
      intent: asIntent(x.intent),
      trend: Array.isArray(x.trend) ? x.trend.map((v) => num(v) ?? 0).slice(-12) : [],
    }))
    .filter((x) => x.keyword);
  return { seed: str(r.seed), country: str(r.country), language: str(r.language), total: num(r.total), rows, related: r.related === true, cost: num(r.cost) ?? 0, createdAt: str(r.createdAt) };
}
