// «Tus temas» (como el «Keyword Strategy Builder» de Semrush): junta TODAS las búsquedas que la app ya conoce (las que
// sigues, las medidas e ideas, lo que tiene la competencia, Search Console, las preguntas de la gente y el estudio) y
// las agrupa por tema. Cada tema es UNA página: la que ya tienes y la cubre, o la que falta crear (página de servicio,
// de zona o artículo). No gasta en DataForSEO: la IA de textos agrupa (una llamada) y, sin IA, se agrupa por palabras.
// Todo lo de aquí es puro (se prueba en tests/seo-clusters.test.ts); la carga está en clusters-load.ts.
import { asIntent, type SearchIntent, sellsIntent } from "@/lib/seo/labs-shared";
import { coveredBy } from "@/lib/seo/topic-pick";
import { norm, stems } from "@/lib/seo/writer";

export type ClusterSource = "tracked" | "keywords" | "gap" | "gsc" | "question" | "study" | "rank";
export type PageKind = "service" | "area" | "article";

export type ClusterKeyword = {
  keyword: string;
  volume: number | null;
  difficulty: number | null;
  intent: SearchIntent | null;
  /** Tu mejor lugar en Google (posiciones o Search Console). */
  position: number | null;
  sources: ClusterSource[];
};

export type Bi = { es: string; en: string };

export type Cluster = {
  name: Bi;
  /** La búsqueda principal del tema (para el título de la página). */
  main: string;
  kind: PageKind;
  keywords: ClusterKeyword[];
  /** Búsquedas al mes de todo el tema (las que se saben). */
  volume: number;
  /** Dificultad promedio (pesada por búsquedas) o null. */
  difficulty: number | null;
  intent: SearchIntent | null;
  bestPosition: number | null;
  /** Tu página que ya trata del tema (si hay). */
  page: { url: string; label: string } | null;
  /** Un artículo tuyo que ya trata del tema (título). */
  article: string | null;
};

export type ClustersReport = {
  clusters: Cluster[];
  /** Cuántas búsquedas se agruparon. */
  total: number;
  /** "ai" = las agrupó la IA; "words" = por palabras en común (sin IA o si la IA falló). */
  by: "ai" | "words";
  createdAt: string;
};

/** Máximo de búsquedas que se agrupan (las de más búsquedas al mes primero). */
export const CLUSTER_MAX_KEYWORDS = 150;
export const CLUSTER_MAX = 15;

// ---------- Juntar las búsquedas ----------

const SOURCE_ORDER: ClusterSource[] = ["tracked", "gsc", "rank", "gap", "keywords", "question", "study"];

/** Une las búsquedas repetidas (sin importar mayúsculas ni acentos): el mejor dato de cada una y todas sus fuentes. */
export function mergeKeywords(list: (Partial<ClusterKeyword> & { keyword: string; source: ClusterSource })[], max = CLUSTER_MAX_KEYWORDS): ClusterKeyword[] {
  const map = new Map<string, ClusterKeyword>();
  for (const x of list) {
    const keyword = x.keyword.replace(/\s+/g, " ").trim().slice(0, 120);
    const key = norm(keyword);
    if (!key || key.length < 3) continue;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { keyword, volume: x.volume ?? null, difficulty: x.difficulty ?? null, intent: x.intent ?? null, position: x.position ?? null, sources: [x.source] });
      continue;
    }
    if (x.volume != null && (cur.volume === null || x.volume > cur.volume)) cur.volume = x.volume;
    if (cur.difficulty === null && x.difficulty != null) cur.difficulty = x.difficulty;
    if (cur.intent === null && x.intent) cur.intent = x.intent;
    if (x.position != null && (cur.position === null || x.position < cur.position)) cur.position = x.position;
    if (!cur.sources.includes(x.source)) cur.sources.push(x.source);
  }
  const rank = (k: ClusterKeyword) => Math.min(...k.sources.map((s) => SOURCE_ORDER.indexOf(s)));
  return [...map.values()]
    .map((k) => ({ ...k, sources: [...k.sources].sort((a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b)) }))
    .sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || rank(a) - rank(b) || a.keyword.localeCompare(b.keyword))
    .slice(0, max);
}

