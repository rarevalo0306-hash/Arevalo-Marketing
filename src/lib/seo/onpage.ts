// Revisión de tus páginas (como el "On Page SEO Checker" de Semrush): para cada página importante del sitio
// se elige la búsqueda por la que debería salir, se compara con las páginas que ganan en Google para esa búsqueda
// y se arma una lista corta de arreglos concretos, en palabras simples y por prioridad.
// 1) Las páginas salen de la última auditoría (src/lib/seo/audit.ts), hasta 10.
// 2) La palabra clave de cada página: la que eligió el dueño, la de Search Console, la de "tus posiciones" o la más
//    parecida al título (assignKeywords). Cada palabra va a una sola página para que no compitan entre ellas.
// 3) Por página: se lee la página en vivo y se investiga la búsqueda con researchKeyword (1 llamada SERP de
//    DataForSEO, unos US$0.002, más la lectura de hasta 5 páginas que ganan) y contentTargets (src/lib/seo/writer.ts).
// 4) onPageIdeas compara y da un puntaje de 0 a 100 con las ideas. Todo lo que no toca la red es puro
//    y se prueba en tests/seo-onpage.test.ts.
import { bi } from "@/lib/i18n";
import { analyzePage, type AuditPage, type AuditReport, decodeEntities, fetchPublicHtml, hasBusinessSchema, normalizeUrl } from "@/lib/seo/audit";
import type { Zone } from "@/lib/seo/dataforseo";
import { biOf, domainMatches, pool, type RankRow } from "@/lib/seo/rank";
import {
  type ContentTargets,
  contentTargets,
  countWords,
  extractHeadings,
  hasKeyword,
  hostOf,
  type KeywordResearch,
  mainWords,
  norm,
  researchKeyword,
  slugify,
  stems,
  targetUsage,
  WRITER_SERP_COST,
  type WriterLang,
} from "@/lib/seo/writer";

/** Páginas que se revisan como máximo en cada corrida. */
export const ONPAGE_MAX_PAGES = 10;
/** Cuántas páginas se investigan en Google al mismo tiempo. */
export const ONPAGE_CONCURRENCY = 3;
/** Costo estimado por página con palabra clave (1 consulta SERP de 10 resultados en DataForSEO). */
export const ONPAGE_COST_PER_PAGE = WRITER_SERP_COST;
/** Después de esto (desde que empezó la corrida) no se empieza ninguna página más: la página tiene 300 s en Vercel. */
export const ONPAGE_STOP_STARTING_MS = 215_000;
/** Límite duro: lo que no terminó a esta altura se marca como "no se revisó". */
export const ONPAGE_HARD_LIMIT_MS = 280_000;
/** Reportes "onpage" que se guardan por negocio. */
export const MAX_ONPAGE_REPORTS = 10;
const PAGE_TIMEOUT_MS = 10_000;
const PAGE_MAX_BYTES = 2_000_000;
const MAX_TEXT_CHARS = 60_000;

// ---------- Tipos ----------

export type KeywordSource = "gsc" | "rank" | "match" | "owner";
export const KEYWORD_SOURCES: KeywordSource[] = ["owner", "gsc", "rank", "match"];

export type IdeaCategory = "contenido" | "titulos" | "preguntas" | "enlaces" | "tecnico" | "competencia";
export type IdeaPriority = "alta" | "media" | "baja";

export type IdeaId =
  | "noindex"
  | "canonical"
  | "title-missing"
  | "title-keyword"
  | "title-length"
  | "h1-missing"
  | "h1-keyword"
  | "h1-multiple"
  | "meta-missing"
  | "meta-keyword"
  | "meta-length"
  | "url-keyword"
  | "intro-keyword"
  | "h2-keyword"
  | "length"
  | "topics"
  | "questions"
  | "terms"
  | "images-alt"
  | "inbound-links"
  | "home-link"
  | "outbound-links"
  | "schema"
  | "speed"
  | "not-ranking"
  | "low-ranking"
  | "other-page-ranks";

export type OnPageIdea = {
  id: IdeaId;
  category: IdeaCategory;
  priority: IdeaPriority;
  es: string;
  en: string;
  /** Lista que acompaña la idea (preguntas, temas o palabras que faltan), tal como salen en Google. */
  detail?: string[];
  /** Cuántos puntos del puntaje se ganan al arreglarla (o un peso fijo para lo que no suma puntos). Ordena las ideas. */
  impact: number;
};

/** Lo que se lee de la página en vivo. */
export type LivePage = {
  url: string;
  title: string;
  meta: string;
  h1: string;
  h1Count: number;
  /** Subtítulos H2 y H3 del contenido. */
  headings: { level: 2 | 3; text: string }[];
  /** Palabras del contenido principal (misma medida que se usa para las páginas que ganan). */
  words: number;
  /** Texto del contenido principal (recortado). */
  text: string;
  /** Las primeras 100 palabras del contenido principal. */
  intro: string;
  images: number;
  imagesNoAlt: number;
  /** Enlaces a otras páginas del mismo sitio (normalizados). */
  internalLinks: string[];
  /** Enlaces a otros sitios. */
  externalLinks: number;
  schema: string[];
  canonical: string;
  noindex: boolean;
};

export type PageSpeedInfo =
  | { source: "pagespeed"; seconds: number | null; performance: number | null }
  | { source: "server"; seconds: number }
  | null;

/** Lo que se sabe del resto del sitio para una página. */
export type PageSiteInfo = {
  /** Dominio del negocio ("ejemplo.com"). */
  domain: string;
  isHome: boolean;
  /** La página de contacto (o "nosotros"/ubicación): ahí también conviene tener los datos del negocio. */
  isContact: boolean;
  /** Cuántas de las otras páginas revisadas enlazan a esta. null = no se sabe. */
  inboundLinks: number | null;
  /** ¿La página de inicio enlaza a esta? null = no se sabe o esta es la de inicio. */
  homeLinks: boolean | null;
  speed: PageSpeedInfo;
  /** La fila de "tus posiciones" para esta palabra (Google en celular, primeros 20). null = no hay. */
  rank: { position: number | null; url: string | null; top: { position: number; domain: string; url: string }[] } | null;
};

export type OnPageStats = {
  words: number;
  /** Largo de los que ganan (mediana). null si no hay palabra clave. */
  targetWords: number | null;
  title: string;
  h1: string;
  meta: string;
  h2: string[];
  images: number;
  imagesNoAlt: number;
  /** Enlaces desde esta página a otras del sitio. */
  linksOut: number;
  /** Enlaces hacia esta página desde las otras revisadas. */
  linksIn: number | null;
  external: number;
  schema: string[];
  canonical: string;
  loadSeconds: number | null;
  loadSource: "pagespeed" | "server" | null;
  /** Lugar en Google para la palabra clave (de "tus posiciones"). */
  position: number | null;
};

export type Winner = { position: number; domain: string; url: string; title: string; words: number | null };

/** Lo que pide la IA para sugerir títulos (recortado de la investigación). */
export type OnPageBrief = { headings: string[]; questions: string[]; terms: string[]; serpTitles: string[] };

export type OnPageSuggestion = { title: string; metaDescription: string; h1: string; h2s: string[]; provider: string; createdAt: string };

export type OnPagePage = {
  url: string;
  title: string;
  keyword: string | null;
  keywordSource: KeywordSource | null;
  score: number | null;
  ideas: OnPageIdea[];
  stats: OnPageStats | null;
  winners: Winner[];
  brief: OnPageBrief | null;
  /** Claves (urlKey) de las otras páginas revisadas a las que enlaza: sirve para contar enlaces sin volver a leerlas. */
  linksTo: string[];
  checkedAt: string;
  /** Se cambió la palabra clave y falta volver a revisarla. */
  needsRecheck?: boolean;
  /** No se alcanzó a revisar (se acabó el tiempo). */
  skipped?: boolean;
  suggestion?: OnPageSuggestion;
  error?: { es: string; en: string };
};

