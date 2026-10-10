// Asistente para escribir artículos para Google (como el "SEO Writing Assistant" de Semrush):
// 1) mira los 10 primeros de Google para la búsqueda (1 llamada SERP de DataForSEO, unos US$0.002),
// 2) lee hasta 5 de esas páginas para ver cómo son (largo, títulos, subtítulos),
// 3) arma metas (largo, temas, preguntas, palabras relacionadas), la IA escribe y aquí se revisa con un puntaje.
// Todo lo que no toca la red es puro y se prueba en tests/seo-writer.test.ts.
import type { SeoBrief } from "@/lib/ai";
import { BiError } from "@/lib/i18n";
import { analyzePage, decodeEntities, fetchPublicHtml, isFileUrl, isPrivateHost } from "@/lib/seo/audit";
import { dfsPost, type Zone } from "@/lib/seo/dataforseo";

/** Resultados que se piden a Google (1 página = el precio más bajo). */
export const WRITER_DEPTH = 10;
/** Para escribir se mira Google en computadora: muestra los títulos y descripciones completos. */
export const WRITER_DEVICE = "desktop" as const;
/** Cuántas páginas de la competencia se leen, como máximo. */
export const MAX_COMPETITOR_PAGES = 5;
/** Precio de la llamada SERP "live" de una página (USD). */
export const WRITER_SERP_COST = 0.002;
/** Cuántos artículos se guardan por negocio (los más viejos se borran). */
export const MAX_ARTICLES = 30;
const PAGE_TIMEOUT_MS = 8_000;
const PAGE_MAX_BYTES = 1_500_000;

// ---------- Tipos ----------

export type WriterLang = "es" | "en";

export type SerpOrganic = { position: number; title: string; url: string; domain: string; description: string };

export type CompetitorPage = {
  position: number;
  url: string;
  domain: string;
  title: string;
  h1: string;
  /** Subtítulos H2 y H3, en orden. */
  headings: { level: 2 | 3; text: string }[];
  /** Palabras del contenido principal (sin menú ni pie cuando la página los marca). */
  words: number;
  error?: string;
};

export type KeywordResearch = {
  keyword: string;
  language: WriterLang;
  location: string;
  locationCode: number;
  organic: SerpOrganic[];
  /** "La gente también pregunta". */
  questions: string[];
  /** "Búsquedas relacionadas" y "la gente también busca". */
  related: string[];
  localPack: boolean;
  aiOverview: boolean;
  featuredSnippet: boolean;
  pages: CompetitorPage[];
  /** Lo que costó en DataForSEO (USD). */
  cost: number;
};

export type ContentTargets = {
  /** Largo recomendado (mediana de los que ganan, entre 600 y 2500). */
  wordCount: number;
  /** Las palabras de cada página leída (para mostrar). */
  competitorWords: number[];
  /** Temas que repiten los que ganan, con cuántas páginas los tocan. */
  headings: { text: string; pages: number }[];
  /** Preguntas para contestar (de "La gente también pregunta"). */
  questions: string[];
  /** Palabras y frases que usan los que ganan. */
  terms: string[];
};

export type ArticleDraft = {
  title: string;
  metaDescription: string;
  slug: string;
  h1: string;
  outline: string[];
  markdown: string;
  socialPost: string;
};

export type CheckId =
  | "title-keyword"
  | "title-length"
  | "h1-keyword"
  | "intro-keyword"
  | "h2-keyword"
  | "meta"
  | "length"
  | "questions"
  | "terms"
  | "cta"
  | "sentences"
  | "paragraphs";

export type CheckItem = { id: CheckId; ok: boolean; points: number; max: number; es: string; en: string };

export type ArticleReport = {
  version: 1;
  keyword: string;
  language: WriterLang;
  zone: { code: number; name: string };
  research: KeywordResearch;
  targets: ContentTargets;
  draft: ArticleDraft;
  score: number;
  checklist: CheckItem[];
  /** DataForSEO (USD). La IA se cobra aparte en la cuenta de cada IA. */
  cost: number;
  /** La IA que escribió (gemini | claude | openai). */
  provider: string;
  createdAt: string;
  improvedAt?: string;
  /** El puntaje antes de "Mejorar con IA". */
  previousScore?: number;
  /** «Publicar en mi web»: la vista previa y lo publicado (forma: ArticleSite, se lee con readArticleSite en site-article.ts). */
  site?: unknown;
};

// ---------- Texto ----------

/** Palabras vacías en español e inglés (no dicen de qué trata un texto). */
export const STOPWORDS = new Set(
  (
    // español
    "a al algo algun alguna algunas alguno algunos ante antes aqui asi aun bajo bien cada casi como con contra cual cuales cuando cuanto " +
    "cuantos cuanta cuantas de del desde donde dos el ella ellas ellos en entre era es esa esas ese eso esos esta estas este esto estos " +
    "estan esta estar fue fueron ha hace hacer han hasta hay la las le les lo los mas me mi mis muy mucho muchos nada ni no nos nuestra " +
    "nuestro nuestros nuestras o os otra otras otro otros para pero poco por porque puede pueden que quien quienes se sea ser si sin " +
    "sobre son su sus tal tambien tan tanto te tiene tienen todo todos toda todas tu tus un una unas uno unos usted ustedes y ya yo " +
    "vez veces cosa cosas aqui alli ahi tras segun mediante durante cerca lejos mejor mejores peor sabe saber debe deben hacerlo " +
    // inglés
    "about above after again all also am an and any are as at be because been before being below between both but by can could " +
    "did do does doing down during each few for from further get gets got had has have having he her here hers him his how i if in " +
    "into is it its itself just let me more most my no nor not now of off on once only or other our ours out over own same she " +
    "should so some such than that the their theirs them then there these they this those through to too under until up very was " +
    "we were what when where which while who whom why will with would you your yours best top near me vs via per " +
    // web
    "com www http https html php"
  ).split(" "),
);