// ---------- Agrupar por palabras (sin IA) ----------

/** Las raíces que dicen de qué trata una búsqueda, sin las de la ciudad ni las del nombre del negocio. */
const topicStems = (keyword: string, ignore: Set<string>) => [...new Set(stems(keyword).filter((s) => !ignore.has(s)))];

/** Palabras de la ciudad y del negocio que no cuentan para el tema ("techos miami" y "techos doral" son el mismo tema). */
export function ignoreStems(places: string[], brand = ""): Set<string> {
  return new Set([...places, brand].flatMap((p) => stems(p)));
}

/**
 * Las raíces que salen en muchas búsquedas (más de un tercio) no dicen el tema: en un ajustador de seguros «claim» y
 * «damage» están en casi todo, y juntarían «daños por agua» con «daños por huracán».
 */
export function genericStems(keywords: Pick<ClusterKeyword, "keyword">[], ignore: Set<string> = new Set()): Set<string> {
  if (keywords.length < 6) return new Set();
  const df = new Map<string, number>();
  for (const k of keywords) for (const s of topicStems(k.keyword, ignore)) df.set(s, (df.get(s) ?? 0) + 1);
  return new Set([...df].filter(([, n]) => n / keywords.length > 0.34).map(([s]) => s));
}

/** ¿Es una pregunta («cómo…», «how to…», o de «La gente también pregunta»)? Va en un artículo, no en una página de servicio. */
const isQuestion = (k: Pick<ClusterKeyword, "keyword" | "sources">) => k.sources.includes("question") || QUESTION_RE.test(norm(k.keyword));

/**
 * Agrupa sin IA: cada búsqueda (de la más buscada a la menos) entra al tema con el que más comparte; las palabras
 * raras pesan más que las comunes («agua» dice más que «daño»). Comparten si lo que tienen en común pesa 60 % o más de
 * la más corta de las dos. Las preguntas no se juntan con los servicios.
 */
export function wordGroups(keywords: ClusterKeyword[], ignore: Set<string> = new Set()): ClusterKeyword[][] {
  const generic = genericStems(keywords, ignore);
  const skip = new Set([...ignore, ...generic]);
  const sets = keywords.map((k) => {
    // Si la búsqueda solo tiene palabras comunes (o la ciudad), cuentan esas.
    const own = topicStems(k.keyword, skip);
    const local = topicStems(k.keyword, ignore);
    return own.length ? own : local.length ? local : [...new Set(stems(k.keyword))];
  });
  const df = new Map<string, number>();
  for (const s of sets) for (const x of s) df.set(x, (df.get(x) ?? 0) + 1);
  const n = Math.max(1, keywords.length);
  const weight = (x: string) => Math.log((n + 1) / (df.get(x) ?? 1));
  const sum = (xs: Iterable<string>) => [...xs].reduce((a, x) => a + weight(x), 0);
  const groups: { stems: Set<string>; question: boolean; items: ClusterKeyword[] }[] = [];
  keywords.forEach((k, i) => {
    const s = sets[i];
    if (!s.length) return;
    const question = isQuestion(k);
    let best: (typeof groups)[number] | null = null;
    let bestScore = 0;
    for (const g of groups) {
      if (g.question !== question) continue;
      const shared = sum(s.filter((x) => g.stems.has(x)));
      const score = shared / Math.max(1e-9, Math.min(sum(s), sum(g.stems)));
      if (shared > 0 && score >= 0.6 && score > bestScore) {
        best = g;
        bestScore = score;
      }
    }
    if (best) best.items.push(k);
    else groups.push({ stems: new Set(s), question, items: [k] });
  });
  return groups.map((g) => g.items);
}