export type OnPageReport = {
  version: 1;
  zone: { code: number; name: string };
  language: WriterLang;
  pages: OnPagePage[];
  /** Palabra clave elegida por el dueño para cada página (por dirección). */
  overrides: Record<string, string>;
  /** DataForSEO (USD). */
  cost: number;
  createdAt: string;
  /** Se cortó por tiempo antes de revisar todo. */
  stoppedEarly: boolean;
};

// ---------- Direcciones ----------

/** Clave para comparar direcciones del mismo sitio: sin protocolo, sin www, sin barra final ni #. */
export function urlKey(u: string): string {
  try {
    const url = new URL(normalizeUrl(u.trim()));
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}${url.search}`;
  } catch {
    return u.trim().toLowerCase();
  }
}

/** Solo la ruta: "https://ejemplo.com/techos/" → "/techos/". */
export function pathOf(u: string): string {
  try {
    const url = new URL(u);
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return u;
  }
}

const JUNK_PATH =
  /\/(privacy|privacidad|politica[\w-]*|policy|terms[\w-]*|terminos[\w-]*|legal|aviso-legal|cookies?|login|wp-login[\w.-]*|wp-admin|cart|carrito|checkout|my-account|mi-cuenta|tag|tags|etiquetas?|category|categoria|author|autor|feed|page\/\d+|search|buscar|gracias|thank-you|thanks)(\/|$)/i;
const CONTACT_PATH = /\/(contact[\w-]*|contacto|contactanos|ubicacion|location[\w-]*|about[\w-]*|nosotros|quienes-somos|sobre-nosotros)(\/|$)/i;

export const isContactUrl = (u: string) => CONTACT_PATH.test(pathOf(u).split("?")[0]);

// ---------- 1. Páginas y palabras clave (puro) ----------

export type CandidatePage = { url: string; title: string; h1: string; isHome: boolean };

/** Las páginas de la auditoría que Google puede mostrar (200, HTML, sin noindex), sin repetir, la de inicio primero. */
export function candidatePages(audit: Pick<AuditReport, "pages" | "site">): CandidatePage[] {
  const homeKey = urlKey(audit.site.home || audit.pages[0]?.finalUrl || "");
  const seen = new Set<string>();
  const out: CandidatePage[] = [];
  for (const p of audit.pages) {
    if (p.error || p.status !== 200 || p.noindex) continue;
    const url = p.finalUrl || p.url;
    const key = urlKey(url);
    if (!/^https?:\/\//i.test(url) || seen.has(key)) continue;
    seen.add(key);
    out.push({ url, title: p.title, h1: p.h1, isHome: key === homeKey });
  }
  return out.sort((a, b) => Number(b.isHome) - Number(a.isHome));
}

export type KeywordSignals = {
  /** Lo que eligió el dueño: dirección → palabra clave. */
  overrides?: Record<string, string>;
  /** Search Console: página + búsqueda + impresiones. */
  gsc?: { page: string; query: string; impressions: number }[];
  /** "Tus posiciones": palabra + la página del negocio que sale + lugar. */
  rank?: { keyword: string; url: string | null; position: number | null }[];
  /** Palabras que sigue el negocio y las del estudio, para comparar con el título. */
  candidates?: string[];
  /** Nombre del negocio: las búsquedas con el nombre no sirven como palabra de una página. */
  brand?: string;
};

export type KeywordAssignment = { url: string; keyword: string | null; source: KeywordSource | null };

/** Parecido mínimo (parte de las palabras de la búsqueda que están en el título, el H1 o la dirección). */
export const MIN_MATCH = 0.6;
/** Impresiones mínimas en Search Console para que una búsqueda cuente. */
export const MIN_GSC_IMPRESSIONS = 3;

const TIER: Record<KeywordSource, number> = { owner: 4, gsc: 3, rank: 2, match: 1 };

const cleanKw = (k: string) => k.replace(/\s+/g, " ").trim().slice(0, 80);

/** ¿La búsqueda es el nombre del negocio? (tiene casi todas sus palabras). */
export function isBrandQuery(query: string, brand: string | undefined): boolean {
  const b = [...new Set(stems(brand ?? ""))];
  if (!b.length) return false;
  const q = new Set(stems(query));
  return b.filter((w) => q.has(w)).length / b.length >= 0.67;
}

/** Palabras de la dirección: "/reparacion-de-techos/" → "reparacion de techos". */
const slugWords = (u: string) => decodeURIComponentSafe(pathOf(u).split("?")[0]).replace(/[-_/.]+/g, " ");

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Qué tanto se parece una búsqueda a una página (título + H1 + dirección). 0 = no se parece lo suficiente.
 * Hace falta al menos el 60 % de las palabras de la búsqueda (y 2 palabras si tiene 2 o más).
 */
export function matchScore(page: { url: string; title: string; h1: string }, keyword: string): number {
  const need = [...new Set(stems(keyword))];
  if (!need.length) return 0;
  const inTitle = new Set(stems(page.title));
  const inH1 = new Set(stems(page.h1));
  const inUrl = new Set(stems(slugWords(page.url)));
  const hit = need.filter((w) => inTitle.has(w) || inH1.has(w) || inUrl.has(w)).length;
  const ratio = hit / need.length;
  if (ratio < MIN_MATCH || hit < Math.min(2, need.length)) return 0;
  return ratio * 10 + (need.every((w) => inTitle.has(w)) ? 1 : 0) + (need.every((w) => inH1.has(w)) ? 1 : 0) + hit * 0.1;
}

/**
 * La palabra clave de cada página, en este orden: la que eligió el dueño, la búsqueda de Search Console con más
 * impresiones para esa página, una palabra que sigues cuya página en Google es esa (gana el mejor lugar) y,
 * por último, la palabra que más se parece al título, H1 y dirección. Cada palabra va a una sola página
 * (la que mejor le queda) para que tus páginas no compitan entre ellas. Sin nada que sirva: null.
 */
export function assignKeywords(pages: { url: string; title: string; h1: string }[], signals: KeywordSignals): KeywordAssignment[] {
  const out = new Map<number, { keyword: string; source: KeywordSource }>();
  const used = new Set<string>();
  const index = new Map<string, number>();
  pages.forEach((p, i) => {
    const k = urlKey(p.url);
    if (!index.has(k)) index.set(k, i);
  });

  type Cand = { i: number; keyword: string; source: KeywordSource; strength: number };
  const cands: Cand[] = [];
  for (const [u, k] of Object.entries(signals.overrides ?? {})) {
    const i = index.get(urlKey(u));
    const keyword = typeof k === "string" ? cleanKw(k) : "";
    if (i !== undefined && keyword) cands.push({ i, keyword, source: "owner", strength: 0 });
  }
  for (const r of signals.gsc ?? []) {
    const i = index.get(urlKey(r.page));
    const keyword = cleanKw(r.query);
    if (i === undefined || !keyword || !(r.impressions >= MIN_GSC_IMPRESSIONS) || isBrandQuery(keyword, signals.brand)) continue;
    cands.push({ i, keyword, source: "gsc", strength: r.impressions });
  }
  for (const r of signals.rank ?? []) {
    if (!r.url || r.position === null || !(r.position >= 1)) continue;
    const i = index.get(urlKey(r.url));
    const keyword = cleanKw(r.keyword);
    if (i !== undefined && keyword) cands.push({ i, keyword, source: "rank", strength: -r.position });
  }
  for (const raw of signals.candidates ?? []) {
    const keyword = cleanKw(raw);
    if (!keyword) continue;
    pages.forEach((p, i) => {
      const s = matchScore(p, keyword);
      if (s > 0) cands.push({ i, keyword, source: "match", strength: s });
    });
  }
  cands.sort((a, b) => TIER[b.source] - TIER[a.source] || b.strength - a.strength || a.i - b.i);
  for (const c of cands) {
    const k = norm(c.keyword);
    // El dueño puede repetir una palabra a propósito; las automáticas no se repiten.
    if (out.has(c.i) || (c.source !== "owner" && used.has(k))) continue;
    out.set(c.i, { keyword: c.keyword, source: c.source });
    used.add(k);
  }
  return pages.map((p, i) => ({ url: p.url, keyword: out.get(i)?.keyword ?? null, source: out.get(i)?.source ?? null }));
}

export type PlannedPage = CandidatePage & { keyword: string | null; source: KeywordSource | null };

/**
 * Las páginas a revisar (hasta `max`): la de inicio, luego las que tienen palabra clave (las del dueño primero),
 * y después las demás en el orden de la auditoría. Las páginas legales, de etiquetas o de carrito van al final.
 */
export function planPages(candidates: CandidatePage[], signals: KeywordSignals, max = ONPAGE_MAX_PAGES): PlannedPage[] {
  const assigned = assignKeywords(candidates, signals);
  return candidates
    .map((c, i) => {
      const a = assigned[i];
      const rank = c.isHome ? 10 : a.source ? TIER[a.source] : JUNK_PATH.test(pathOf(c.url)) ? -1 : 0;
      return { page: { ...c, keyword: a.keyword, source: a.source }, i, rank };
    })
    .sort((a, b) => b.rank - a.rank || a.i - b.i)
    .slice(0, Math.max(0, max))
    .map((x) => x.page);
}

// ---------- 2. Leer la página en vivo (puro) ----------

const textOf = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** Texto del contenido principal: el <article> o <main> más grande si tiene 150 palabras o más; si no, el cuerpo sin menú ni pie. */
export function mainText(html: string): string {
  const clean = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template|svg|nav|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ");
  let best = "";
  let bestN = 0;
  for (const m of clean.matchAll(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = textOf(m[2]);
    const n = countWords(text);
    if (n > bestN) {
      best = text;
      bestN = n;
    }
  }
  if (bestN >= 150) return best.slice(0, MAX_TEXT_CHARS);
  const start = clean.search(/<body\b/i);
  return textOf(start >= 0 ? clean.slice(start) : clean.replace(/<head\b[\s\S]*?<\/head>/i, " ")).slice(0, MAX_TEXT_CHARS);
}

/** Enlaces a otros sitios (distintos, sin contar subdominios del mismo). */
export function externalLinkCount(html: string, pageUrl: string): number {
  let host = "";
  try {
    host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return 0;
  }
  const set = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi)) {
    try {
      const u = new URL(decodeEntities(m[1]));
      const h = u.hostname.toLowerCase().replace(/^www\./, "");
      if (h && h !== host && !h.endsWith(`.${host}`) && !host.endsWith(`.${h}`)) set.add(u.href);
    } catch {
      /* enlace mal escrito */
    }
    if (set.size >= 300) break;
  }
  return set.size;
}

/** Todo lo que se revisa de una página, sacado de su HTML. */
export function readLivePage(html: string, url: string): LivePage {
  const a = analyzePage(html, url);
  const text = mainText(html);
  return {
    url,
    title: a.title,
    meta: a.description,
    h1: a.h1,
    h1Count: a.h1Count,
    headings: extractHeadings(html, 40),
    words: mainWords(html, a.words),
    text,
    intro: text.split(/\s+/).slice(0, 100).join(" "),
    images: a.images,
    imagesNoAlt: a.imagesNoAlt,
    internalLinks: a.links,
    externalLinks: externalLinkCount(html, url),
    schema: a.schema,
    canonical: a.canonical,
    noindex: a.noindex,
  };
}

// ---------- 3. Comparar y dar ideas (puro) ----------

/**
 * Puntos de cada revisión (suman 100), parecido a CHECK_WEIGHTS del asistente para escribir:
 * - título: palabra clave 10 + largo (30 a 60 letras) 4; H1 con la palabra clave 9;
 * - meta descripción 7 (la mitad por el largo de 120 a 160 letras, la mitad por la palabra clave);
 * - palabra clave en la dirección 3 (la de inicio no cuenta), en las primeras 100 palabras 6 y en un subtítulo 5;
 * - largo 14: completo desde el 80 % del de los que ganan, la mitad desde el 50 %;
 * - temas de los que ganan 7, preguntas de la gente 8 y palabras relacionadas 8 (proporcional a lo que cubre);
 * - fotos con descripción 3; enlaces 6 (4 por recibir enlaces de tus otras páginas, 2 por enlazar a ellas);
 * - datos del negocio (LocalBusiness) en la de inicio o de contacto 3; velocidad en celular 7.
 * Lo que no se puede medir da los puntos completos. Estar o no en Google (competencia) no suma puntos: es el resultado.
 */
export const ONPAGE_WEIGHTS = {
  titleKeyword: 10,
  titleLength: 4,
  h1: 9,
  meta: 7,
  url: 3,
  intro: 6,
  h2: 5,
  length: 14,
  topics: 7,
  questions: 8,
  terms: 8,
  images: 3,
  inbound: 4,
  outbound: 2,
  schema: 3,
  speed: 7,
} as const;
type WeightId = keyof typeof ONPAGE_WEIGHTS;

/** Cuántas cosas hace falta cubrir para tener todos los puntos. */
const TOPICS_NEEDED = 4;
const QUESTIONS_NEEDED = 3;
const TERMS_NEEDED = 6;
/** Largo por defecto cuando no se pudo leer ninguna página que gana. */
export const ONPAGE_DEFAULT_WORDS = 600;

const median = (list: number[]) => {
  const s = [...list].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Largo de los que ganan: la mediana de las páginas leídas, entre 300 y 2500, redondeada a 50. */
export function targetWords(targets: Pick<ContentTargets, "competitorWords">): number {
  const list = targets.competitorWords.filter((n) => n > 0);
  if (!list.length) return ONPAGE_DEFAULT_WORDS;
  return Math.round(Math.min(2500, Math.max(300, median(list))) / 50) * 50;
}

/** Segundos que tarda lo principal en mostrarse, desde el texto de PageSpeed ("6,1 s", "850 ms"). */
export function parseSeconds(s: string): number | null {
  const m = /([\d]+(?:[.,]\d+)?)\s*(ms|s)\b/i.exec(s.replace(/ /g, " "));
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return m[2].toLowerCase() === "ms" ? n / 1000 : n;
}

const PRIORITY_RANK: Record<IdeaPriority, number> = { alta: 0, media: 1, baja: 2 };

/** Ordena ideas: primero prioridad alta, y dentro de cada prioridad las que más suben el puntaje. */
export const byPriority = (a: Pick<OnPageIdea, "priority" | "impact">, b: Pick<OnPageIdea, "priority" | "impact">) =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.impact - a.impact;

const secondsText = (n: number, lang: "es" | "en") => {
  const v = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return lang === "es" ? String(v).replace(".", ",") : String(v);
};
const numText = (n: number, lang: "es" | "en") => new Intl.NumberFormat(lang === "es" ? "es" : "en-US", { useGrouping: "always" }).format(n);

/** Lista corta de dominios: "a.com, b.com y c.com". */
function listText(items: string[], lang: "es" | "en"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${lang === "es" ? "y" : "and"} ${items[items.length - 1]}`;
}