/** Minúsculas, sin acentos ni signos: "¿Cuánto cuesta?" → "cuanto cuesta". */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Raíz muy simple para comparar plurales y variantes cercanas ("techos" ≈ "techo", "reparación" ≈ "reparacion"). */
export function stem(word: string): string {
  let w = word;
  if (w.length > 5 && w.endsWith("es")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s")) w = w.slice(0, -1);
  return w.slice(0, 7);
}

const tokens = (s: string) => norm(s).split(" ").filter(Boolean);
/** Palabras con significado (sin palabras vacías ni números sueltos). */
const meaningful = (s: string) => tokens(s).filter((w) => !STOPWORDS.has(w) && !/^\d+$/.test(w) && w.length > 1);
/** Raíces de las palabras con significado de un texto. */
export const stems = (s: string) => meaningful(s).map(stem);

/** ¿El texto contiene la palabra clave? Todas sus palabras con significado, en cualquier orden y aceptando plurales. */
export function hasKeyword(text: string, keyword: string): boolean {
  const need = stems(keyword);
  if (!need.length) return norm(text).includes(norm(keyword));
  const have = new Set(stems(text));
  return need.every((w) => have.has(w));
}

/** ¿El texto usa la frase (por raíces, palabras seguidas)? */
function hasPhrase(textStems: string[], phrase: string): boolean {
  const p = stems(phrase);
  if (!p.length) return false;
  outer: for (let i = 0; i + p.length <= textStems.length; i++) {
    for (let j = 0; j < p.length; j++) if (textStems[i + j] !== p[j]) continue outer;
    return true;
  }
  return false;
}

export const countWords = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

// ---------- Markdown ----------

export type MdBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "hr" };

/** Divide el Markdown en bloques: títulos, párrafos, listas y separadores. */
export function parseMarkdown(md: string): MdBlock[] {
  const out: MdBlock[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (para.length) out.push({ type: "paragraph", text: para.join(" ") });
    para = [];
    if (list) out.push({ type: "list", ...list });
    list = null;
  };
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (h) {
      flush();
      out.push({ type: "heading", level: h[1].length, text: h[2].trim() });
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(line)) {
      flush();
      out.push({ type: "hr" });
      continue;
    }
    const li = /^(?:([-*+])|(\d{1,3})[.)])\s+(.+)$/.exec(line);
    if (li) {
      const ordered = !li[1];
      if (para.length) {
        out.push({ type: "paragraph", text: para.join(" ") });
        para = [];
      }
      if (list && list.ordered !== ordered) {
        out.push({ type: "list", ...list });
        list = null;
      }
      list ??= { ordered, items: [] };
      list.items.push(li[3]);
      continue;
    }
    if (list) {
      // Una línea con sangría debajo de un punto de la lista es parte de ese punto.
      if (/^\s{2,}/.test(raw)) {
        list.items[list.items.length - 1] += ` ${line}`;
        continue;
      }
      out.push({ type: "list", ...list });
      list = null;
    }
    para.push(line.replace(/^>\s?/, ""));
  }
  flush();
  return out;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

/** Solo enlaces web, de correo o de teléfono. */
const SAFE_URL = /^(https?:\/\/|mailto:|tel:)/i;

/** Negritas, cursivas y enlaces dentro de una línea. Todo lo demás se escapa. */
export function inlineHtml(text: string): string {
  const links: string[] = [];
  // Primero los enlaces (con la dirección revisada), guardados aparte para que las negritas no los toquen.
  let s = text.replace(/\u0000/g, "").replace(/\[([^\]\n]{1,300})\]\(\s*([^)\s]{1,2000})(?:\s+"[^"]*")?\s*\)/g, (_m, label: string, url: string) => {
    const inner = emphasis(escapeHtml(label));
    const html = SAFE_URL.test(url) && !/[\s<>"'`]/.test(url) ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer nofollow" target="_blank">${inner}</a>` : inner;
    links.push(html);
    return `\u0000${links.length - 1}\u0000`;
  });
  s = emphasis(escapeHtml(s));
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => links[Number(i)] ?? "");
}

function emphasis(escaped: string): string {
  return escaped
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/__(?=\S)([\s\S]*?\S)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/**
 * Markdown sencillo → HTML seguro: títulos, párrafos, negritas, cursivas, listas y enlaces (solo http, https,
 * mailto y tel). Cualquier HTML que venga en el texto se muestra como texto, no se ejecuta.
 */
export function markdownToHtml(md: string): string {
  return parseMarkdown(md)
    .map((b) => {
      if (b.type === "heading") {
        const level = Math.min(6, Math.max(2, b.level));
        return `<h${level}>${inlineHtml(b.text)}</h${level}>`;
      }
      if (b.type === "paragraph") return `<p>${inlineHtml(b.text)}</p>`;
      if (b.type === "hr") return "<hr>";
      const tag = b.ordered ? "ol" : "ul";
      return `<${tag}>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</${tag}>`;
    })
    .join("\n");
}

/** El texto sin símbolos de Markdown (para contar palabras y buscar). */
export function markdownText(md: string): string {
  return md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d{1,3}[.)])\s+/gm, "")
    .replace(/[*_`]+/g, "");
}

/** El artículo completo como HTML (con el H1 arriba), para pegarlo en el sitio. */
export function articleHtml(draft: Pick<ArticleDraft, "h1" | "markdown">): string {
  return `${draft.h1.trim() ? `<h1>${inlineHtml(draft.h1.trim())}</h1>\n` : ""}${markdownToHtml(stripH1(draft.markdown))}`;
}

/** El artículo en Markdown con el H1 arriba (si el texto no lo trae ya). */
export function articleMarkdown(draft: Pick<ArticleDraft, "h1" | "markdown">): string {
  const body = stripH1(draft.markdown).trim();
  return draft.h1.trim() ? `# ${draft.h1.trim()}\n\n${body}\n` : `${body}\n`;
}