// ---------- Con IA ----------

export type AiGroup = { nameEs: string; nameEn: string; main: string; kind: string; keywords: string[] };

/**
 * Usa los grupos de la IA solo con búsquedas que existen (cada una en un solo grupo). Las que la IA no puso en ningún
 * grupo se agregan al grupo con el que más palabras comparten, o quedan juntas por palabras.
 */
export function applyAiGroups(keywords: ClusterKeyword[], groups: AiGroup[], ignore: Set<string> = new Set()): { groups: { name: Bi; main: string; kind: PageKind | null; items: ClusterKeyword[] }[] } {
  const byKey = new Map(keywords.map((k) => [norm(k.keyword), k]));
  const used = new Set<string>();
  const out: { name: Bi; main: string; kind: PageKind | null; items: ClusterKeyword[] }[] = [];
  for (const g of groups) {
    const items: ClusterKeyword[] = [];
    for (const raw of g.keywords) {
      const key = norm(raw);
      const k = byKey.get(key);
      if (!k || used.has(key)) continue;
      used.add(key);
      items.push(k);
    }
    if (!items.length) continue;
    const mainKey = norm(g.main);
    const main = items.find((k) => norm(k.keyword) === mainKey)?.keyword ?? [...items].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1))[0].keyword;
    const kind = g.kind === "service" || g.kind === "area" || g.kind === "article" ? g.kind : null;
    out.push({ name: { es: g.nameEs.trim().slice(0, 80) || main, en: g.nameEn.trim().slice(0, 80) || main }, main, kind, items });
  }
  // Las que quedaron sueltas: al grupo con el que comparten más raíces, o en grupos nuevos por palabras.
  const loose = keywords.filter((k) => !used.has(norm(k.keyword)));
  const rest: ClusterKeyword[] = [];
  for (const k of loose) {
    const s = topicStems(k.keyword, ignore);
    let best: (typeof out)[number] | null = null;
    let bestShared = 0;
    for (const g of out) {
      const gs = new Set(g.items.flatMap((x) => topicStems(x.keyword, ignore)));
      const shared = s.filter((x) => gs.has(x)).length;
      if (shared > bestShared) {
        best = g;
        bestShared = shared;
      }
    }
    if (best && bestShared > 0) best.items.push(k);
    else rest.push(k);
  }
  for (const items of wordGroups(rest, ignore)) out.push({ name: { es: items[0].keyword, en: items[0].keyword }, main: items[0].keyword, kind: null, items });
  return { groups: out };
}

// ---------- Resumen de cada tema ----------

const QUESTION_RE = /^(como|que|cual|cuales|cuanto|cuanta|cuantos|por que|donde|cuando|quien|es|puedo|se puede|how|what|why|which|when|where|who|can|do|does|is|are|should)\b/;

/** El tipo de página que pide un tema: artículo (preguntas e información), página de zona (nombra lugares) o de servicio. */
export function pageKind(items: ClusterKeyword[], places: Set<string>): PageKind {
  const n = items.length || 1;
  const questions = items.filter((k) => k.sources.includes("question") || QUESTION_RE.test(norm(k.keyword)) || k.intent === "informational").length;
  if (questions / n > 0.5) return "article";
  const withPlace = items.filter((k) => stems(k.keyword).some((s) => places.has(s))).length;
  const selling = items.filter((k) => sellsIntent(k.intent)).length;
  if (withPlace / n > 0.6 && selling >= questions) return "area";
  return "service";
}