/** Preguntas que aparecen escritas en el texto (por ejemplo, en un acordeón de preguntas frecuentes). */
function textQuestions(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith("?") && s.length >= 8 && s.length <= 200)
    .slice(0, 60);
}

/**
 * Compara la página con lo que hacen los que ganan para la palabra clave y arma las ideas para mejorarla,
 * con un puntaje de 0 a 100 (pesos en ONPAGE_WEIGHTS). No inventa nada del negocio: solo dice qué falta.
 */
export function onPageIdeas(
  page: LivePage,
  keyword: string,
  targets: ContentTargets,
  research: Pick<KeywordResearch, "organic">,
  site: PageSiteInfo,
): { score: number; ideas: OnPageIdea[]; targetWords: number } {
  const ideas: OnPageIdea[] = [];
  const points: Partial<Record<WeightId, number>> = {};
  const give = (id: WeightId, fraction: number) => {
    points[id] = ONPAGE_WEIGHTS[id] * Math.max(0, Math.min(1, fraction));
  };
  const lost = (...ids: WeightId[]) => Math.round(ids.reduce((s, id) => s + ONPAGE_WEIGHTS[id] - (points[id] ?? 0), 0) * 10) / 10;
  const add = (idea: OnPageIdea) => ideas.push(idea);
  const kw = `“${keyword}”`;

  // Escondida o apuntando a otra: lo más urgente.
  if (page.noindex) {
    add({
      id: "noindex",
      category: "tecnico",
      priority: "alta",
      impact: 50,
      es: "Esta página le pide a Google que no la muestre (noindex). Quita esa opción en tu editor de página o pídeselo a quien la maneja.",
      en: "This page asks Google not to show it (noindex). Turn that setting off in your website editor or ask whoever manages it.",
    });
  }
  if (page.canonical && urlKey(page.canonical) !== urlKey(page.url)) {
    add({
      id: "canonical",
      category: "tecnico",
      priority: "alta",
      impact: 12,
      es: `Esta página le dice a Google que la versión principal es otra (${pathOf(page.canonical)}), así que Google puede no mostrarla. Pide que la etiqueta «canonical» apunte a esta misma página.`,
      en: `This page tells Google the main version is a different page (${pathOf(page.canonical)}), so Google may not show it. Ask for the "canonical" tag to point to this same page.`,
    });
  }

  // Título.
  const title = page.title.trim();
  const tl = title.length;
  const inTitle = !!title && hasKeyword(title, keyword);
  give("titleKeyword", inTitle ? 1 : 0);
  give("titleLength", tl >= 30 && tl <= 60 ? 1 : 0);
  if (!title) {
    add({
      id: "title-missing",
      category: "titulos",
      priority: "alta",
      impact: lost("titleKeyword", "titleLength"),
      es: `Tu página no tiene título para Google. Ponle uno de 50 a 60 letras que empiece con ${kw}.`,
      en: `Your page has no title for Google. Give it one of 50 to 60 characters that starts with ${kw}.`,
    });
  } else {
    if (!inTitle)
      add({
        id: "title-keyword",
        category: "titulos",
        priority: "alta",
        impact: lost("titleKeyword"),
        es: `Pon ${kw} en el título de la página (lo que sale en azul en Google). Ahora dice: «${title.slice(0, 90)}».`,
        en: `Put ${kw} in the page title (the blue headline on Google). Right now it says: "${title.slice(0, 90)}".`,
      });
    if (tl > 60)
      add({
        id: "title-length",
        category: "titulos",
        priority: "baja",
        impact: lost("titleLength"),
        es: `Tu título tiene ${tl} letras y Google lo corta. Déjalo en 60 o menos, con lo más importante al principio.`,
        en: `Your title is ${tl} characters long and Google cuts it off. Keep it at 60 or fewer, with the most important words first.`,
      });
    else if (tl < 30)
      add({
        id: "title-length",
        category: "titulos",
        priority: "baja",
        impact: lost("titleLength"),
        es: `Tu título es muy corto (${tl} letras). Aprovecha hasta 60 con el servicio y tu ciudad.`,
        en: `Your title is very short (${tl} characters). Use up to 60 with the service and your city.`,
      });
  }

  // H1.
  const h1 = page.h1.trim();
  const inH1 = !!h1 && hasKeyword(h1, keyword);
  give("h1", inH1 ? 1 : 0);
  if (!h1)
    add({
      id: "h1-missing",
      category: "titulos",
      priority: "alta",
      impact: lost("h1"),
      es: `Tu página no tiene título principal (H1). Agrega arriba un título grande que diga ${kw}.`,
      en: `Your page has no main heading (H1). Add a big heading at the top that says ${kw}.`,
    });
  else if (!inH1)
    add({
      id: "h1-keyword",
      category: "titulos",
      priority: "alta",
      impact: lost("h1"),
      es: `Pon ${kw} en el título principal de la página (H1). Ahora dice: «${h1.slice(0, 90)}».`,
      en: `Put ${kw} in the page's main heading (H1). Right now it says: "${h1.slice(0, 90)}".`,
    });
  if (page.h1Count > 1)
    add({
      id: "h1-multiple",
      category: "titulos",
      priority: "baja",
      impact: 1,
      es: `Tu página tiene ${page.h1Count} títulos principales (H1). Deja uno solo y cambia los otros a subtítulos (H2).`,
      en: `Your page has ${page.h1Count} main headings (H1). Keep just one and turn the others into subheadings (H2).`,
    });

  // Meta descripción.
  const meta = page.meta.trim();
  const ml = meta.length;
  const metaLenOk = ml >= 120 && ml <= 160;
  const metaKw = ml > 0 && hasKeyword(meta, keyword);
  give("meta", (metaLenOk ? 0.5 : 0) + (metaKw ? 0.5 : 0));
  if (!ml)
    add({
      id: "meta-missing",
      category: "titulos",
      priority: "media",
      impact: lost("meta"),
      es: `Escribe la descripción para Google (meta descripción): de 120 a 160 letras, con ${kw} y una invitación a llamar o escribir.`,
      en: `Write the Google description (meta description): 120 to 160 characters, with ${kw} and an invitation to call or write.`,
    });
  else if (!metaKw)
    add({
      id: "meta-keyword",
      category: "titulos",
      priority: "media",
      impact: lost("meta"),
      es: `Agrega ${kw} a la descripción para Google (meta descripción)${metaLenOk ? "" : ` y déjala de 120 a 160 letras (ahora tiene ${ml})`}.`,
      en: `Add ${kw} to the Google description (meta description)${metaLenOk ? "" : ` and make it 120 to 160 characters (it has ${ml} now)`}.`,
    });
  else if (!metaLenOk)
    add({
      id: "meta-length",
      category: "titulos",
      priority: "baja",
      impact: lost("meta"),
      es: `Tu descripción para Google mide ${ml} letras: déjala entre 120 y 160 para que no se corte ni se quede corta.`,
      en: `Your Google description is ${ml} characters: keep it between 120 and 160 so it isn't cut off or too short.`,
    });

  // Dirección (la de inicio no cuenta).
  if (site.isHome) give("url", 1);
  else {
    const need = [...new Set(stems(keyword))];
    const inUrl = new Set(stems(slugWords(page.url)));
    const share = need.length ? need.filter((w) => inUrl.has(w)).length / need.length : 1;
    give("url", share >= 0.5 ? 1 : 0);
    if (share < 0.5)
      add({
        id: "url-keyword",
        category: "tecnico",
        priority: "baja",
        impact: lost("url"),
        es: `La dirección de la página (${pathOf(page.url)}) no menciona ${kw}. Si haces una página nueva, usa algo como /${slugify(keyword)}. Si cambias esta, pide que pongan una redirección (301) para no perder lo ganado.`,
        en: `The page address (${pathOf(page.url)}) doesn't mention ${kw}. If you make a new page, use something like /${slugify(keyword)}. If you change this one, ask for a redirect (301) so you don't lose what it has earned.`,
      });
  }

  // Primeras 100 palabras.
  const inIntro = hasKeyword(page.intro, keyword);
  give("intro", inIntro ? 1 : 0);
  if (!inIntro)
    add({
      id: "intro-keyword",
      category: "contenido",
      priority: "media",
      impact: lost("intro"),
      es: `Usa ${kw} en las primeras 100 palabras de la página (el primer párrafo).`,
      en: `Use ${kw} in the first 100 words of the page (the first paragraph).`,
    });

  // Subtítulos.
  const inH2 = page.headings.some((h) => hasKeyword(h.text, keyword));
  give("h2", inH2 ? 1 : 0);
  if (!inH2)
    add({
      id: "h2-keyword",
      category: "titulos",
      priority: "media",
      impact: lost("h2"),
      es: page.headings.length
        ? `Usa ${kw} (o una variante) en al menos un subtítulo (H2).`
        : `Tu página no tiene subtítulos (H2). Divide el texto en secciones con subtítulos; al menos uno con ${kw}.`,
      en: page.headings.length
        ? `Use ${kw} (or a variation) in at least one subheading (H2).`
        : `Your page has no subheadings (H2). Split the text into sections with subheadings; at least one with ${kw}.`,
    });

  // Largo.
  const target = targetWords(targets);
  const read = targets.competitorWords.filter((n) => n > 0).length > 0;
  const ratio = target ? page.words / target : 1;
  give("length", ratio >= 0.8 ? 1 : ratio >= 0.5 ? 0.5 : 0);
  if (ratio < 0.8)
    add({
      id: "length",
      category: "contenido",
      priority: ratio < 0.5 ? "alta" : "media",
      impact: lost("length"),
      es: read
        ? `Los que ganan en Google tienen unas ${numText(target, "es")} palabras y tu página ${numText(page.words, "es")}. Agrega texto útil: qué incluye el servicio, cómo trabajas, en qué zonas y preguntas frecuentes.`
        : `Tu página tiene ${numText(page.words, "es")} palabras. Para competir en Google conviene tener al menos unas ${numText(target, "es")}: explica qué incluye el servicio, cómo trabajas, en qué zonas y preguntas frecuentes.`,
      en: read
        ? `The pages winning on Google have about ${numText(target, "en")} words and yours has ${numText(page.words, "en")}. Add useful text: what the service includes, how you work, the areas you serve and common questions.`
        : `Your page has ${numText(page.words, "en")} words. To compete on Google it's best to have at least about ${numText(target, "en")}: explain what the service includes, how you work, the areas you serve and common questions.`,
    });

  // Temas, preguntas y palabras relacionadas (con la misma revisión del asistente para escribir).
  const heads = [...page.headings.map((h) => h.text), ...textQuestions(page.text)];
  const md = [...heads.map((h) => `## ${h.replace(/[#*_`>[\]]/g, " ")}`), page.text.replace(/[#*_`>[\]]/g, " ")].join("\n\n");
  const usage = targetUsage({ title, h1, markdown: md }, targets);

  const tNeed = Math.min(TOPICS_NEEDED, targets.headings.length);
  const tHave = usage.headings.filter(Boolean).length;
  give("topics", tNeed ? tHave / tNeed : 1);
  const missingTopics = targets.headings.filter((_, i) => !usage.headings[i]).map((h) => h.text);
  if (tNeed && tHave < tNeed && missingTopics.length)
    add({
      id: "topics",
      category: "contenido",
      priority: "media",
      impact: lost("topics"),
      es: "Los que ganan hablan de estos temas y tu página no. Agrega una sección corta para los que apliquen a tu negocio:",
      en: "The winners cover these topics and your page doesn't. Add a short section for the ones that apply to your business:",
      detail: missingTopics.slice(0, 5),
    });

  const qNeed = Math.min(QUESTIONS_NEEDED, targets.questions.length);
  const qHave = usage.questions.filter(Boolean).length;
  give("questions", qNeed ? qHave / qNeed : 1);
  const missingQuestions = targets.questions.filter((_, i) => !usage.questions[i]);
  if (qNeed && qHave < qNeed && missingQuestions.length)
    add({
      id: "questions",
      category: "preguntas",
      priority: qHave === 0 && qNeed >= 3 ? "alta" : "media",
      impact: lost("questions"),
      es: "La gente le pregunta esto a Google y tu página no lo contesta. Agrega una sección de preguntas frecuentes con respuestas cortas:",
      en: "People ask Google these questions and your page doesn't answer them. Add a FAQ section with short answers:",
      detail: missingQuestions.slice(0, 6),
    });

  const rNeed = Math.min(TERMS_NEEDED, targets.terms.length);
  const rHave = usage.terms.filter(Boolean).length;
  give("terms", rNeed ? rHave / rNeed : 1);
  const missingTerms = targets.terms.filter((_, i) => !usage.terms[i]);
  if (rNeed && rHave < rNeed && missingTerms.length)
    add({
      id: "terms",
      category: "contenido",
      priority: rHave / rNeed < 0.5 ? "media" : "baja",
      impact: lost("terms"),
      es: "Los que ganan usan estas palabras y tu página no. Úsalas donde tengan sentido:",
      en: "The winners use these words and your page doesn't. Use them where they make sense:",
      detail: missingTerms.slice(0, 8),
    });

  // Fotos.
  give("images", page.imagesNoAlt > 0 ? 0 : 1);
  if (page.imagesNoAlt > 0)
    add({
      id: "images-alt",
      category: "tecnico",
      priority: "baja",
      impact: lost("images"),
      es: `${page.imagesNoAlt === 1 ? "1 foto no tiene" : `${page.imagesNoAlt} fotos no tienen`} descripción (texto alternativo). Describe lo que muestra cada una; en una puedes usar ${kw} si encaja.`,
      en: `${page.imagesNoAlt === 1 ? "1 photo has" : `${page.imagesNoAlt} photos have`} no description (alt text). Describe what each one shows; in one you can use ${kw} if it fits.`,
    });

  // Enlaces.
  if (site.isHome || site.inboundLinks === null) give("inbound", 1);
  else if (site.inboundLinks === 0) {
    give("inbound", 0);
    add({
      id: "inbound-links",
      category: "enlaces",
      priority: "alta",
      impact: lost("inbound"),
      es: `Ninguna de tus páginas principales enlaza a esta, así que Google la ve poco importante. Agrega un enlace desde tu página de inicio con un texto como ${kw}.`,
      en: `None of your main pages link to this one, so Google sees it as unimportant. Add a link from your home page with text like ${kw}.`,
    });
  } else if (site.homeLinks === false) {
    give("inbound", 0.5);
    add({
      id: "home-link",
      category: "enlaces",
      priority: "media",
      impact: lost("inbound"),
      es: `Agrega un enlace a esta página desde tu página de inicio, con un texto como ${kw}.`,
      en: `Add a link to this page from your home page, with text like ${kw}.`,
    });
  } else give("inbound", 1);
  const out = page.internalLinks.filter((l) => urlKey(l) !== urlKey(page.url)).length;
  give("outbound", out >= 3 ? 1 : 0);
  if (out < 3)
    add({
      id: "outbound-links",
      category: "enlaces",
      priority: "baja",
      impact: lost("outbound"),
      es: `Esta página casi no enlaza a tus otras páginas (${out}). Agrega 2 o 3 enlaces a servicios relacionados y a tu página de contacto.`,
      en: `This page barely links to your other pages (${out}). Add 2 or 3 links to related services and to your contact page.`,
    });

  // Datos del negocio (solo en la de inicio o contacto).
  if ((site.isHome || site.isContact) && !hasBusinessSchema(page.schema)) {
    give("schema", 0);
    add({
      id: "schema",
      category: "tecnico",
      priority: "media",
      impact: lost("schema"),
      es: "Agrega los datos de tu negocio en el formato de Google (LocalBusiness): nombre, dirección, teléfono y horario. Ayuda a salir en el mapa y en las respuestas de las IAs.",
      en: "Add your business details in Google's format (LocalBusiness): name, address, phone and hours. It helps you show up on the map and in AI answers.",
    });
  } else give("schema", 1);

  // Velocidad.
  const sp = site.speed;
  if (sp?.source === "pagespeed" && (sp.seconds !== null || sp.performance !== null)) {
    const s = sp.seconds;
    const perf = sp.performance;
    const bad = (s !== null && s > 4) || (perf !== null && perf < 50);
    const meh = !bad && ((s !== null && s > 2.5) || (perf !== null && perf < 70));
    give("speed", bad ? 0 : meh ? 0.5 : 1);
    if (bad || meh)
      add({
        id: "speed",
        category: "tecnico",
        priority: bad ? "alta" : "media",
        impact: lost("speed"),
        es: `${s !== null ? `Tu página tarda ${secondsText(s, "es")} s en mostrarse en el celular (Google pide menos de 2,5 s)` : `Google le da a tu página ${perf}/100 de velocidad en el celular`}. Usa fotos más livianas (WebP, menos de 200 KB) y quita lo que no uses.`,
        en: `${s !== null ? `Your page takes ${secondsText(s, "en")} s to show up on phones (Google asks for under 2.5 s)` : `Google gives your page ${perf}/100 for speed on phones`}. Use lighter photos (WebP, under 200 KB) and remove what you don't use.`,
      });
  } else if (sp?.source === "server") {
    const s = sp.seconds;
    give("speed", s > 6 ? 0 : s > 3 ? 0.5 : 1);
    if (s > 3)
      add({
        id: "speed",
        category: "tecnico",
        priority: s > 6 ? "alta" : "media",
        impact: lost("speed"),
        es: `Tu página tardó ${secondsText(s, "es")} s en responder. Usa fotos más livianas, quita lo que no uses y pregunta por un hosting más rápido.`,
        en: `Your page took ${secondsText(s, "en")} s to respond. Use lighter photos, remove what you don't use and ask about faster hosting.`,
      });
  } else give("speed", 1);

  // Competencia (no suma puntos).
  const others = (list: { domain: string }[]) =>
    [...new Set(list.map((x) => x.domain.toLowerCase().replace(/^www\./, "")).filter((d) => d && !domainMatches(d, site.domain)))].slice(0, 3);
  const rank = site.rank;
  if (rank) {
    const winners = others(rank.top);
    if (rank.position === null) {
      if (winners.length)
        add({
          id: "not-ranking",
          category: "competencia",
          priority: "media",
          impact: 5,
          es: `No sales entre los primeros 20 de Google para ${kw}. Ganan: ${listText(winners, "es")}. Las ideas de arriba te acercan.`,
          en: `You're not in Google's top 20 for ${kw}. Winning: ${listText(winners, "en")}. The ideas above get you closer.`,
        });
    } else if (rank.url && urlKey(rank.url) !== urlKey(page.url)) {
      add({
        id: "other-page-ranks",
        category: "competencia",
        priority: "media",
        impact: 6,
        es: `Para ${kw}, Google muestra otra de tus páginas (${pathOf(rank.url)}) en el lugar ${rank.position}. Decide cuál debe salir: enlaza desde la otra hacia esta, o elige otra palabra clave para esta página.`,
        en: `For ${kw}, Google shows another one of your pages (${pathOf(rank.url)}) in position ${rank.position}. Decide which one should rank: link from that one to this one, or pick another keyword for this page.`,
      });
    } else if (rank.position > 10 && winners.length) {
      add({
        id: "low-ranking",
        category: "competencia",
        priority: "baja",
        impact: 3,
        es: `Sales en el lugar ${rank.position} para ${kw} (segunda página de Google). Arriba están ${listText(winners, "es")}.`,
        en: `You're in position ${rank.position} for ${kw} (Google's second page). Above you: ${listText(winners, "en")}.`,
      });
    }
  } else if (research.organic.length) {
    const mine = research.organic.find((o) => domainMatches(o.domain || hostOf(o.url), site.domain));
    const winners = others(research.organic);
    if (!mine && winners.length)
      add({
        id: "not-ranking",
        category: "competencia",
        priority: "media",
        impact: 5,
        es: `No sales entre los primeros 10 de Google para ${kw}. Ganan: ${listText(winners, "es")}. Las ideas de arriba te acercan.`,
        en: `You're not in Google's top 10 for ${kw}. Winning: ${listText(winners, "en")}. The ideas above get you closer.`,
      });
    else if (mine && urlKey(mine.url) !== urlKey(page.url))
      add({
        id: "other-page-ranks",
        category: "competencia",
        priority: "media",
        impact: 6,
        es: `Para ${kw}, Google muestra otra de tus páginas (${pathOf(mine.url)}) en el lugar ${mine.position}. Decide cuál debe salir: enlaza desde la otra hacia esta, o elige otra palabra clave para esta página.`,
        en: `For ${kw}, Google shows another one of your pages (${pathOf(mine.url)}) in position ${mine.position}. Decide which one should rank: link from that one to this one, or pick another keyword for this page.`,
      });
  }

  const score = Math.round((Object.keys(ONPAGE_WEIGHTS) as WeightId[]).reduce((s, id) => s + (points[id] ?? ONPAGE_WEIGHTS[id]), 0));
  return { score: Math.max(0, Math.min(100, score)), ideas: ideas.sort(byPriority), targetWords: target };
}