/** Quita un "# Título" del principio (el H1 va aparte). */
export function stripH1(md: string): string {
  return md.replace(/^\s*#\s+[^\n]*\n?/, "");
}

// ---------- Google (SERP) ----------

type RawItem = {
  type?: unknown;
  rank_group?: unknown;
  title?: unknown;
  url?: unknown;
  domain?: unknown;
  description?: unknown;
  items?: unknown;
};
export type WriterSerpResult = { item_types?: unknown; items?: unknown };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** "https://www.Ejemplo.com/x" → "ejemplo.com". */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

const uniqueText = (list: string[], max: number) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = raw.replace(/\s+/g, " ").trim();
    const k = norm(s);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s.slice(0, 200));
    if (out.length >= max) break;
  }
  return out;
};

/** Lee la respuesta de Google: los resultados normales, las preguntas, las búsquedas relacionadas y qué más muestra. */
export function parseWriterSerp(result: WriterSerpResult | null | undefined): Pick<KeywordResearch, "organic" | "questions" | "related" | "localPack" | "aiOverview" | "featuredSnippet"> {
  const items = arr(result?.items).map(obj) as RawItem[];
  const types = new Set([...arr(result?.item_types).filter((x): x is string => typeof x === "string"), ...items.map((i) => str(i.type))]);
  const organic: SerpOrganic[] = items
    .filter((i) => i.type === "organic" && num(i.rank_group) !== null && /^https?:\/\//i.test(str(i.url)))
    .sort((a, b) => (num(a.rank_group) ?? 0) - (num(b.rank_group) ?? 0))
    .slice(0, 10)
    .map((i) => ({
      position: num(i.rank_group) as number,
      title: str(i.title).slice(0, 200),
      url: str(i.url),
      domain: (str(i.domain) || hostOf(str(i.url))).toLowerCase().replace(/^www\./, ""),
      description: str(i.description).slice(0, 400),
    }));
  const questions = uniqueText(
    items.filter((i) => i.type === "people_also_ask").flatMap((i) => arr(i.items).map((q) => str(obj(q).title) || str(q))),
    10,
  );
  const related = uniqueText(
    items
      .filter((i) => i.type === "related_searches" || i.type === "people_also_search")
      .flatMap((i) => arr(i.items).map((q) => (typeof q === "string" ? q : str(obj(q).title)))),
    12,
  );
  return {
    organic,
    questions,
    related,
    localPack: types.has("local_pack") || types.has("map"),
    aiOverview: types.has("ai_overview"),
    featuredSnippet: types.has("featured_snippet"),
  };
}

// ---------- Páginas de la competencia ----------

/** Directorios, redes y sitios de video: no sirven de modelo para un artículo. */
export const SKIP_DOMAINS = [
  "facebook.com", "instagram.com", "youtube.com", "tiktok.com", "twitter.com", "x.com", "linkedin.com", "pinterest.com",
  "reddit.com", "quora.com", "yelp.com", "yellowpages.com", "bbb.org", "angi.com", "angieslist.com", "homeadvisor.com",
  "thumbtack.com", "nextdoor.com", "houzz.com", "porch.com", "mapquest.com", "tripadvisor.com", "google.com", "amazon.com",
  "ebay.com", "craigslist.org", "manta.com", "chamberofcommerce.com", "paginasamarillas.com", "foursquare.com", "indeed.com",
  "glassdoor.com", "groupon.com", "expertise.com", "superpages.com", "trustpilot.com",
];

export function skipDomain(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return /(^|\.)google\.[a-z.]+$/.test(d) || SKIP_DOMAINS.some((s) => d === s || d.endsWith(`.${s}`));
}

/** Las páginas que vale la pena leer: sin directorios ni redes, sin archivos, una por sitio. */
export function pagesToRead(organic: SerpOrganic[], max = MAX_COMPETITOR_PAGES): SerpOrganic[] {
  const seen = new Set<string>();
  const out: SerpOrganic[] = [];
  for (const o of organic) {
    let host = "";
    try {
      const u = new URL(o.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      host = u.hostname.toLowerCase().replace(/^www\./, "");
      if (isPrivateHost(u.hostname)) continue;
    } catch {
      continue;
    }
    if (skipDomain(host) || skipDomain(o.domain) || isFileUrl(o.url) || seen.has(host)) continue;
    seen.add(host);
    out.push(o);
    if (out.length >= max) break;
  }
  return out;
}

const textOf = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

const JUNK_HEADING =
  /^(menu|men[uú]|search|buscar|share|compartir|comments?|comentarios|leave a (reply|comment)|deja un comentario|related (posts|articles)|art[ií]culos relacionados|entradas relacionadas|recent posts|entradas recientes|categories|categor[ií]as|tags|etiquetas|subscribe|suscr[ií]bete|newsletter|follow us|s[ií]guenos|contact( us)?|cont[aá]ctanos|contacto|navigation|navegaci[oó]n|footer|sidebar|about( the)? author|sobre el autor|table of contents|tabla de contenidos?|contenidos|índice|indice|you may also like|tambi[eé]n te puede interesar|quick links|enlaces r[aá]pidos|get in touch|cookies?.*)$/i;

/** Los subtítulos H2 y H3 del contenido (sin menú, pie ni barras laterales). */
export function extractHeadings(html: string, max = 30): { level: 2 | 3; text: string }[] {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|nav|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ");
  const out: { level: 2 | 3; text: string }[] = [];
  for (const m of body.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = textOf(m[2]).replace(/\s*[:|·]\s*$/, "");
    if (text.length < 3 || text.length > 140 || JUNK_HEADING.test(text) || !/\p{L}/u.test(text)) continue;
    out.push({ level: m[1] === "2" ? 2 : 3, text });
    if (out.length >= max) break;
  }
  return out;
}

/** Palabras del contenido principal: el <article> o <main> más grande si existe; si no, toda la página. */
export function mainWords(html: string, fallback: number): number {
  const clean = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template|svg|nav|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ");
  let best = 0;
  for (const m of clean.matchAll(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/gi)) best = Math.max(best, countWords(textOf(m[2])));
  return best >= 150 ? best : fallback;
}

/** Lo que se saca de una página leída. */
export function analyzeCompetitor(html: string, finalUrl: string, o: SerpOrganic): CompetitorPage {
  const a = analyzePage(html, finalUrl);
  return {
    position: o.position,
    url: finalUrl,
    domain: hostOf(finalUrl) || o.domain,
    title: a.title.slice(0, 200) || o.title,
    h1: a.h1,
    headings: extractHeadings(html),
    words: mainWords(html, a.words),
  };
}

const errMsg = (e: unknown) =>
  e instanceof BiError ? e.message : e instanceof Error ? (e.name === "TimeoutError" || e.name === "AbortError" ? "timeout" : e.message).slice(0, 160) : String(e).slice(0, 160);

/**
 * Investiga una búsqueda en la zona principal: 1 consulta a Google (DataForSEO, 10 resultados, computadora)
 * y la lectura de hasta 5 páginas que ganan, al mismo tiempo, 8 segundos máximo cada una.
 * Si una página no se puede leer, se sigue con las demás.
 */
export async function researchKeyword(keyword: string, zone: Zone, language: WriterLang): Promise<KeywordResearch> {
  const r = await dfsPost<WriterSerpResult>(
    "/serp/google/organic/live/advanced",
    { keyword, location_code: zone.code, language_code: language, device: WRITER_DEVICE, depth: WRITER_DEPTH },
    60_000,
  );
  const serp = parseWriterSerp(r.result[0]);
  const pages = await Promise.all(
    pagesToRead(serp.organic).map(async (o): Promise<CompetitorPage> => {
      try {
        const page = await fetchPublicHtml(o.url, PAGE_TIMEOUT_MS, PAGE_MAX_BYTES);
        return analyzeCompetitor(page.html, page.url, o);
      } catch (e) {
        return { position: o.position, url: o.url, domain: o.domain, title: o.title, h1: "", headings: [], words: 0, error: errMsg(e) };
      }
    }),
  );
  return { keyword, language, location: zone.name, locationCode: zone.code, ...serp, pages, cost: Math.round(r.cost * 10000) / 10000 };
}

// ---------- Metas ----------

const median = (list: number[]) => {
  const s = [...list].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Largo por defecto cuando no se pudo leer ninguna página. */
export const DEFAULT_WORDS = 1000;
/** Una página con menos palabras que esto no cuenta para el largo (no se leyó bien o es solo un formulario). */
const MIN_PAGE_WORDS = 200;

const QUESTION_START = /^(¿|que|qué|como|cómo|cuanto|cuánto|cuanta|cuánta|cuantos|cuántos|cual|cuál|cuales|cuáles|cuando|cuándo|donde|dónde|por que|por qué|quien|quién|what|how|why|when|where|which|who|is|are|can|do|does|should|will)\b/i;

/**
 * Lo que hacen los que ganan, para que el artículo lo cubra:
 * - largo: la mediana de las páginas leídas, entre 600 y 2500 palabras (redondeado a 50);
 * - temas: los subtítulos cuyas palabras se repiten en más páginas;
 * - preguntas: "La gente también pregunta" (y, si hay pocas, subtítulos que son preguntas);
 * - palabras relacionadas: palabras y pares de palabras que aparecen en 2 o más fuentes (títulos, subtítulos, descripciones).
 */
export function contentTargets(research: Pick<KeywordResearch, "keyword" | "organic" | "questions" | "related" | "pages">): ContentTargets {
  const read = research.pages.filter((p) => !p.error && p.words >= MIN_PAGE_WORDS);
  const competitorWords = read.map((p) => p.words);
  const wordCount = read.length ? Math.round(Math.min(2500, Math.max(600, median(competitorWords))) / 50) * 50 : DEFAULT_WORDS;
  const keyStems = new Set(stems(research.keyword));

  // Temas: frecuencia de cada raíz en los subtítulos de páginas distintas.
  const pages = research.pages.filter((p) => !p.error && p.headings.length);
  const pageStems = pages.map((p) => new Set(p.headings.flatMap((h) => stems(h.text)).filter((w) => !keyStems.has(w))));
  const df = new Map<string, number>();
  for (const set of pageStems) for (const w of set) df.set(w, (df.get(w) ?? 0) + 1);
  type Cand = { text: string; set: Set<string>; score: number; page: number; order: number };
  const cands: Cand[] = [];
  pages.forEach((p, pi) =>
    p.headings.forEach((h, hi) => {
      const set = new Set(stems(h.text).filter((w) => !keyStems.has(w)));
      if (!set.size || h.text.length > 90) return;
      const shared = [...set].reduce((s, w) => s + ((df.get(w) ?? 1) - 1), 0);
      cands.push({ text: h.text, set, score: shared / Math.sqrt(set.size), page: pi, order: hi });
    }),
  );
  const similar = (a: Set<string>, b: Set<string>) => {
    const inter = [...a].filter((w) => b.has(w)).length;
    return inter / Math.min(a.size, b.size) >= 0.6;
  };
  const headings: { text: string; pages: number }[] = [];
  const picked: Set<string>[] = [];
  const ranked = cands.filter((c) => c.score > 0).sort((a, b) => b.score - a.score || a.page - b.page || a.order - b.order);
  const fallback = cands.filter((c) => c.page === 0 && !QUESTION_START.test(norm(c.text))).sort((a, b) => a.order - b.order);
  for (const c of ranked.length ? ranked : fallback) {
    if (picked.some((s) => similar(s, c.set))) continue;
    picked.push(c.set);
    const n = pageStems.filter((ps) => [...c.set].filter((w) => ps.has(w)).length / c.set.size >= 0.5).length;
    headings.push({ text: c.text, pages: Math.max(1, n) });
    if (headings.length >= 8) break;
  }

  // Preguntas.
  const asQuestion = (s: string) => /\?\s*$/.test(s) || QUESTION_START.test(s.trim());
  let questions = uniqueText(research.questions, 8);
  if (questions.length < 3) {
    const fromHeadings = research.pages.flatMap((p) => p.headings.map((h) => h.text)).filter(asQuestion);
    questions = uniqueText([...questions, ...fromHeadings], 6);
  }

  // Palabras relacionadas: cada fuente cuenta una vez por término.
  const docs = [
    ...research.pages.filter((p) => !p.error).map((p) => [p.title, p.h1, ...p.headings.map((h) => h.text)].join(" . ")),
    ...research.organic.map((o) => `${o.title} . ${o.description}`),
    ...research.related,
  ];
  const termDf = new Map<string, number>();
  const surface = new Map<string, Map<string, number>>();
  const see = (key: string, form: string) => {
    const m = surface.get(key) ?? new Map<string, number>();
    m.set(form, (m.get(form) ?? 0) + 1);
    surface.set(key, m);
  };
  for (const doc of docs) {
    const seen = new Set<string>();
    // Se separa por signos para no unir palabras de frases distintas.
    for (const chunk of doc.toLowerCase().split(/[.,;:!?¿¡|()\[\]"“”«»–—\-/]+/)) {
      const words = (chunk.match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => ({ form: w, n: norm(w) }));
      const good = (w: { n: string }) => w.n.length >= 3 && !STOPWORDS.has(w.n) && !/^\d+$/.test(w.n);
      words.forEach((w, i) => {
        if (good(w) && w.n.length >= 4 && !keyStems.has(stem(w.n))) {
          const k = stem(w.n);
          see(k, w.form);
          seen.add(k);
        }
        const nx = words[i + 1];
        if (nx && good(w) && good(nx) && !(keyStems.has(stem(w.n)) && keyStems.has(stem(nx.n)))) {
          const k = `${stem(w.n)} ${stem(nx.n)}`;
          see(k, `${w.form} ${nx.form}`);
          seen.add(k);
        }
      });
    }
    for (const k of seen) termDf.set(k, (termDf.get(k) ?? 0) + 1);
  }
  const best = (k: string) => [...(surface.get(k) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? k;
  const termCands = [...termDf.entries()]
    .filter(([, n]) => n >= 2)
    .map(([k, n]) => ({ k, n, score: n * (k.includes(" ") ? 1.6 : 1) }))
    .sort((a, b) => b.score - a.score || a.k.localeCompare(b.k));
  const chosen: string[] = [];
  for (const c of termCands) {
    const parts = c.k.split(" ");
    // Si ya está el par de palabras, la palabra sola sobra (y al revés, el par repite algo ya elegido dos veces).
    if (parts.length === 1 && chosen.some((x) => x.split(" ").includes(c.k))) continue;
    if (parts.length === 2 && parts.every((p) => chosen.includes(p))) continue;
    chosen.push(c.k);
    if (chosen.length >= 15) break;
  }
  const terms = uniqueText(chosen.map(best), 15);

  return { wordCount, competitorWords, headings, questions, terms };
}

// ---------- Revisión del borrador ----------

/**
 * Puntos de cada revisión (suman 100):
 * - palabra clave en el título SEO 10, título de 60 letras o menos 5, en el H1 8, en las primeras 100 palabras 8, en un subtítulo 7;
 * - meta descripción de 120 a 160 letras con la palabra clave 10 (la mitad si falta una de las dos cosas);
 * - largo dentro de ±25 % de la meta 15 (la mitad si está dentro de ±50 %);
 * - preguntas contestadas 12 y palabras relacionadas 10 (proporcional a cuántas cubre);
 * - llamada a la acción con el teléfono o la página del negocio 8 (la mitad si invita a contactar sin dar el dato);
 * - oraciones cortas (promedio de menos de 20 palabras) 4 y párrafos cortos (ninguno de más de 150 palabras) 3.
 */
export const CHECK_WEIGHTS: Record<CheckId, number> = {
  "title-keyword": 10,
  "title-length": 5,
  "h1-keyword": 8,
  "intro-keyword": 8,
  "h2-keyword": 7,
  meta: 10,
  length: 15,
  questions: 12,
  terms: 10,
  cta: 8,
  sentences: 4,
  paragraphs: 3,
};

/** Cuántas preguntas hace falta contestar y cuántos términos usar para tener todos los puntos. */
const QUESTIONS_NEEDED = 4;
const TERMS_NEEDED = 6;

/** Los subtítulos del borrador y las líneas que son solo negritas (preguntas frecuentes escritas así). */
function draftHeadings(md: string): string[] {
  const blocks = parseMarkdown(md);
  return [
    ...blocks.filter((b): b is Extract<MdBlock, { type: "heading" }> => b.type === "heading" && b.level >= 2).map((b) => b.text),
    ...blocks.filter((b): b is Extract<MdBlock, { type: "paragraph" }> => b.type === "paragraph").map((b) => /^\*\*(.+?)\*\*/.exec(b.text)?.[1] ?? "").filter(Boolean),
  ];
}

/** ¿Algún subtítulo contesta la pregunta? (comparte al menos 60 % de sus palabras con significado). */
function covers(heading: string, question: string): boolean {
  const q = new Set(stems(question));
  if (!q.size) return false;
  const h = new Set(stems(heading));
  return [...q].filter((w) => h.has(w)).length / q.size >= 0.6;
}

/** Qué metas cumple el borrador: cada tema, pregunta y término (en el mismo orden que en las metas). */
export function targetUsage(draft: Pick<ArticleDraft, "markdown" | "h1" | "title">, targets: ContentTargets): { headings: boolean[]; questions: boolean[]; terms: boolean[] } {
  const heads = draftHeadings(draft.markdown);
  const allStems = stems(`${draft.title} . ${draft.h1} . ${markdownText(draft.markdown)}`);
  return {
    headings: targets.headings.map((t) => heads.some((h) => covers(h, t.text))),
    questions: targets.questions.map((q) => heads.some((h) => covers(h, q))),
    terms: targets.terms.map((t) => hasPhrase(allStems, t)),
  };
}

/** Promedio de palabras por oración y el párrafo más largo. */
export function readability(md: string): { avgSentence: number; longestParagraph: number; sentences: number } {
  const blocks = parseMarkdown(md);
  const texts = blocks.flatMap((b) => (b.type === "paragraph" ? [b.text] : b.type === "list" ? b.items : [])).map((t) => markdownText(t));
  const sentences = texts.flatMap((t) => t.split(/(?<=[.!?…])\s+|\n+/)).map(countWords).filter((n) => n > 0);
  const paragraphs = blocks.filter((b) => b.type === "paragraph").map((b) => countWords(markdownText((b as { text: string }).text)));
  return {
    avgSentence: sentences.length ? Math.round((sentences.reduce((s, n) => s + n, 0) / sentences.length) * 10) / 10 : 0,
    longestParagraph: paragraphs.length ? Math.max(...paragraphs) : 0,
    sentences: sentences.length,
  };
}

const digits = (s: string) => s.replace(/\D/g, "");

/** El dominio de la página del negocio ("https://www.ejemplo.com/" → "ejemplo.com"). */
function websiteHost(website: string): string {
  const raw = website.trim();
  if (!raw) return "";
  return hostOf(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
}

const CONTACT_WORDS =
  /\b(ll[aá]m[aeo]\w*|cont[aá]ct\w*|escr[ií]be\w*|agend\w*|visit\w*|pide|solicita|cotiza\w*|whatsapp|call|contact|reach out|schedule|book|visit|request|get (a|your) (free )?(quote|estimate))\b/i;

/**
 * Revisa el borrador contra las metas: puntaje de 0 a 100 y la lista de lo que cumple y lo que falta
 * (en español e inglés). Los pesos están en CHECK_WEIGHTS.
 */
export function scoreDraft(
  draft: ArticleDraft,
  keyword: string,
  targets: ContentTargets,
  business: { phone?: string; website?: string } = {},
): { score: number; checklist: CheckItem[] } {
  const items: CheckItem[] = [];
  const add = (id: CheckId, fraction: number, es: string, en: string) => {
    const max = CHECK_WEIGHTS[id];
    const f = Math.max(0, Math.min(1, fraction));
    items.push({ id, ok: f >= 0.999, points: Math.round(max * f * 10) / 10, max, es, en });
  };
  const body = stripH1(draft.markdown);
  const h1 = draft.h1.trim() || /^\s*#\s+([^\n]+)/.exec(draft.markdown)?.[1]?.trim() || "";
  const plain = markdownText(body);
  const words = countWords(plain);
  const kw = `“${keyword}”`;

  const inTitle = hasKeyword(draft.title, keyword);
  add("title-keyword", inTitle ? 1 : 0, inTitle ? `El título SEO tiene ${kw}.` : `Pon ${kw} en el título SEO.`, inTitle ? `The SEO title has ${kw}.` : `Put ${kw} in the SEO title.`);
  const tl = draft.title.trim().length;
  add(
    "title-length",
    tl > 0 && tl <= 60 ? 1 : 0,
    tl > 60 ? `El título SEO tiene ${tl} letras: déjalo en 60 o menos para que Google no lo corte.` : tl ? `El título SEO mide ${tl} letras (60 o menos).` : "Falta el título SEO.",
    tl > 60 ? `The SEO title is ${tl} characters: keep it at 60 or fewer so Google doesn't cut it.` : tl ? `The SEO title is ${tl} characters (60 or fewer).` : "The SEO title is missing.",
  );
  const inH1 = !!h1 && hasKeyword(h1, keyword);
  add("h1-keyword", inH1 ? 1 : 0, inH1 ? `El título principal (H1) tiene ${kw}.` : `Pon ${kw} en el título principal (H1).`, inH1 ? `The main heading (H1) has ${kw}.` : `Put ${kw} in the main heading (H1).`);

  const intro = markdownText(parseMarkdown(body).filter((b) => b.type !== "heading").map((b) => (b.type === "paragraph" ? b.text : b.type === "list" ? b.items.join(" ") : "")).join(" "))
    .split(/\s+/)
    .slice(0, 100)
    .join(" ");
  const inIntro = hasKeyword(intro, keyword);
  add("intro-keyword", inIntro ? 1 : 0, inIntro ? `${kw} aparece en las primeras 100 palabras.` : `Usa ${kw} en las primeras 100 palabras.`, inIntro ? `${kw} shows up in the first 100 words.` : `Use ${kw} in the first 100 words.`);
  const heads = parseMarkdown(body).filter((b) => b.type === "heading" && b.level >= 2) as { text: string }[];
  const inH2 = heads.some((h) => hasKeyword(h.text, keyword));
  add("h2-keyword", inH2 ? 1 : 0, inH2 ? `Un subtítulo tiene ${kw}.` : `Usa ${kw} en al menos un subtítulo.`, inH2 ? `A subheading has ${kw}.` : `Use ${kw} in at least one subheading.`);

  const meta = draft.metaDescription.trim();
  const ml = meta.length;
  const metaLenOk = ml >= 120 && ml <= 160;
  const metaKw = ml > 0 && hasKeyword(meta, keyword);
  add(
    "meta",
    !ml ? 0 : (metaLenOk ? 0.5 : 0) + (metaKw ? 0.5 : 0),
    !ml
      ? "Falta la descripción para Google (meta descripción)."
      : metaLenOk && metaKw
        ? `La descripción para Google mide ${ml} letras y tiene ${kw}.`
        : `La descripción para Google mide ${ml} letras${metaLenOk ? "" : " (debe tener entre 120 y 160)"}${metaKw ? "" : ` y le falta ${kw}`}.`,
    !ml
      ? "The Google description (meta description) is missing."
      : metaLenOk && metaKw
        ? `The Google description is ${ml} characters and has ${kw}.`
        : `The Google description is ${ml} characters${metaLenOk ? "" : " (it should be 120 to 160)"}${metaKw ? "" : ` and is missing ${kw}`}.`,
  );

  const target = targets.wordCount || DEFAULT_WORDS;
  const off = Math.abs(words - target) / target;
  add(
    "length",
    off <= 0.25 ? 1 : off <= 0.5 ? 0.5 : 0,
    off <= 0.25
      ? `Largo bien: ${words} palabras (meta: unas ${target}).`
      : words < target
        ? `El artículo es corto: ${words} palabras. Los que ganan tienen unas ${target}.`
        : `El artículo es largo: ${words} palabras. Los que ganan tienen unas ${target}.`,
    off <= 0.25
      ? `Good length: ${words} words (target: about ${target}).`
      : words < target
        ? `The article is short: ${words} words. The winners have about ${target}.`
        : `The article is long: ${words} words. The winners have about ${target}.`,
  );

  const usage = targetUsage(draft, targets);
  const qNeed = Math.min(QUESTIONS_NEEDED, targets.questions.length);
  const qHave = usage.questions.filter(Boolean).length;
  add(
    "questions",
    qNeed ? qHave / qNeed : 1,
    qNeed ? `Contesta ${qHave} de ${targets.questions.length} preguntas que hace la gente${qHave >= qNeed ? "." : ` (meta: ${qNeed}).`}` : "Google no mostró preguntas para esta búsqueda.",
    qNeed ? `Answers ${qHave} of ${targets.questions.length} questions people ask${qHave >= qNeed ? "." : ` (target: ${qNeed}).`}` : "Google showed no questions for this search.",
  );
  const tNeed = Math.min(TERMS_NEEDED, targets.terms.length);
  const tHave = usage.terms.filter(Boolean).length;
  add(
    "terms",
    tNeed ? tHave / tNeed : 1,
    tNeed ? `Usa ${tHave} de ${targets.terms.length} palabras relacionadas${tHave >= tNeed ? "." : ` (meta: ${tNeed}).`}` : "No encontramos palabras relacionadas para medir.",
    tNeed ? `Uses ${tHave} of ${targets.terms.length} related terms${tHave >= tNeed ? "." : ` (target: ${tNeed}).`}` : "We found no related terms to measure.",
  );

  // Llamada a la acción: en el último tercio del artículo.
  const all = plain.split(/\s+/);
  const tail = all.slice(Math.floor(all.length * 0.66)).join(" ");
  const phone = digits(business.phone ?? "");
  const host = websiteHost(business.website ?? "");
  const hasPhone = phone.length >= 7 && digits(tail).includes(phone.slice(-7));
  const hasSite = !!host && tail.toLowerCase().includes(host);
  const known = phone.length >= 7 || !!host;
  const invites = CONTACT_WORDS.test(tail);
  const cta = hasPhone || hasSite ? 1 : !known && invites ? 1 : invites ? 0.5 : 0;
  add(
    "cta",
    cta,
    cta === 1
      ? "Termina invitando a contactar al negocio."
      : invites
        ? `Invita a contactar, pero sin ${phone ? "el teléfono" : "la página"} del negocio.`
        : `Termina con una invitación a contactar${known ? ` (con ${[phone && "el teléfono", host && "la página web"].filter(Boolean).join(" o ")})` : ""}.`,
    cta === 1
      ? "It ends by inviting readers to contact the business."
      : invites
        ? `It invites readers to get in touch, but without the business's ${phone ? "phone" : "website"}.`
        : `End with an invitation to get in touch${known ? ` (with ${[phone && "the phone", host && "the website"].filter(Boolean).join(" or ")})` : ""}.`,
  );

  const r = readability(body);
  const shortSentences = r.sentences > 0 && r.avgSentence < 20;
  add(
    "sentences",
    shortSentences ? 1 : 0,
    shortSentences ? `Oraciones fáciles de leer (${r.avgSentence} palabras en promedio).` : `Oraciones largas (${r.avgSentence} palabras en promedio): córtalas a menos de 20.`,
    shortSentences ? `Easy-to-read sentences (${r.avgSentence} words on average).` : `Long sentences (${r.avgSentence} words on average): cut them to under 20.`,
  );
  const shortParas = r.longestParagraph > 0 && r.longestParagraph <= 150;
  add(
    "paragraphs",
    shortParas ? 1 : 0,
    shortParas ? "Párrafos cortos." : `Hay un párrafo de ${r.longestParagraph} palabras: divídelo (máximo 150).`,
    shortParas ? "Short paragraphs." : `There's a ${r.longestParagraph}-word paragraph: split it (150 max).`,
  );

  const score = Math.round(items.reduce((s, i) => s + i.points, 0));
  return { score: Math.max(0, Math.min(100, score)), checklist: items };
}

// ---------- Para la IA ----------

/** Lo que la IA necesita saber de la investigación (sin las páginas completas). */
export function briefFor(research: KeywordResearch, targets: ContentTargets, zoneName: string): SeoBrief {
  return {
    zone: zoneName,
    wordCount: targets.wordCount,
    headings: targets.headings.map((h) => h.text),
    questions: targets.questions,
    terms: targets.terms,
    relatedSearches: research.related.slice(0, 10),
    competitors: research.pages
      .filter((p) => !p.error)
      .map((p) => ({ title: p.title, h1: p.h1, headings: p.headings.slice(0, 15).map((h) => h.text), words: p.words })),
    serpTitles: research.organic.map((o) => o.title).filter(Boolean),
    localPack: research.localPack,
    aiOverview: research.aiOverview,
  };
}

/** URL amigable: minúsculas, sin acentos, palabras unidas por guiones. */
export function slugify(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "") || "articulo"
  );
}

/** Limpia lo que devolvió la IA (espacios, slug, H1 repetido en el texto). */
export function cleanDraft(d: ArticleDraft): ArticleDraft {
  const h1 = d.h1.replace(/^#+\s*/, "").trim().slice(0, 200);
  return {
    title: d.title.replace(/\s+/g, " ").trim().slice(0, 200),
    metaDescription: d.metaDescription.replace(/\s+/g, " ").trim().slice(0, 400),
    slug: slugify(d.slug || d.title),
    h1,
    outline: d.outline.map((o) => o.replace(/^#+\s*/, "").trim()).filter(Boolean).slice(0, 20),
    markdown: stripH1(d.markdown.replace(/\r\n?/g, "\n")).trim().slice(0, 60_000),
    socialPost: d.socialPost.trim().slice(0, 3000),
  };
}

/** Los puntos que faltan, en inglés, para pedirle a la IA que los arregle. */
export function failingForAi(checklist: CheckItem[]): string[] {
  return checklist.filter((c) => !c.ok).map((c) => c.en);
}

// ---------- Leer lo guardado ----------

const strs = (v: unknown, max: number, len = 300) => arr(v).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, len)).slice(0, max);
const CHECK_IDS = new Set<CheckId>(Object.keys(CHECK_WEIGHTS) as CheckId[]);

function readResearch(v: unknown, keyword: string, language: WriterLang): KeywordResearch {
  const o = obj(v);
  return {
    keyword: str(o.keyword) || keyword,
    language,
    location: str(o.location),
    locationCode: num(o.locationCode) ?? 0,
    organic: arr(o.organic)
      .map(obj)
      .map((x) => ({ position: num(x.position) ?? 0, title: str(x.title), url: str(x.url), domain: str(x.domain), description: str(x.description) }))
      .filter((x) => x.position > 0 && /^https?:\/\//i.test(x.url))
      .slice(0, 10),
    questions: strs(o.questions, 10),
    related: strs(o.related, 12),
    localPack: o.localPack === true,
    aiOverview: o.aiOverview === true,
    featuredSnippet: o.featuredSnippet === true,
    pages: arr(o.pages)
      .map(obj)
      .map((p) => ({
        position: num(p.position) ?? 0,
        url: str(p.url),
        domain: str(p.domain),
        title: str(p.title),
        h1: str(p.h1),
        headings: arr(p.headings)
          .map(obj)
          .map((h) => ({ level: (h.level === 3 ? 3 : 2) as 2 | 3, text: str(h.text) }))
          .filter((h) => h.text)
          .slice(0, 30),
        words: Math.max(0, num(p.words) ?? 0),
        ...(str(p.error) ? { error: str(p.error) } : {}),
      }))
      .filter((p) => /^https?:\/\//i.test(p.url))
      .slice(0, MAX_COMPETITOR_PAGES),
    cost: num(o.cost) ?? 0,
  };
}

/** Lee un artículo guardado sin confiar en su forma. null si no sirve (sin palabra clave o sin texto). */
export function readArticleReport(json: unknown): ArticleReport | null {
  const o = obj(json);
  const keyword = str(o.keyword).trim();
  const d = obj(o.draft);
  const markdown = str(d.markdown);
  if (!keyword || !markdown.trim()) return null;
  const language: WriterLang = o.language === "en" ? "en" : "es";
  const t = obj(o.targets);
  const zone = obj(o.zone);
  const created = str(o.createdAt);
  const improved = str(o.improvedAt);
  const checklist: CheckItem[] = arr(o.checklist)
    .map(obj)
    .filter((c) => CHECK_IDS.has(c.id as CheckId))
    .map((c) => {
      const id = c.id as CheckId;
      const max = num(c.max) ?? CHECK_WEIGHTS[id];
      return { id, ok: c.ok === true, points: Math.max(0, Math.min(max, num(c.points) ?? 0)), max, es: str(c.es), en: str(c.en) || str(c.es) };
    });
  const score = num(o.score);
  return {
    version: 1,
    keyword: keyword.slice(0, 120),
    language,
    zone: { code: num(zone.code) ?? 0, name: str(zone.name) },
    research: readResearch(o.research, keyword, language),
    targets: {
      wordCount: num(t.wordCount) ?? DEFAULT_WORDS,
      competitorWords: arr(t.competitorWords).filter((n): n is number => typeof n === "number" && Number.isFinite(n)).slice(0, 10),
      headings: arr(t.headings)
        .map(obj)
        .map((h) => ({ text: str(h.text), pages: Math.max(1, num(h.pages) ?? 1) }))
        .filter((h) => h.text)
        .slice(0, 12),
      questions: strs(t.questions, 10),
      terms: strs(t.terms, 20, 80),
    },
    draft: {
      title: str(d.title),
      metaDescription: str(d.metaDescription),
      slug: str(d.slug),
      h1: str(d.h1),
      outline: strs(d.outline, 20),
      markdown,
      socialPost: str(d.socialPost),
    },
    score: score === null ? checklist.reduce((s, c) => s + c.points, 0) : Math.max(0, Math.min(100, Math.round(score))),
    checklist,
    cost: num(o.cost) ?? 0,
    provider: str(o.provider),
    createdAt: created && !Number.isNaN(Date.parse(created)) ? created : new Date(0).toISOString(),
    ...(improved && !Number.isNaN(Date.parse(improved)) ? { improvedAt: improved } : {}),
    ...(num(o.previousScore) !== null ? { previousScore: num(o.previousScore) as number } : {}),
    ...(o.site && typeof o.site === "object" ? { site: o.site } : {}),
  };
}

/** Color del puntaje: verde desde 80, amarillo desde 60, rojo debajo. */
export const scoreTone = (score: number): "good" | "ok" | "bad" => (score >= 80 ? "good" : score >= 60 ? "ok" : "bad");