/** Arma cada tema con sus totales y la página o el artículo que ya lo cubre. Ordenados por búsquedas al mes. */
export function buildClusters(
  groups: { name: Bi; main: string; kind: PageKind | null; items: ClusterKeyword[] }[],
  ctx: { pages: { url: string; label: string; text: string }[]; articles: string[]; places: Set<string> },
  max = CLUSTER_MAX,
): Cluster[] {
  const clusters = groups
    .filter((g) => g.items.length)
    .map((g): Cluster => {
      const items = [...g.items].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));
      const volume = items.reduce((s, k) => s + (k.volume ?? 0), 0);
      const withKd = items.filter((k) => k.difficulty !== null);
      const weight = withKd.reduce((s, k) => s + Math.max(1, k.volume ?? 0), 0);
      const difficulty = withKd.length ? Math.round(withKd.reduce((s, k) => s + (k.difficulty as number) * Math.max(1, k.volume ?? 0), 0) / weight) : null;
      const intents = new Map<SearchIntent, number>();
      for (const k of items) if (k.intent) intents.set(k.intent, (intents.get(k.intent) ?? 0) + Math.max(1, k.volume ?? 0));
      const intent = [...intents.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const positions = items.map((k) => k.position).filter((p): p is number => p !== null);
      const covers = (text: string) => items.slice(0, 3).some((k) => coveredBy(k.keyword, text)) || coveredBy(g.main, text);
      const hit = ctx.pages.find((p) => covers(p.text));
      const article = ctx.articles.find((a) => covers(a)) ?? null;
      return {
        name: g.name,
        main: g.main,
        kind: g.kind ?? pageKind(items, ctx.places),
        keywords: items,
        volume,
        difficulty,
        intent,
        bestPosition: positions.length ? Math.min(...positions) : null,
        page: hit ? { url: hit.url, label: hit.label } : null,
        article,
      };
    });
  // Los temas grandes primero; los de una sola búsqueda sin datos al final.
  return clusters.sort((a, b) => b.volume - a.volume || b.keywords.length - a.keywords.length).slice(0, max);
}

/** Lo siguiente que conviene hacer con un tema. */
export function clusterNext(c: Pick<Cluster, "page" | "article" | "kind" | "bestPosition">): "improve" | "write" | "create" | "keep" {
  if (c.bestPosition !== null && c.bestPosition <= 3) return "keep";
  if (c.page || c.article) return "improve";
  return c.kind === "article" ? "write" : "create";
}

// ---------- Guardado ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const SOURCES = new Set<ClusterSource>(SOURCE_ORDER);

/** Lee los temas guardados sin confiar en su forma; null si no son válidos. */
export function readClustersReport(json: unknown): ClustersReport | null {
  const r = obj(json);
  if (!Array.isArray(r.clusters) || !str(r.createdAt)) return null;
  const clusters: Cluster[] = arr(r.clusters)
    .map(obj)
    .map((c) => {
      const name = obj(c.name);
      const page = c.page ? obj(c.page) : null;
      const kind: PageKind = c.kind === "area" || c.kind === "article" ? c.kind : "service";
      return {
        name: { es: str(name.es) || str(c.main), en: str(name.en) || str(c.main) },
        main: str(c.main),
        kind,
        keywords: arr(c.keywords)
          .map(obj)
          .map((k) => ({
            keyword: str(k.keyword),
            volume: num(k.volume),
            difficulty: num(k.difficulty),
            intent: asIntent(k.intent),
            position: num(k.position),
            sources: arr(k.sources).filter((s): s is ClusterSource => SOURCES.has(s as ClusterSource)),
          }))
          .filter((k) => k.keyword),
        volume: num(c.volume) ?? 0,
        difficulty: num(c.difficulty),
        intent: asIntent(c.intent),
        bestPosition: num(c.bestPosition),
        page: page && str(page.url) ? { url: str(page.url), label: str(page.label) } : null,
        article: str(c.article) || null,
      };
    })
    .filter((c) => c.main && c.keywords.length);
  return { clusters, total: num(r.total) ?? clusters.reduce((s, c) => s + c.keywords.length, 0), by: r.by === "ai" ? "ai" : "words", createdAt: str(r.createdAt) };
}