/** Las ideas que más ayudan entre todas las páginas (máximo 2 por página): "Empieza por aquí". */
export function topIdeas(pages: Pick<OnPagePage, "url" | "title" | "ideas">[], n = 3): { url: string; title: string; idea: OnPageIdea }[] {
  const all = pages.flatMap((p) => p.ideas.map((idea) => ({ url: p.url, title: p.title, idea })));
  all.sort((a, b) => byPriority(a.idea, b.idea));
  const perPage = new Map<string, number>();
  const out: { url: string; title: string; idea: OnPageIdea }[] = [];
  for (const x of all) {
    const k = urlKey(x.url);
    if ((perPage.get(k) ?? 0) >= 2) continue;
    perPage.set(k, (perPage.get(k) ?? 0) + 1);
    out.push(x);
    if (out.length >= n) break;
  }
  return out;
}

/** Orden de las tarjetas: primero las que más necesitan ayuda (menor puntaje, más ideas urgentes); al final las que faltan. */
export function sortPages<P extends Pick<OnPagePage, "score" | "ideas" | "error" | "skipped" | "needsRecheck" | "keyword">>(pages: P[]): P[] {
  const group = (p: P) => (p.score !== null && !p.needsRecheck && !p.error ? 0 : p.needsRecheck ? 1 : !p.keyword ? 2 : 3);
  const high = (p: P) => p.ideas.filter((i) => i.priority === "alta").length;
  return [...pages].sort((a, b) => group(a) - group(b) || (a.score ?? 101) - (b.score ?? 101) || high(b) - high(a));
}

