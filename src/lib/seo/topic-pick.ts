// «Que la IA elija el tema» del escritor de artículos: elige la mejor búsqueda para el próximo artículo con lo que
// Matya ya sabe (sin gastar nada): palabras clave, lo que tiene la competencia (gap), las preguntas que hace la gente,
// el plan de acción y lo que vende el negocio (estudio). Quita lo que ya tiene un artículo o ya está en la web.
// Todo es puro (se prueba en tests/seo-topic-pick.test.ts); la carga está en topic-pick-load.ts.
import { isRelevantKeyword } from "@/lib/seo/gap";
import { norm, stems } from "@/lib/seo/writer";

export type Bi = { es: string; en: string };
export type TopicSource = "gap" | "question" | "plan" | "keywords" | "study";

export type TopicCandidate = {
  keyword: string;
  source: TopicSource;
  /** Búsquedas al mes (si se sabe). */
  volume: number | null;
  /** Puntos extra de la fuente: oportunidad del gap, importancia de la tarea del plan… */
  boost?: number;
  /** Para la razón: posición de la competencia, título de la tarea… */
  note?: string;
};

export type TopicPick = { keyword: string; reason: Bi; sources: TopicSource[]; score: number };

/** Lo que vale cada fuente: el plan y el gap ya son oportunidades revisadas; el estudio es lo más general. */
const SOURCE_POINTS: Record<TopicSource, number> = { plan: 4, gap: 3.5, question: 3, keywords: 2, study: 1 };

/** Largo útil: ni una sola palabra suelta ni una frase larguísima. */
function goodLength(k: string): boolean {
  const words = k.split(/\s+/).filter(Boolean).length;
  return k.length >= 4 && k.length <= 80 && words >= 2 && words <= 12;
}

/**
 * ¿Ese tema ya está cubierto por un texto (artículo o página)? Sí si todas sus palabras con sentido aparecen en el
 * texto, o si comparten casi todas (3 de cada 4, en las dos direcciones), para no escribir dos artículos de lo mismo.
 */
export function coveredBy(keyword: string, text: string): boolean {
  const k = new Set(stems(keyword));
  const t = new Set(stems(text));
  if (!k.size || !t.size) return false;
  let shared = 0;
  for (const w of k) if (t.has(w)) shared++;
  if (shared === k.size) return true;
  return shared >= 2 && shared / Math.max(k.size, t.size) >= 0.75;
}

const fmt = (n: number, lang: "es" | "en") => new Intl.NumberFormat(lang === "en" ? "en-US" : "es").format(n);

/** La razón en una línea, según de dónde salió el tema. */
export function topicReason(c: TopicCandidate, sources: TopicSource[]): Bi {
  const vol = c.volume && c.volume > 0 ? c.volume : null;
  const people = vol ? { es: `Unas ${fmt(vol, "es")} personas lo buscan al mes`, en: `About ${fmt(vol, "en")} people search it each month` } : null;
  const tail = { es: " y todavía no tienes un artículo sobre esto.", en: " and you don't have an article about it yet." };
  const join = (a: Bi, b: Bi): Bi => ({ es: a.es + b.es, en: a.en + b.en });
  const main = sources.includes("gap") ? "gap" : c.source;
  if (main === "gap")
    return join(people ?? { es: "Tu competencia sale en Google con esta búsqueda", en: "Your competitors show up on Google for this search" }, people ? { es: ", tu competencia sale en Google y tú no.", en: ", your competitors show up on Google and you don't." } : { es: " y tú no.", en: " and you don't." });
  if (main === "question")
    return { es: "La gente le pregunta esto a Google y ni tu web ni tus artículos lo responden todavía.", en: "People ask Google this and neither your website nor your articles answer it yet." };
  if (main === "plan")
    return {
      es: `${people ? `${people.es} y está en tu plan de acción` : "Está en tu plan de acción"}${c.note ? `: «${c.note}»` : ""}.`,
      en: `${people ? `${people.en} and it's in your action plan` : "It's in your action plan"}${c.note ? `: “${c.note}”` : ""}.`,
    };
  if (main === "keywords") return join(people ?? { es: "Es una de tus palabras clave", en: "It's one of your keywords" }, tail);
  return { es: "Es parte de lo que vendes y todavía no tienes un artículo sobre esto.", en: "It's part of what you sell and you don't have an article about it yet." };
}

/**
 * Elige el mejor tema. Se juntan las ideas repetidas (sin importar mayúsculas ni acentos): cada fuente extra suma.
 * Se quitan las que no tienen que ver con el negocio, las del nombre del negocio, las que ya tienen artículo y las
 * que ya responde la web. Gana la de más puntos: fuente + búsquedas al mes (escala logarítmica) + puntos extra.
 */
export function pickTopic(
  candidates: TopicCandidate[],
  opts: { written: string[]; site: string[]; vocab: string[]; brand?: string; skip?: string[] },
): { pick: TopicPick; others: TopicPick[] } | null {
  const brand = opts.brand ? norm(opts.brand) : "";
  const skip = opts.skip ?? [];
  const merged = new Map<string, { best: TopicCandidate; sources: Set<TopicSource>; volume: number | null; boost: number }>();
  for (const c of candidates) {
    const keyword = c.keyword.replace(/[¿?¡!]/g, "").replace(/\s+/g, " ").trim();
    // Singular y plural, con o sin acentos, son el mismo tema («portón corredizo» = «portones corredizos»).
    const key = [...new Set(stems(keyword))].sort().join(" ") || norm(keyword);
    if (!key || !goodLength(keyword) || skip.some((x) => norm(x) === norm(keyword) || coveredBy(keyword, x))) continue;
    if (brand && brand.length >= 4 && key.includes(brand)) continue;
    if (!isRelevantKeyword(keyword, opts.vocab)) continue;
    const prev = merged.get(key);
    const cand = { ...c, keyword };
    if (!prev) {
      merged.set(key, { best: cand, sources: new Set([c.source]), volume: c.volume, boost: c.boost ?? 0 });
      continue;
    }
    prev.sources.add(c.source);
    prev.volume = Math.max(prev.volume ?? 0, c.volume ?? 0) || prev.volume || c.volume;
    prev.boost = Math.max(prev.boost, c.boost ?? 0);
    if (SOURCE_POINTS[c.source] > SOURCE_POINTS[prev.best.source]) prev.best = cand;
  }
  const scored: TopicPick[] = [];
  for (const m of merged.values()) {
    const k = m.best.keyword;
    if (opts.written.some((w) => coveredBy(k, w))) continue;
    if (opts.site.some((t) => coveredBy(k, t))) continue;
    const sources = [...m.sources];
    const base = Math.max(...sources.map((x) => SOURCE_POINTS[x]));
    const score = base + (sources.length - 1) * 1.5 + Math.log10((m.volume ?? 0) + 1) * 1.5 + m.boost;
    scored.push({ keyword: k, sources, score: Math.round(score * 100) / 100, reason: topicReason({ ...m.best, volume: m.volume }, sources) });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));
  return { pick: scored[0], others: scored.slice(1, 4) };
}

/** La palabra de una tarea del plan que abre el escritor («/seo/escribir?kw=…»), o "" si no es de esas. */
export function planKeyword(href: string): string {
  const m = /\/seo\/escribir\?(?:.*&)?kw=([^&#]*)/.exec(href);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1].replace(/\+/g, " ")).trim();
  } catch {
    return "";
  }
}