// ---------- 4. La revisión (red) ----------

export type CheckContext = {
  zone: Zone;
  language: WriterLang;
  /** Dominio del negocio. */
  domain: string;
  /** La página de inicio (de la auditoría). */
  home: string;
  audit: Pick<AuditReport, "pages" | "pagespeed">;
  /** Filas de "tus posiciones" de la zona principal. */
  rankRows: RankRow[];
  /** Date.now() cuando empezó la acción. */
  startedAt: number;
};

/** Lo que se sabe de la velocidad de una página: PageSpeed para la de inicio, el tiempo de la auditoría para las demás. */
export function speedFor(url: string, home: string, audit: Pick<AuditReport, "pages" | "pagespeed">, liveMs: number | null): PageSpeedInfo {
  const key = urlKey(url);
  if (key === urlKey(home) && !("error" in audit.pagespeed)) {
    const seconds = parseSeconds(audit.pagespeed.lcp);
    if (seconds !== null || audit.pagespeed.performance !== null) return { source: "pagespeed", seconds, performance: audit.pagespeed.performance };
  }
  const a = audit.pages.find((p: AuditPage) => urlKey(p.finalUrl || p.url) === key && !p.error && p.ms > 0);
  if (a) return { source: "server", seconds: a.ms / 1000 };
  return liveMs !== null && liveMs > 0 ? { source: "server", seconds: liveMs / 1000 } : null;
}

/** La fila de "tus posiciones" para una palabra (sin importar mayúsculas ni acentos). */
export function rankFor(rows: RankRow[], keyword: string): PageSiteInfo["rank"] {
  const k = norm(keyword);
  const r = rows.find((x) => norm(x.keyword) === k && !x.error);
  return r ? { position: r.position, url: r.url, top: r.top.map((t) => ({ position: t.position, domain: t.domain, url: t.url })) } : null;
}

/** Los primeros 5 de Google, con las palabras de cada página si se pudo leer. */
export function winnersOf(research: Pick<KeywordResearch, "organic" | "pages">): Winner[] {
  return research.organic.slice(0, 5).map((o) => {
    const read = research.pages.find((p) => !p.error && (urlKey(p.url) === urlKey(o.url) || p.position === o.position));
    return { position: o.position, domain: o.domain, url: o.url, title: o.title.slice(0, 200), words: read && read.words > 0 ? read.words : null };
  });
}

const timeUp = () => bi("No se alcanzó a revisar: se acabó el tiempo. Vuelve a revisar esta página.", "Not checked: we ran out of time. Check this page again.");

/** Espera la promesa, pero no más allá de `until` (Date.now()). */
function before<T>(p: Promise<T>, until: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeUp()), Math.max(0, until - Date.now()));
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

type Fetched = { item: PlannedPage; live: LivePage | null; ms: number | null; error?: { es: string; en: string }; skipped?: boolean };
type Researched = { research: KeywordResearch | null; error?: { es: string; en: string }; skipped?: boolean };

/**
 * Revisa las páginas: las lee todas (5 a la vez, 10 s cada una), investiga en Google la palabra de cada una
 * (3 a la vez) y arma ideas y puntaje. Después de ONPAGE_STOP_STARTING_MS no empieza páginas nuevas y lo que no
 * terminó antes de ONPAGE_HARD_LIMIT_MS queda como "no se revisó". `others` son páginas guardadas de antes que
 * no se vuelven a leer (para contar los enlaces hacia las que sí se revisan).
 */
export async function checkPages(items: PlannedPage[], ctx: CheckContext, others: OnPagePage[] = []): Promise<{ pages: OnPagePage[]; cost: number; stoppedEarly: boolean }> {
  const stopStarting = ctx.startedAt + ONPAGE_STOP_STARTING_MS;
  const hardLimit = ctx.startedAt + ONPAGE_HARD_LIMIT_MS;

  const fetched = await pool(items, 5, async (item): Promise<Fetched> => {
    if (Date.now() > stopStarting) return { item, live: null, ms: null, skipped: true };
    const t0 = Date.now();
    try {
      const page = await before(fetchPublicHtml(item.url, PAGE_TIMEOUT_MS, PAGE_MAX_BYTES), hardLimit);
      return { item, live: readLivePage(page.html, page.url), ms: Date.now() - t0 };
    } catch (e) {
      return { item, live: null, ms: null, error: biOf(e) };
    }
  });

  const researched = await pool(fetched, ONPAGE_CONCURRENCY, async (f): Promise<Researched> => {
    if (!f.live || !f.item.keyword) return { research: null };
    if (Date.now() > stopStarting) return { research: null, skipped: true };
    try {
      return { research: await before(researchKeyword(f.item.keyword, ctx.zone, ctx.language), hardLimit) };
    } catch (e) {
      return { research: null, error: biOf(e) };
    }
  });

  // Enlaces entre las páginas conocidas (las de ahora y las guardadas que no se volvieron a leer).
  const nowKeys = new Set(items.map((i) => urlKey(i.url)));
  const known = new Set([...nowKeys, ...others.map((o) => urlKey(o.url))]);
  const linksOf = new Map<string, string[]>();
  for (const o of others) if (!nowKeys.has(urlKey(o.url))) linksOf.set(urlKey(o.url), o.linksTo);
  for (const f of fetched) {
    const k = urlKey(f.item.url);
    if (f.live) linksOf.set(k, [...new Set(f.live.internalLinks.map(urlKey))].filter((l) => l !== k && known.has(l)));
  }
  const homeKey = urlKey(ctx.home);
  const homeLinks = linksOf.get(homeKey);

  const checkedAt = new Date().toISOString();
  let cost = 0;
  const pages = fetched.map((f, i): OnPagePage => {
    const r = researched[i];
    const key = urlKey(f.item.url);
    const base: OnPagePage = {
      url: f.item.url,
      title: f.live?.title || f.item.title,
      keyword: f.item.keyword,
      keywordSource: f.item.source,
      score: null,
      ideas: [],
      stats: null,
      winners: [],
      brief: null,
      linksTo: linksOf.get(key) ?? [],
      checkedAt,
    };
    if (f.skipped || r.skipped) return { ...base, skipped: true, error: biOf(timeUp()) };
    if (!f.live) return { ...base, error: f.error ?? biOf(bi("No se pudo leer la página.", "Couldn't read the page.")) };
    const live = f.live;
    const sources = [...linksOf.entries()].filter(([k]) => k !== key);
    const inbound = key === homeKey ? null : sources.length ? sources.filter(([, l]) => l.includes(key)).length : null;
    const speed = speedFor(f.item.url, ctx.home, ctx.audit, f.ms);
    const rank = f.item.keyword ? rankFor(ctx.rankRows, f.item.keyword) : null;
    const stats: OnPageStats = {
      words: live.words,
      targetWords: null,
      title: live.title,
      h1: live.h1,
      meta: live.meta,
      h2: live.headings.filter((h) => h.level === 2).map((h) => h.text).slice(0, 12),
      images: live.images,
      imagesNoAlt: live.imagesNoAlt,
      linksOut: live.internalLinks.filter((l) => urlKey(l) !== key).length,
      linksIn: inbound,
      external: live.externalLinks,
      schema: live.schema.slice(0, 10),
      canonical: live.canonical,
      loadSeconds: speed ? speed.seconds : null,
      loadSource: speed ? speed.source : null,
      position: rank?.position ?? null,
    };
    if (!f.item.keyword) return { ...base, stats };
    if (!r.research) return { ...base, stats, error: r.error ?? biOf(bi("No se pudo consultar Google.", "Couldn't check Google.")) };
    const research = r.research;
    cost += research.cost;
    const targets = contentTargets(research);
    const site: PageSiteInfo = {
      domain: ctx.domain,
      isHome: key === homeKey,
      isContact: isContactUrl(f.item.url),
      inboundLinks: inbound,
      homeLinks: key === homeKey || !homeLinks ? null : homeLinks.includes(key),
      speed,
      rank,
    };
    const result = onPageIdeas(live, f.item.keyword, targets, research, site);
    return {
      ...base,
      score: result.score,
      ideas: result.ideas,
      stats: { ...stats, targetWords: result.targetWords },
      winners: winnersOf(research),
      brief: {
        headings: targets.headings.map((h) => h.text).slice(0, 8),
        questions: targets.questions.slice(0, 8),
        terms: targets.terms.slice(0, 15),
        serpTitles: research.organic.map((o) => o.title).filter(Boolean).slice(0, 10),
      },
    };
  });
  return { pages, cost: Math.round(cost * 10000) / 10000, stoppedEarly: pages.some((p) => p.skipped) };
}

// ---------- Cambios sobre un reporte guardado (puro) ----------

/** Pone (o reemplaza) una página revisada en el reporte. */
export function mergePage(report: OnPageReport, page: OnPagePage, extraCost = 0): OnPageReport {
  const key = urlKey(page.url);
  const has = report.pages.some((p) => urlKey(p.url) === key);
  const pages = has ? report.pages.map((p) => (urlKey(p.url) === key ? page : p)) : [...report.pages, page];
  return { ...report, pages, cost: Math.round((report.cost + extraCost) * 10000) / 10000, createdAt: new Date().toISOString(), stoppedEarly: pages.some((p) => p.skipped) };
}

/**
 * Guarda la palabra elegida por el dueño para una página (vacía = volver a la automática). La página queda
 * marcada para volver a revisar, sin las ideas viejas (eran para otra palabra).
 */
export function applyOverride(report: OnPageReport, url: string, keyword: string): OnPageReport {
  const key = urlKey(url);
  const overrides = Object.fromEntries(Object.entries(report.overrides).filter(([u]) => urlKey(u) !== key));
  const kw = cleanKw(keyword);
  if (kw) overrides[url] = kw;
  const pages = report.pages.map((p) =>
    urlKey(p.url) !== key
      ? p
      : {
          ...p,
          keyword: kw || null,
          keywordSource: kw ? ("owner" as const) : null,
          score: null,
          ideas: [],
          winners: [],
          brief: null,
          suggestion: undefined,
          error: undefined,
          skipped: undefined,
          needsRecheck: true,
          stats: p.stats ? { ...p.stats, targetWords: null, position: null } : null,
        },
  );
  return { ...report, overrides, pages: pages.map(dropUndefined) };
}

const dropUndefined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** La palabra elegida por el dueño para una dirección, si hay. */
export function overrideFor(overrides: Record<string, string>, url: string): string | null {
  const key = urlKey(url);
  for (const [u, k] of Object.entries(overrides)) if (urlKey(u) === key && k.trim()) return k.trim();
  return null;
}

/** Limpia lo que sugirió la IA: título de 60 letras o menos, descripción de 160 o menos, 3 a 5 subtítulos. */
export function cleanSuggestion(s: { title: string; metaDescription: string; h1: string; h2s: string[] }, provider: string): OnPageSuggestion {
  const fit = (text: string, max: number) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max + 1);
    const at = cut.lastIndexOf(" ");
    return (at > max * 0.6 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:|·–—-]+$/, "");
  };
  return {
    title: fit(s.title, 60),
    metaDescription: fit(s.metaDescription, 160),
    h1: fit(s.h1.replace(/^#+\s*/, ""), 120),
    h2s: s.h2s.map((h) => fit(h.replace(/^#+\s*/, ""), 120)).filter(Boolean).slice(0, 5),
    provider,
    createdAt: new Date().toISOString(),
  };
}

// ---------- Leer lo guardado ----------

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strs = (v: unknown, max: number, len = 300) => arr(v).filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.slice(0, len)).slice(0, max);
const isoOr = (v: unknown, d: string) => {
  const s = str(v);
  return s && !Number.isNaN(Date.parse(s)) ? s : d;
};

const CATEGORIES = new Set<IdeaCategory>(["contenido", "titulos", "preguntas", "enlaces", "tecnico", "competencia"]);
const PRIORITIES = new Set<IdeaPriority>(["alta", "media", "baja"]);
const SOURCES = new Set<KeywordSource>(KEYWORD_SOURCES);

const biText = (v: unknown): { es: string; en: string } | undefined => {
  if (typeof v === "string" && v) return { es: v, en: v };
  const o = obj(v);
  const es = str(o.es);
  return es ? { es, en: str(o.en) || es } : undefined;
};

function readIdea(v: unknown): OnPageIdea | null {
  const o = obj(v);
  const es = str(o.es);
  if (!es || !CATEGORIES.has(o.category as IdeaCategory) || !PRIORITIES.has(o.priority as IdeaPriority)) return null;
  const detail = strs(o.detail, 10, 200);
  return {
    id: (str(o.id) || "length") as IdeaId,
    category: o.category as IdeaCategory,
    priority: o.priority as IdeaPriority,
    es: es.slice(0, 600),
    en: (str(o.en) || es).slice(0, 600),
    impact: Math.max(0, num(o.impact) ?? 0),
    ...(detail.length ? { detail } : {}),
  };
}

function readStats(v: unknown): OnPageStats | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = obj(v);
  const n0 = (x: unknown) => Math.max(0, num(x) ?? 0);
  const nn = (x: unknown) => (num(x) === null ? null : Math.max(0, num(x) as number));
  return {
    words: n0(o.words),
    targetWords: nn(o.targetWords),
    title: str(o.title).slice(0, 300),
    h1: str(o.h1).slice(0, 300),
    meta: str(o.meta).slice(0, 500),
    h2: strs(o.h2, 12, 200),
    images: n0(o.images),
    imagesNoAlt: n0(o.imagesNoAlt),
    linksOut: n0(o.linksOut),
    linksIn: nn(o.linksIn),
    external: n0(o.external),
    schema: strs(o.schema, 10, 80),
    canonical: str(o.canonical),
    loadSeconds: nn(o.loadSeconds),
    loadSource: o.loadSource === "pagespeed" || o.loadSource === "server" ? o.loadSource : null,
    position: num(o.position) !== null && (num(o.position) as number) >= 1 ? (num(o.position) as number) : null,
  };
}

function readPage(v: unknown): OnPagePage | null {
  const o = obj(v);
  const url = str(o.url);
  if (!/^https?:\/\//i.test(url)) return null;
  const keyword = str(o.keyword).trim() || null;
  const score = num(o.score);
  const s = obj(o.suggestion);
  const suggestion: OnPageSuggestion | null =
    str(s.title) || str(s.metaDescription)
      ? { title: str(s.title), metaDescription: str(s.metaDescription), h1: str(s.h1), h2s: strs(s.h2s, 5, 200), provider: str(s.provider), createdAt: isoOr(s.createdAt, new Date(0).toISOString()) }
      : null;
  const b = o.brief && typeof o.brief === "object" ? obj(o.brief) : null;
  const error = biText(o.error);
  return {
    url,
    title: str(o.title).slice(0, 300),
    keyword: keyword ? keyword.slice(0, 120) : null,
    keywordSource: keyword && SOURCES.has(o.keywordSource as KeywordSource) ? (o.keywordSource as KeywordSource) : null,
    score: score === null ? null : Math.max(0, Math.min(100, Math.round(score))),
    ideas: arr(o.ideas).map(readIdea).filter((x): x is OnPageIdea => !!x).sort(byPriority).slice(0, 40),
    stats: readStats(o.stats),
    winners: arr(o.winners)
      .map(obj)
      .map((w) => ({ position: num(w.position) ?? 0, domain: str(w.domain), url: str(w.url), title: str(w.title), words: num(w.words) }))
      .filter((w) => w.position > 0 && (w.domain || w.url))
      .slice(0, 10),
    brief: b ? { headings: strs(b.headings, 12), questions: strs(b.questions, 10), terms: strs(b.terms, 20, 80), serpTitles: strs(b.serpTitles, 10) } : null,
    linksTo: strs(o.linksTo, 100, 500),
    checkedAt: isoOr(o.checkedAt, new Date(0).toISOString()),
    ...(o.needsRecheck === true ? { needsRecheck: true } : {}),
    ...(o.skipped === true ? { skipped: true } : {}),
    ...(suggestion ? { suggestion } : {}),
    ...(error ? { error } : {}),
  };
}

/** Lee un reporte "onpage" guardado sin confiar en su forma. null si no sirve. */
export function readOnPageReport(json: unknown): OnPageReport | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o.pages)) return null;
  const seen = new Set<string>();
  const pages = o.pages
    .map(readPage)
    .filter((p): p is OnPagePage => {
      if (!p || seen.has(urlKey(p.url))) return false;
      seen.add(urlKey(p.url));
      return true;
    })
    .slice(0, 30);
  const overrides: Record<string, string> = {};
  for (const [u, k] of Object.entries(obj(o.overrides))) if (/^https?:\/\//i.test(u) && typeof k === "string" && k.trim()) overrides[u] = k.trim().slice(0, 80);
  const zone = obj(o.zone);
  return {
    version: 1,
    zone: { code: num(zone.code) ?? 0, name: str(zone.name) },
    language: o.language === "en" ? "en" : "es",
    pages,
    overrides,
    cost: Math.max(0, num(o.cost) ?? 0),
    createdAt: isoOr(o.createdAt, new Date(0).toISOString()),
    stoppedEarly: o.stoppedEarly === true,
  };
}
