// Auditoría SEO gratis del sitio del negocio, parecida al «Site Audit» de Semrush: recorre hasta 60 páginas, lee
// robots.txt, el sitemap y /llms.txt, revisa enlaces y fotos rotos, datos estructurados (JSON-LD), direcciones viejas de
// WordPress, cómo están enlazadas las páginas, lo que necesitan las IAs, y mide la velocidad con Google PageSpeed.
// Arma una lista de problemas (cada uno con id estable, gravedad, grupo, páginas y el valor exacto) y un puntaje.
// Sin dependencias nuevas: el HTML se lee con expresiones regulares (suficiente para estas revisiones).
// Los ids, gravedades y grupos están en audit-ids.ts; los textos en audit-text.ts; la comparación en audit-compare.ts.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { bi } from "@/lib/i18n";
import { checkLlmsTxt, robotsAiCheck, type LlmsTxtState, type RobotsAi } from "@/lib/seo/audit-ai";
import {
  CATEGORY_LABEL,
  ISSUE_IDS,
  ISSUE_META,
  ISSUE_SEVERITY,
  isIssueId,
  isSiteLevel,
  SEVERITY_RANK,
  type IssueCategory,
  type IssueId,
  type Severity,
} from "@/lib/seo/audit-ids";
import { checkJsonLd, type SchemaFinding, type SchemaFindingKind } from "@/lib/seo/audit-schema";
import { isJunkWpUrl, isWpComHost, linkGraph, textHash, WP_PROBES } from "@/lib/seo/audit-site";
import { ISSUE_TEXT } from "@/lib/seo/audit-text";

export { CATEGORY_LABEL, ISSUE_IDS, ISSUE_META, ISSUE_SEVERITY, ISSUE_TEXT, isIssueId };
export type { IssueCategory, IssueId, Severity };
export { LEGACY_ISSUE_IDS, NEW_ISSUE_IDS, ISSUE_CATEGORIES, type IssueUnit } from "@/lib/seo/audit-ids";

export const AUDIT_UA = "Mozilla/5.0 (compatible; MatyaBot/1.0)";
/** Páginas que se leen como máximo. */
export const MAX_PAGES = 60;
const MAX_ATTEMPTS = 120; // incluye respuestas que no son HTML
const CONCURRENCY = 6;
const REQ_TIMEOUT = 10_000;
const CRAWL_MS = 100_000; // leer páginas
const TOTAL_MS = 135_000; // leer páginas + revisar enlaces, fotos y direcciones viejas
const MAX_LINK_CHECKS = 50;
const MAX_IMAGE_CHECKS = 40;
const MAX_JUNK_CHECKS = 20;
const PSI_TIMEOUT = 60_000;
const MAX_HTML_CHARS = 3_000_000;
/** Cuántas direcciones afectadas se guardan por problema (con su valor). `pages` guarda solo las primeras 10. */
const MAX_ITEMS = 100;

// Límites de cada revisión (los mismos que dicen los textos).
const LIMITS = {
  titleLong: 60,
  titleShort: 20,
  descShort: 70,
  descLong: 160,
  thinWords: 250,
  slowMs: 3000,
  longParagraphWords: 150,
  lowTextRatio: 10,
  manyLinks: 250,
  heavyBytes: 2_000_000,
  deepClicks: 3,
};

// ---------- Tipos ----------

/** Una dirección afectada y el valor exacto que causa el problema (ej. el título largo), con una nota corta. */
export type IssueItem = { url: string; value?: string; detail?: { es: string; en: string } };

export type Issue = {
  id: IssueId;
  severity: Severity;
  /** Las primeras 10 direcciones afectadas (formato de siempre). */
  pages: string[];
  /** Cuántas páginas (o enlaces, direcciones o fotos, según ISSUE_META[id].unit) tienen el problema. */
  count: number;
  /** Grupo del panel (Rastreo, Contenido…). Los reportes viejos no lo traen: readAuditReport lo completa. */
  category?: IssueCategory;
  /** Hasta 100 direcciones con el valor exacto. Los reportes viejos no lo traen: se arma con `pages`. */
  items?: IssueItem[];
  /** Total de casos cuando no es igual a `count` (ej. 695 enlaces a wp.com en 23 páginas). */
  total?: number;
};

/** Lo que se lee del HTML de una página. Los campos opcionales son de la versión 2 (los reportes viejos no los tienen). */
export type PageAnalysis = {
  title: string;
  description: string;
  h1Count: number;
  h1: string;
  canonical: string;
  noindex: boolean;
  lang: string;
  images: number;
  imagesNoAlt: number;
  words: number;
  /** Enlaces internos (mismo sitio), ya normalizados. */
  links: string[];
  viewport: boolean;
  ogImage: boolean;
  jsonLd: boolean;
  schema: string[];
  https: boolean;
  h2Count?: number;
  /** Tiene una zona principal (<main>, <article> o role="main"). */
  hasMain?: boolean;
  /** Párrafos de más de 150 palabras, el más largo y cómo empieza. */
  longParagraphs?: number;
  longestParagraph?: number;
  longSample?: string;
  /** Texto visible ÷ HTML, en %. */
  textRatio?: number;
  /** Todos los enlaces <a href> (internos y externos). */
  linksTotal?: number;
  /** Enlaces o fotos que apuntan a wp.com / wordpress.com, y un ejemplo. */
  wpLinks?: number;
  wpSample?: string;
  /** Archivos que se cargan por http en una página https (hasta 5) y cuántos son. */
  mixed?: string[];
  mixedCount?: number;
  /** Etiquetas hreflang (versiones en otros idiomas). */
  hreflang?: number;
  /** Huella del texto visible, para encontrar páginas con el mismo texto. */
  textHash?: string;
  /** Problemas en los datos estructurados (JSON-LD). */
  schemaFindings?: SchemaFinding[];
  /** Direcciones de las fotos (para revisar las rotas; no se guardan). */
  imageUrls?: string[];
};

/** Lo que se guarda de cada página. */
export type AuditPage = Omit<PageAnalysis, "links" | "imageUrls"> & {
  url: string;
  finalUrl: string;
  status: number;
  ms: number;
  bytes: number;
  internalLinks: number;
  error?: string;
  /** Clics desde el inicio (null = no se llega siguiendo enlaces de las páginas leídas). */
  depth?: number | null;
  /** Cuántas de las páginas leídas enlazan a esta. */
  inlinks?: number;
  inSitemap?: boolean;
};

export type BrokenLink = { url: string; status: number; from: string[] };

/** Una dirección vieja de WordPress que se encontró. `live` = responde 200 y Google la puede mostrar. */
export type JunkUrl = { url: string; status: number; where: "sitemap" | "link" | "probe"; live: boolean };
/** Una dirección del sitemap que no sirve: da error, manda a otra o está escondida. */
export type SitemapBad = { url: string; status: number; why: "error" | "redirect" | "noindex"; to?: string };

export type SiteInfo = {
  /** La página de inicio después de las redirecciones. */
  home: string;
  robots: boolean;
  sitemap: boolean;
  sitemapUrls: number;
  https: boolean;
  /** Si http:// manda a https:// (null si no se pudo probar o el sitio no tiene https). */
  httpRedirects: boolean | null;
  localBusinessSchema: boolean;
  brokenLinks: BrokenLink[];
  checkedLinks: number;
  /** Se cortó por tiempo antes de leer todo. */
  stoppedEarly: boolean;
  // ----- versión 2 (opcionales: los reportes viejos no los tienen) -----
  /** false = robots.txt o el sitemap no respondieron: no se sabe si existen y no se marcan como problema. */
  robotsChecked?: boolean;
  sitemapChecked?: boolean;
  /** Qué dice robots.txt de Google y de los robots de IA. */
  robotsAi?: RobotsAi;
  /** /llms.txt (null = no se pudo revisar). */
  llms?: LlmsTxtState | null;
  /** Si la otra versión (con o sin www) manda a la principal (null = no existe o no se pudo probar). */
  wwwRedirects?: boolean | null;
  altHost?: string;
  junkUrls?: JunkUrl[];
  sitemapBad?: SitemapBad[];
  brokenImages?: BrokenLink[];
  checkedImages?: number;
  /** El sitemap dice qué página es de cada idioma (hreflang). */
  sitemapHreflang?: boolean;
  /** Páginas por clics desde el inicio: {"0":1,"1":12,"2":30,"3":8,"4+":3,"none":2}. */
  depthCounts?: Record<string, number>;
  /** Las páginas leídas son todas las que se encontraron (no se cortó por el tope). */
  crawlComplete?: boolean;
};

export type PageSpeed =
  | {
      performance: number | null;
      seo: number | null;
      accessibility: number | null;
      bestPractices: number | null;
      lcp: string;
      cls: string;
      tbt: string;
    }
  | { error: string };

export type AuditReport = {
  /** 1 = primera versión (23 revisiones); 2 = revisión profunda. */
  version: 1 | 2;
  website: string;
  startedAt: string;
  finishedAt: string;
  pages: AuditPage[];
  site: SiteInfo;
  pagespeed: PageSpeed;
  issues: Issue[];
  score: number;
  /** Qué problemas se revisaron (para comparar con revisiones viejas sin contar como «nuevo» lo que antes no se miraba). */
  checks?: IssueId[];
  /** Cuántas páginas se leen como máximo en esta versión. */
  maxPages?: number;
};

// ---------- Leer HTML ----------

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™",
  mdash: "—", ndash: "–", hellip: "…", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  iexcl: "¡", iquest: "¿", middot: "·", bull: "•",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

const clean = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const wordCount = (s: string) => s.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Atributos de una etiqueta: <a href="x" rel=nofollow> → { href: "x", rel: "nofollow" }. */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const inner = tag.replace(/^<\s*[\w:-]+/, "").replace(/\/?>$/, "");
  for (const m of inner.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

const tags = (html: string, name: string) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => attrs(m[0]));

const sameSite = (a: string, b: string) => a.replace(/^www\./, "") === b.replace(/^www\./, "");

const FILE_EXT =
  /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|heic|zip|rar|7z|gz|tgz|tar|mp4|m4v|mov|avi|wmv|webm|mkv|mp3|m4a|wav|ogg|flac|docx?|xlsx?|pptx?|odt|ods|csv|txt|rtf|xml|json|rss|atom|js|mjs|css|woff2?|ttf|otf|eot|exe|dmg|apk|msi|ics|vcf|eps|ai|psd)$/i;

export const isFileUrl = (u: string) => {
  try {
    return FILE_EXT.test(new URL(u).pathname);
  } catch {
    return false;
  }
};

/** Quita el #fragmento y los parámetros de campañas para no leer la misma página dos veces. */
export function normalizeUrl(u: URL | string): string {
  const url = new URL(u.toString());
  url.hash = "";
  for (const k of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|msclkid$|mc_)/i.test(k)) url.searchParams.delete(k);
  return url.href;
}

const ORG_TYPES = new Set([
  "Organization", "LocalBusiness", "Corporation", "NGO", "ProfessionalService", "HomeAndConstructionBusiness", "Store",
  "Restaurant", "FoodEstablishment", "MedicalBusiness", "MedicalClinic", "Dentist", "Physician", "LegalService", "Attorney",
  "AutomotiveBusiness", "AutoRepair", "FinancialService", "InsuranceAgency", "RealEstateAgent", "HealthAndBeautyBusiness",
  "BeautySalon", "HairSalon", "DaySpa", "Plumber", "Electrician", "RoofingContractor", "GeneralContractor", "HVACBusiness",
  "Locksmith", "MovingCompany", "HousePainter", "AccountingService", "ChildCare", "EmergencyService", "EntertainmentBusiness",
  "LodgingBusiness", "Hotel", "SportsActivityLocation", "TravelAgency", "EmploymentAgency", "Notary", "SelfStorage",
  "DryCleaningOrLaundry", "VeterinaryCare", "Pharmacy", "Optician", "EducationalOrganization", "SportsOrganization",
]);

/** ¿La página dice en JSON-LD qué negocio es (LocalBusiness, Organization o un tipo de negocio)? */
export const hasBusinessSchema = (types: string[]) =>
  types.some((t) => ORG_TYPES.has(t) || /(Business|Store|Service|Contractor|Agency|Organization)$/.test(t));

/** Etiquetas que cargan archivos (para revisar «contenido mixto»: http dentro de una página https). */
const RESOURCE_ATTRS: [string, string[]][] = [
  ["img", ["src", "srcset"]],
  ["script", ["src"]],
  ["iframe", ["src"]],
  ["source", ["src", "srcset"]],
  ["video", ["src", "poster"]],
  ["audio", ["src"]],
  ["embed", ["src"]],
  ["object", ["data"]],
];
const LINK_RESOURCE = /\b(stylesheet|icon|preload|modulepreload|apple-touch-icon|manifest)\b/i;
const srcsetUrls = (v: string) => v.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);

export function analyzePage(html: string, url: string): PageAnalysis {
  const page = new URL(url);
  const raw = html.slice(0, MAX_HTML_CHARS);
  const doc = raw.replace(/<!--[\s\S]*?-->/g, " ");
  const ld = checkJsonLd(doc);
  // Sin scripts, estilos, noscript (píxeles de seguimiento) ni SVG (tienen su propio <title>).
  const body = doc.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ");

  const metas = tags(body, "meta");
  const meta = (n: string) => metas.find((m) => m.name?.toLowerCase() === n || m.property?.toLowerCase() === n)?.content?.trim() ?? "";
  const robots = metas
    .filter((m) => ["robots", "googlebot"].includes(m.name?.toLowerCase() ?? ""))
    .map((m) => m.content ?? "")
    .join(",");

  const baseHref = tags(body, "base")[0]?.href;
  let base = page;
  try {
    if (baseHref) base = new URL(baseHref, page);
  } catch {
    /* base inválida: se usa la URL de la página */
  }
  const abs = (href: string | undefined) => {
    if (!href?.trim()) return "";
    try {
      return new URL(href.trim(), base).href;
    } catch {
      return "";
    }
  };

  const h1s = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  const imgs = tags(body, "img");
  const bodyStart = body.search(/<body\b/i);
  const visible = clean(bodyStart >= 0 ? body.slice(bodyStart) : body.replace(/<head\b[\s\S]*?<\/head>/i, " "));
  const words = wordCount(visible);

  const links = new Set<string>();
  let linksTotal = 0;
  let wpLinks = 0;
  let wpSample = "";
  const ownWp = isWpComHost(page.hostname);
  const countWp = (u: URL) => {
    if (ownWp || !isWpComHost(u.hostname)) return;
    wpLinks++;
    if (!wpSample) wpSample = u.href.slice(0, 200);
  };
  for (const a of tags(body, "a")) {
    const href = a.href?.trim();
    if (!href || href.startsWith("#") || /^(mailto|tel|sms|javascript|data|whatsapp|fax):/i.test(href)) continue;
    linksTotal++;
    try {
      const u = new URL(href, base);
      if ((u.protocol === "http:" || u.protocol === "https:") && sameSite(u.hostname, page.hostname)) {
        if (links.size < 300) links.add(normalizeUrl(u));
      } else countWp(u);
    } catch {
      /* enlace mal escrito: se ignora */
    }
  }

  // Fotos: direcciones (para revisar las rotas) y las que vienen de wp.com.
  const imageUrls = new Set<string>();
  for (const i of imgs) {
    for (const v of [i.src, ...srcsetUrls(i.srcset ?? "")]) {
      const u = abs(v);
      if (!/^https?:/i.test(u)) continue;
      try {
        countWp(new URL(u));
      } catch {
        /* se ignora */
      }
      if (v === i.src && imageUrls.size < 40) imageUrls.add(u);
    }
  }

  // Contenido mixto: archivos por http en una página https (los <script src> se buscan en el HTML con scripts).
  const mixed = new Set<string>();
  if (page.protocol === "https:") {
    for (const [name, keys] of RESOURCE_ATTRS) {
      for (const tag of tags(name === "script" ? doc : body, name)) {
        for (const k of keys) {
          const vals = k === "srcset" ? srcsetUrls(tag[k] ?? "") : [tag[k] ?? ""];
          for (const v of vals) if (/^http:\/\//i.test(v.trim())) mixed.add(v.trim().slice(0, 200));
        }
      }
    }
    for (const l of tags(body, "link")) if (LINK_RESOURCE.test(l.rel ?? "") && /^http:\/\//i.test((l.href ?? "").trim())) mixed.add(l.href.trim().slice(0, 200));
  }

  // Párrafos muy largos (difíciles de citar para una IA).
  let longParagraphs = 0;
  let longestParagraph = 0;
  let longSample = "";
  for (const m of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = clean(m[1]);
    const n = wordCount(text);
    if (n > LIMITS.longParagraphWords) longParagraphs++;
    if (n > longestParagraph) {
      longestParagraph = n;
      longSample = `${text.split(" ").slice(0, 12).join(" ")}…`;
    }
  }

  const linkTags = tags(body, "link");
  return {
    title: clean(body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 300),
    description: meta("description").replace(/\s+/g, " ").slice(0, 500),
    h1Count: h1s.length,
    h1: clean(h1s[0]?.[1] ?? "").slice(0, 200),
    canonical: abs(linkTags.find((l) => (l.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"))?.href),
    noindex: /noindex|\bnone\b/i.test(robots),
    lang: (tags(body, "html")[0]?.lang ?? "").trim().slice(0, 20),
    images: imgs.length,
    imagesNoAlt: imgs.filter((i) => i.alt === undefined).length,
    words,
    links: [...links],
    viewport: !!meta("viewport"),
    ogImage: !!(meta("og:image") || meta("og:image:url") || meta("og:image:secure_url")),
    jsonLd: ld.found,
    schema: ld.types,
    https: page.protocol === "https:",
    h2Count: (body.match(/<h2\b/gi) ?? []).length,
    hasMain: /<(main|article)\b|\brole\s*=\s*["']?main\b/i.test(body),
    longParagraphs,
    longestParagraph,
    longSample: longParagraphs ? longSample.slice(0, 160) : "",
    textRatio: Math.round((visible.length / Math.max(1, raw.length)) * 1000) / 10,
    linksTotal,
    wpLinks,
    wpSample,
    mixed: [...mixed].slice(0, 5),
    mixedCount: mixed.size,
    hreflang: linkTags.filter((l) => (l.rel ?? "").toLowerCase().includes("alternate") && l.hreflang).length,
    textHash: words >= 30 ? textHash(visible.toLowerCase()) : "",
    schemaFindings: ld.findings,
    imageUrls: [...imageUrls],
  };
}

// ---------- Problemas y puntaje ----------

const isOk = (p: AuditPage) => !p.error && p.status >= 200 && p.status < 400;
const bi2 = (es: string, en: string) => ({ es, en });
const SCHEMA_ISSUE: Record<SchemaFindingKind, IssueId> = {
  "invalid-json": "schema-invalid-json",
  "wrong-property": "schema-wrong-property",
  "business-incomplete": "schema-business-incomplete",
  "opening-hours": "schema-opening-hours",
  "org-incomplete": "schema-org-incomplete",
};
const primaryLang = (l: string) => l.toLowerCase().split(/[-_]/)[0];
const normText = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** «Responde 404 · está en /contacto, /servicios». */
const brokenNote = (b: BrokenLink) => {
  const from = b.from.slice(0, 3).map((f) => {
    try {
      const u = new URL(f);
      return `${u.pathname}${u.search}` || "/";
    } catch {
      return f;
    }
  });
  return bi2(`Responde ${b.status}${from.length ? ` · está en ${from.join(", ")}` : ""}`, `Returns ${b.status}${from.length ? ` · found on ${from.join(", ")}` : ""}`);
};

export function findIssues(pages: AuditPage[], site: SiteInfo): Issue[] {
  const hits = new Map<IssueId, Map<string, IssueItem>>();
  const totals = new Map<IssueId, number>();
  const add = (id: IssueId, url: string, value?: string, detail?: { es: string; en: string }) => {
    const m = hits.get(id) ?? new Map<string, IssueItem>();
    if (!m.has(url)) m.set(url, { url, ...(value ? { value } : {}), ...(detail ? { detail } : {}) });
    hits.set(id, m);
  };
  const ok = pages.filter(isOk);
  const homeKey = site.home ? normalizeUrl(site.home) : "";

  for (const p of pages) if (!p.error && p.status >= 400) add("page-errors", p.url, String(p.status));
  for (const p of ok) {
    const u = p.finalUrl || p.url;
    if (!p.title) add("missing-title", u);
    else if (p.title.length > LIMITS.titleLong) add("title-too-long", u, p.title, bi2(`${p.title.length} letras`, `${p.title.length} characters`));
    else if (p.title.length < LIMITS.titleShort) add("title-too-short", u, p.title, bi2(`${p.title.length} letras`, `${p.title.length} characters`));
    if (!p.description) add("missing-description", u);
    else if (p.description.length < LIMITS.descShort || p.description.length > LIMITS.descLong)
      add("description-length", u, p.description, bi2(`${p.description.length} letras (${p.description.length > LIMITS.descLong ? "muy larga" : "muy corta"})`, `${p.description.length} characters (${p.description.length > LIMITS.descLong ? "too long" : "too short"})`));
    if (p.h1Count === 0) add("missing-h1", u);
    else if (p.h1Count > 1) add("multiple-h1", u, p.h1, bi2(`${p.h1Count} títulos H1`, `${p.h1Count} H1 headings`));
    if (p.h1Count > 0 && p.h1 && p.title && normText(p.h1) === normText(p.title)) add("h1-same-as-title", u, p.h1);
    if (p.imagesNoAlt > 0) add("images-no-alt", u, undefined, bi2(`${p.imagesNoAlt} de ${p.images} fotos sin descripción`, `${p.imagesNoAlt} of ${p.images} images without alt text`));
    if (p.noindex) add("noindex", u);
    else if (p.words < LIMITS.thinWords) add("thin-content", u, String(p.words), bi2(`${p.words} palabras`, `${p.words} words`));
    if (!p.https) add("no-https", u);
    if (!p.viewport) add("no-viewport", u);
    if (!p.ogImage) add("no-og-image", u);
    if (p.ms > LIMITS.slowMs) add("slow-page", u, `${(p.ms / 1000).toFixed(1)} s`);
    if (!p.lang) add("missing-lang", u);

    // ----- versión 2: solo si la página trae esos datos (los reportes viejos no) -----
    if ((p.longParagraphs ?? 0) > 0)
      add("long-paragraphs", u, p.longSample, bi2(`${p.longParagraphs} ${p.longParagraphs === 1 ? "párrafo largo" : "párrafos largos"}; el más largo tiene ${p.longestParagraph} palabras`, `${p.longParagraphs} long ${p.longParagraphs === 1 ? "paragraph" : "paragraphs"}; the longest has ${p.longestParagraph} words`));
    if (p.hasMain !== undefined && !p.noindex) {
      const noMain = !p.hasMain;
      const noH2 = (p.h2Count ?? 0) === 0 && p.words >= 300;
      if (noMain || noH2) {
        const what = [noMain && "<main>/<article>", noH2 && "<h2>"].filter(Boolean).join(" + ");
        add("weak-semantic-html", u, what, bi2(`Falta: ${what}`, `Missing: ${what}`));
      }
    }
    if (p.textRatio !== undefined && p.bytes > 0 && p.textRatio < LIMITS.lowTextRatio) add("low-text-ratio", u, `${p.textRatio}%`, bi2(`Texto: ${p.textRatio}% del código`, `Text: ${p.textRatio}% of the code`));
    if ((p.linksTotal ?? 0) > LIMITS.manyLinks) add("too-many-links", u, String(p.linksTotal), bi2(`${p.linksTotal} enlaces`, `${p.linksTotal} links`));
    if ((p.wpLinks ?? 0) > 0) {
      add("wp-com-links", u, p.wpSample, bi2(`${p.wpLinks} ${p.wpLinks === 1 ? "enlace o foto" : "enlaces o fotos"} a wp.com`, `${p.wpLinks} ${p.wpLinks === 1 ? "link or image" : "links or images"} to wp.com`));
      totals.set("wp-com-links", (totals.get("wp-com-links") ?? 0) + (p.wpLinks ?? 0));
    }
    if ((p.mixedCount ?? 0) > 0) add("mixed-content", u, p.mixed?.[0], bi2(`${p.mixedCount} ${p.mixedCount === 1 ? "archivo" : "archivos"} por http`, `${p.mixedCount} ${p.mixedCount === 1 ? "file" : "files"} over http`));
    if (p.bytes > LIMITS.heavyBytes) add("large-html", u, `${(p.bytes / 1_000_000).toFixed(1)} MB`);
    const byKind = new Map<SchemaFindingKind, string[]>();
    for (const f of p.schemaFindings ?? []) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f.value]);
    for (const [kind, values] of byKind) add(SCHEMA_ISSUE[kind], u, values.slice(0, 3).join(" · "));
    if (typeof p.depth === "number" && p.depth > LIMITS.deepClicks && !p.noindex) add("deep-pages", u, String(p.depth), bi2(`${p.depth} clics desde el inicio`, `${p.depth} clicks from the home page`));
    const isHome = homeKey && normalizeUrl(u) === homeKey;
    if (!isHome && !p.noindex && p.inlinks === 1) add("single-inlink", u);
    if (!isHome && !p.noindex && p.inSitemap && p.inlinks === 0 && ok.length >= 5)
      add("orphan-pages", u, undefined, bi2(`En el sitemap; ninguna de las ${ok.length} páginas leídas la enlaza`, `In the sitemap; none of the ${ok.length} pages read link to it`));
  }

  // Duplicados: entre las páginas que Google puede mostrar, contando una vez las que apuntan al mismo canonical.
  const docs = new Map<string, AuditPage>();
  for (const p of ok) if (!p.noindex) docs.set(p.canonical || p.finalUrl || p.url, p);
  const dupes = (id: IssueId, key: (p: AuditPage) => string, value?: (p: AuditPage) => string) => {
    const groups = new Map<string, string[]>();
    for (const [url, p] of docs) {
      const k = key(p).trim().toLowerCase();
      if (k) groups.set(k, [...(groups.get(k) ?? []), url]);
    }
    for (const urls of groups.values())
      if (urls.length > 1) for (const u of urls) add(id, u, value?.(docs.get(u)!), bi2(`Igual en ${urls.length} páginas`, `Same on ${urls.length} pages`));
  };
  dupes("duplicate-title", (p) => p.title, (p) => p.title);
  dupes("duplicate-description", (p) => p.description, (p) => p.description);
  dupes("duplicate-content", (p) => p.textHash ?? "");

  // Sitio en dos idiomas sin decirle a Google qué página es de cada idioma.
  const langs = new Set(ok.map((p) => primaryLang(p.lang)).filter(Boolean));
  if (langs.size >= 2 && !site.sitemapHreflang)
    for (const p of ok) if (p.hreflang === 0 && !p.noindex) add("hreflang-missing", p.finalUrl || p.url, p.lang || undefined, bi2(`Idioma de la página: ${p.lang || "?"}`, `Page language: ${p.lang || "?"}`));

  // Si la página ya abre con https, que http no redirija es otro problema (menor) que no tener https.
  let origin = "";
  try {
    origin = site.home ? new URL(site.home).origin : "";
  } catch {
    /* sin inicio válido */
  }
  if (site.httpRedirects === false) {
    try {
      add(site.https ? "http-no-redirect" : "no-https", `http://${new URL(site.home).host}/`);
    } catch {
      /* sin inicio válido */
    }
  }
  for (const b of site.brokenLinks) add("broken-links", b.url, String(b.status), brokenNote(b));
  if (site.home) {
    if (!site.sitemap && site.sitemapChecked !== false) add("no-sitemap", site.home);
    if (!site.robots && site.robotsChecked !== false) add("no-robots", site.home);
    if (!site.localBusinessSchema) add("no-structured-data", site.home);
  }

  // ----- versión 2: de todo el sitio -----
  if (origin) {
    const ai = site.robotsAi;
    if (ai?.blocksGoogle) add("robots-blocks-site", `${origin}/robots.txt`, "Disallow: /");
    if (ai?.searchBlocked.length) add("ai-search-bots-blocked", `${origin}/robots.txt`, ai.searchBlocked.join(", "));
    if (ai?.trainingBlocked.length) add("ai-training-bots-blocked", `${origin}/robots.txt`, ai.trainingBlocked.join(", "));
    const llms = site.llms;
    if (llms?.status === "missing")
      add("llms-txt-missing", `${origin}/llms.txt`, undefined, llms.why === "html" ? bi2("Responde una página web, no un archivo de texto", "It returns a web page, not a text file") : bi2("No existe (no encontrada)", "Doesn't exist (not found)"));
    if (llms?.status === "invalid") {
      const PROBLEM: Record<string, [string, string]> = {
        empty: ["está vacío", "it's empty"],
        "no-title": ["no empieza con «# Nombre»", "doesn't start with \"# Name\""],
        "no-summary": ["falta el resumen «>»", "the \"> summary\" is missing"],
        "no-links": ["no tiene enlaces a tus páginas", "has no links to your pages"],
      };
      add("llms-txt-invalid", `${origin}/llms.txt`, llms.problems.join(", "), bi2(llms.problems.map((x) => PROBLEM[x][0]).join("; "), llms.problems.map((x) => PROBLEM[x][1]).join("; ")));
    }
    if (site.wwwRedirects === false && site.altHost) add("www-mismatch", `${new URL(origin).protocol}//${site.altHost}/`, site.altHost);
  }
  const WHERE: Record<JunkUrl["where"], [string, string]> = { sitemap: ["en el sitemap", "in the sitemap"], link: ["enlazada desde tu sitio", "linked from your site"], probe: ["sigue abierta", "still open"] };
  for (const j of site.junkUrls ?? [])
    if (j.live || j.where === "sitemap") add("wp-junk-urls", j.url, String(j.status || "—"), bi2(`Responde ${j.status || "sin respuesta"} · ${WHERE[j.where][0]}`, `Returns ${j.status || "no response"} · ${WHERE[j.where][1]}`));
  const WHY: Record<SitemapBad["why"], [string, string]> = { error: ["da error", "returns an error"], redirect: ["manda a otra página", "redirects to another page"], noindex: ["está escondida de Google (noindex)", "is hidden from Google (noindex)"] };
  for (const s of site.sitemapBad ?? [])
    add("sitemap-bad-urls", s.url, s.to ?? String(s.status), bi2(`${WHY[s.why][0]}${s.to ? `: ${s.to}` : ""}${s.why === "error" ? ` (${s.status})` : ""}`, `${WHY[s.why][1]}${s.to ? `: ${s.to}` : ""}${s.why === "error" ? ` (${s.status})` : ""}`));
  for (const b of site.brokenImages ?? []) add("broken-images", b.url, String(b.status), brokenNote(b));

  return ISSUE_IDS.filter((id) => hits.has(id))
    .map((id): Issue => {
      const items = [...hits.get(id)!.values()];
      const total = totals.get(id);
      return {
        id,
        severity: ISSUE_SEVERITY[id],
        count: items.length,
        pages: items.slice(0, 10).map((i) => i.url),
        category: ISSUE_META[id].category,
        items: items.slice(0, MAX_ITEMS),
        ...(total && total !== items.length ? { total } : {}),
      };
    })
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count);
}

/** Peso de cada gravedad en la nota (el mismo que AUDIT_WEIGHT en verdict.ts). */
const WEIGHT: Record<Severity, number> = { error: 12, warning: 4, notice: 1 };

/**
 * Cuántos puntos le quita cada problema a la nota: peso × (0.5 + 0.5 × parte). Sin redondear, de mayor a menor.
 * Es la misma cuenta que scoreFor (el panel la muestra en «¿Cómo se calcula la nota?»).
 */
export function auditBreakdown(issues: Pick<Issue, "id" | "severity" | "count">[], pageCount: number): { id: IssueId; severity: Severity; points: number }[] {
  return issues
    .map((i) => {
      const share = isSiteLevel(i.id) || pageCount <= 0 ? 1 : Math.min(1, Math.max(0, i.count) / pageCount);
      return { id: i.id, severity: i.severity, points: (WEIGHT[i.severity] ?? 0) * (0.5 + 0.5 * share) };
    })
    .sort((a, b) => b.points - a.points);
}

/**
 * Puntaje de 0 a 100. Se empieza en 100 y cada problema resta:
 *   peso × (0.5 + 0.5 × parte)
 * peso: error 12, advertencia 4, sugerencia 1.
 * parte: páginas afectadas ÷ páginas revisadas (máximo 1); los problemas de todo el sitio (sitemap, robots.txt,
 * datos estructurados, llms.txt…) cuentan como parte = 1. Así un problema en una sola página resta la mitad de su peso
 * y en todas, el peso completo. Se redondea y nunca baja de 0.
 */
export function scoreFor(issues: Pick<Issue, "id" | "severity" | "count">[], pageCount: number): number {
  const score = 100 - auditBreakdown(issues, pageCount).reduce((s, d) => s + d.points, 0);
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ---------- Red (con protección básica contra direcciones internas) ----------

/** localhost, .local y direcciones IP privadas o de loopback. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || /\.(localhost|local|internal|lan|home\.arpa)$/.test(h)) return true;
  const v = isIP(h);
  if (v === 4) {
    const [a, b] = h.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    if (h === "::" || h === "::1" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true;
    const mapped = h.match(/^::ffff:(.+)$/);
    if (mapped) return isIP(mapped[1]) === 4 ? isPrivateHost(mapped[1]) : true;
  }
  return false;
}

type Fetched = { res: Response; url: string; status: number };

function makeFetcher() {
  const dns = new Map<string, Promise<boolean>>();
  const blocked = (host: string): Promise<boolean> => {
    if (isPrivateHost(host)) return Promise.resolve(true);
    if (isIP(host.replace(/^\[|\]$/g, ""))) return Promise.resolve(false);
    let p = dns.get(host);
    if (!p) {
      // Si el nombre apunta a una IP interna, no se visita. Si la consulta falla, fetch dará su propio error.
      p = lookup(host, { all: true })
        .then((list) => list.some((a) => isPrivateHost(a.address)))
        .catch(() => false);
      dns.set(host, p);
    }
    return p;
  };

  const guard = async (u: URL) => {
    if (u.protocol !== "http:" && u.protocol !== "https:") throw bi("Solo se revisan páginas http o https.", "Only http or https pages can be checked.");
    if (await blocked(u.hostname)) throw bi("Esa dirección es interna o privada; no se puede revisar.", "That address is internal or private; it can't be checked.");
  };

  /** fetch que sigue las redirecciones a mano (hasta 5) para revisar cada salto. */
  const get = async (url: string, method: "GET" | "HEAD", timeoutMs: number): Promise<Fetched> => {
    const signal = AbortSignal.timeout(Math.max(500, Math.min(REQ_TIMEOUT, timeoutMs)));
    let current = new URL(url);
    for (let hop = 0; hop < 6; hop++) {
      await guard(current);
      const res = await fetch(current, {
        method,
        redirect: "manual",
        signal,
        headers: { "User-Agent": AUDIT_UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.body?.cancel().catch(() => {});
        current = new URL(loc, current);
        continue;
      }
      return { res, url: current.href, status: res.status };
    }
    throw bi("Demasiadas redirecciones.", "Too many redirects.");
  };

  return { guard, get };
}

const drop = (res: Response) => res.body?.cancel().catch(() => {});

async function readText(res: Response): Promise<{ text: string; bytes: number }> {
  const buf = new Uint8Array(await res.arrayBuffer());
  const charset = /charset=["']?([\w-]+)/i.exec(res.headers.get("content-type") ?? "")?.[1] ?? "utf-8";
  let text: string;
  try {
    text = new TextDecoder(charset).decode(buf.subarray(0, MAX_HTML_CHARS));
  } catch {
    text = new TextDecoder().decode(buf.subarray(0, MAX_HTML_CHARS));
  }
  return { text, bytes: buf.byteLength };
}

/**
 * Lee una página pública cualquiera (por ejemplo, la de un competidor) con las mismas protecciones que la auditoría:
 * nada de direcciones internas o privadas (también después de cada redirección), tiempo máximo y tamaño máximo.
 * Lanza un error si no responde, no es HTML o da un código de error.
 */
export async function fetchPublicHtml(url: string, timeoutMs = 8_000, maxBytes = 1_500_000): Promise<{ html: string; url: string; status: number }> {
  const f = await makeFetcher().get(url, "GET", timeoutMs);
  const type = f.res.headers.get("content-type") ?? "";
  if (f.status >= 400 || (type && !/html/i.test(type))) {
    drop(f.res);
    throw bi(`La página respondió ${f.status}${type ? ` (${type.split(";")[0]})` : ""}.`, `The page responded ${f.status}${type ? ` (${type.split(";")[0]})` : ""}.`);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = f.res.body?.getReader();
  if (reader) {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.byteLength;
    }
    await reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(Math.min(size, maxBytes));
  let at = 0;
  for (const c of chunks) {
    if (at >= buf.length) break;
    const part = c.subarray(0, buf.length - at);
    buf.set(part, at);
    at += part.byteLength;
  }
  const charset = /charset=["']?([\w-]+)/i.exec(type)?.[1] ?? "utf-8";
  let html: string;
  try {
    html = new TextDecoder(charset).decode(buf);
  } catch {
    html = new TextDecoder().decode(buf);
  }
  return { html, url: f.url, status: f.status };
}

const reason = (e: unknown) =>
  e instanceof Error ? (e.name === "TimeoutError" || e.name === "AbortError" ? "timeout" : (e.cause instanceof Error ? e.cause.message : e.message)).slice(0, 200) : String(e).slice(0, 200);

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** La dirección del sitio como URL (agrega https:// si falta). */
export function startUrl(website: string): URL {
  const raw = website.trim();
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw bi(`La dirección del sitio no es válida: ${raw}`, `The website address isn't valid: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw bi("La dirección del sitio debe empezar con http o https.", "The website address must start with http or https.");
  if (isPrivateHost(u.hostname)) throw bi("Esa dirección es interna o privada; no se puede revisar.", "That address is internal or private; it can't be checked.");
  return u;
}

/** Google PageSpeed Insights (celular) para la página de inicio. */
export async function pageSpeed(url: string): Promise<PageSpeed> {
  const q = new URLSearchParams({ url, strategy: "mobile" });
  for (const c of ["performance", "seo", "accessibility", "best-practices"]) q.append("category", c);
  if (process.env.PAGESPEED_API_KEY) q.set("key", process.env.PAGESPEED_API_KEY);
  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: AbortSignal.timeout(PSI_TIMEOUT) });
    const j = (await res.json().catch(() => null)) as {
      error?: { message?: string };
      lighthouseResult?: { categories?: Record<string, { score?: number | null }>; audits?: Record<string, { displayValue?: string }> };
    } | null;
    if (!res.ok) return { error: String(j?.error?.message ?? `HTTP ${res.status}`).slice(0, 300) };
    const cats = j?.lighthouseResult?.categories;
    if (!cats) return { error: "PageSpeed: empty response" };
    const score = (k: string) => (typeof cats[k]?.score === "number" ? Math.round(cats[k].score! * 100) : null);
    const audit = (k: string) => String(j?.lighthouseResult?.audits?.[k]?.displayValue ?? "").replace(/\s+/g, " ").trim();
    return {
      performance: score("performance"),
      seo: score("seo"),
      accessibility: score("accessibility"),
      bestPractices: score("best-practices"),
      lcp: audit("largest-contentful-paint"),
      cls: audit("cumulative-layout-shift"),
      tbt: audit("total-blocking-time"),
    };
  } catch (e) {
    return { error: reason(e) === "timeout" ? "timeout (60 s)" : reason(e) };
  }
}

/** Las direcciones de un sitemap (<loc>), si es un índice de sitemaps y si dice el idioma de cada página (hreflang). */
export function parseSitemap(xml: string): { index: boolean; urls: string[]; hreflang: boolean } {
  const urls = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decodeEntities(m[1].trim())).filter(Boolean);
  return { index: /<sitemapindex\b/i.test(xml), urls, hreflang: /<(?:xhtml:)?link\b[^>]*hreflang\s*=/i.test(xml) };
}


// ---------- Auditoría completa ----------

export async function runAudit(website: string): Promise<AuditReport> {
  const startedAt = new Date();
  const t0 = Date.now();
  const crawlUntil = t0 + CRAWL_MS;
  const allUntil = t0 + TOTAL_MS;
  const left = (until: number) => until - Date.now();
  const net = makeFetcher();
  const start = startUrl(website);
  await net.guard(start);
  /** Como net.get, pero si la conexión se corta (no por tiempo) se intenta hasta dos veces más. */
  const getRetry = async (url: string, method: "GET" | "HEAD", until: number): Promise<Fetched> => {
    for (const wait of [400, 1200]) {
      try {
        return await net.get(url, method, left(until));
      } catch (e) {
        if (reason(e) === "timeout" || left(until) < 2000 + wait) throw e;
        await sleep(wait);
      }
    }
    return net.get(url, method, left(until));
  };

  const pages: AuditPage[] = [];
  const statusOf = new Map<string, number>();
  /** Dirección pedida → dirección final (después de redirecciones). */
  const finalOf = new Map<string, string>();
  const linkSources = new Map<string, Set<string>>();
  /** Para cada página leída, a qué páginas internas enlaza (para contar clics desde el inicio). */
  const edges = new Map<string, string[]>();
  /** Foto → páginas donde está. */
  const imageSources = new Map<string, Set<string>>();
  const recorded = new Set<string>();
  const seen = new Set<string>();
  const queue: string[] = [];
  let siteHost = start.hostname;
  let homeSchema: string[] = [];

  /** Lee una página. Devuelve sus enlaces internos, o null si no es una página HTML del sitio. */
  const visit = async (url: string, isHome = false): Promise<string[] | null> => {
    const t = Date.now();
    let f: Fetched;
    try {
      f = await getRetry(url, "GET", crawlUntil);
    } catch (e) {
      if (isHome) throw e;
      if (left(crawlUntil) > 500 && !recorded.has(url)) {
        recorded.add(url);
        pages.push({ ...emptyAnalysis(url), url, finalUrl: url, status: 0, ms: Date.now() - t, bytes: 0, internalLinks: 0, error: reason(e) });
      }
      return null;
    }
    const final = normalizeUrl(f.url);
    statusOf.set(url, f.status);
    statusOf.set(final, f.status);
    finalOf.set(url, final);
    if (isHome) siteHost = new URL(final).hostname;
    if (!sameSite(new URL(final).hostname, siteHost) || recorded.has(final)) {
      drop(f.res);
      return null;
    }
    const type = f.res.headers.get("content-type") ?? "";
    if (f.status < 400 && type && !/html/i.test(type)) {
      drop(f.res);
      return null;
    }
    recorded.add(final);
    recorded.add(url);
    if (f.status >= 400) {
      drop(f.res);
      pages.push({ ...emptyAnalysis(final), url, finalUrl: final, status: f.status, ms: Date.now() - t, bytes: 0, internalLinks: 0 });
      return [];
    }
    let body: { text: string; bytes: number };
    try {
      body = await readText(f.res);
    } catch (e) {
      if (isHome) throw e;
      pages.push({ ...emptyAnalysis(final), url, finalUrl: final, status: f.status, ms: Date.now() - t, bytes: 0, internalLinks: 0, error: reason(e) });
      return null;
    }
    const a = analyzePage(body.text, final);
    if (/noindex|\bnone\b/i.test(f.res.headers.get("x-robots-tag") ?? "")) a.noindex = true;
    if (isHome) homeSchema = a.schema;
    const { links, imageUrls, ...rest } = a;
    pages.push({ ...rest, url, finalUrl: final, status: f.status, ms: Date.now() - t, bytes: body.bytes, internalLinks: links.length });
    edges.set(final, links);
    for (const l of links) {
      const from = linkSources.get(l) ?? new Set<string>();
      from.add(final);
      linkSources.set(l, from);
    }
    for (const img of imageUrls ?? []) {
      const from = imageSources.get(img) ?? new Set<string>();
      from.add(final);
      imageSources.set(img, from);
    }
    return links;
  };

  const enqueue = (raw: string) => {
    try {
      const u = new URL(raw);
      if ((u.protocol !== "http:" && u.protocol !== "https:") || !sameSite(u.hostname, siteHost)) return;
      const n = normalizeUrl(u);
      if (seen.has(n) || isFileUrl(n)) return;
      seen.add(n);
      queue.push(n);
    } catch {
      /* se ignora */
    }
  };

  // 1. Inicio
  const homeUrl = normalizeUrl(start);
  seen.add(homeUrl);
  let homeLinks: string[] | null;
  try {
    // El inicio es indispensable: si falla (por ejemplo, se demoró una vez), se intenta otra vez.
    homeLinks = await visit(homeUrl, true).catch(async () => {
      await sleep(500);
      return visit(homeUrl, true);
    });
  } catch (e) {
    throw bi(`No se pudo abrir ${start.href} (${reason(e)}). Revisa que la dirección esté bien escrita y que la página funcione.`, `Couldn't open ${start.href} (${reason(e)}). Check that the address is spelled right and the site is up.`);
  }
  if (!pages.length || homeLinks === null) {
    throw bi(`${start.href} no parece una página web (no devolvió HTML).`, `${start.href} doesn't look like a web page (it didn't return HTML).`);
  }
  const home = pages[0].finalUrl;
  const homeU = new URL(home);
  const origin = homeU.origin;
  homeLinks.forEach(enqueue);

  // 2. Velocidad con Google, /llms.txt, http→https y www (en paralelo) + robots.txt y sitemap
  const psi = pageSpeed(home);
  const llmsP = (async (): Promise<LlmsTxtState | null> => {
    try {
      const r = await getRetry(`${origin}/llms.txt`, "GET", Math.min(allUntil, Date.now() + REQ_TIMEOUT));
      if (r.status >= 400) {
        drop(r.res);
        return checkLlmsTxt(r.status, "", "");
      }
      const { text } = await readText(r.res);
      return checkLlmsTxt(r.status, r.res.headers.get("content-type") ?? "", text.slice(0, 200_000));
    } catch {
      return null;
    }
  })();
  const https = homeU.protocol === "https:";
  const httpP = (async (): Promise<boolean | null> => {
    if (!https) return null;
    try {
      const r = await net.get(`http://${homeU.host}/`, "GET", Math.min(REQ_TIMEOUT, Math.max(3000, left(allUntil))));
      drop(r.res);
      return new URL(r.url).protocol === "https:";
    } catch {
      return null;
    }
  })();
  const altHost = homeU.hostname.startsWith("www.") ? homeU.hostname.slice(4) : `www.${homeU.hostname}`;
  const wwwP = (async (): Promise<boolean | null> => {
    try {
      const r = await net.get(`${homeU.protocol}//${altHost}/`, "GET", Math.min(REQ_TIMEOUT, left(allUntil)));
      drop(r.res);
      if (r.status >= 400) return null; // la otra versión no existe: no hay nada que unir
      return new URL(r.url).hostname === homeU.hostname;
    } catch {
      return null; // no existe (DNS) o no responde
    }
  })();

  let robots = false;
  /** false = robots.txt no respondió (ni que sí ni que no): no se marca como problema. */
  let robotsChecked = true;
  let robotsAi: RobotsAi | undefined;
  let sitemapFiles: string[] = [];
  try {
    const r = await getRetry(`${origin}/robots.txt`, "GET", crawlUntil);
    if (r.status === 200) {
      const { text } = await readText(r.res);
      if (!/^\s*</.test(text)) {
        robots = true;
        robotsAi = robotsAiCheck(text);
        sitemapFiles = [...text.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]);
      }
    } else drop(r.res);
  } catch {
    robotsChecked = false;
  }
  if (!sitemapFiles.length) sitemapFiles = [`${origin}/sitemap.xml`];
  let sitemap = false;
  /** Algún sitemap respondió (aunque sea «no existe»). Si ninguno respondió, no se sabe y no se marca como problema. */
  let sitemapChecked = false;
  let sitemapHreflang = false;
  const sitemapUrls = new Set<string>();
  const readSitemap = async (url: string): Promise<ReturnType<typeof parseSitemap> | null> => {
    try {
      const r = await getRetry(url, "GET", crawlUntil);
      sitemapChecked = true;
      if (r.status !== 200) {
        drop(r.res);
        return null;
      }
      const { text } = await readText(r.res);
      if (!/<(urlset|sitemapindex)\b/i.test(text)) return null;
      return parseSitemap(text);
    } catch {
      return null;
    }
  };
  for (const file of sitemapFiles.slice(0, 3)) {
    const s = await readSitemap(file);
    if (!s) continue;
    sitemap = true;
    if (s.index) {
      // Un nivel de índice: hasta 5 sitemaps hijos.
      const children = await Promise.all(s.urls.slice(0, 5).map(readSitemap));
      for (const c of children)
        if (c && !c.index) {
          c.urls.forEach((u) => sitemapUrls.add(u));
          if (c.hreflang) sitemapHreflang = true;
        }
    } else {
      s.urls.forEach((u) => sitemapUrls.add(u));
      if (s.hreflang) sitemapHreflang = true;
    }
  }
  const sitemapNorm = new Set<string>();
  for (const u of [...sitemapUrls].slice(0, 500)) {
    try {
      sitemapNorm.add(normalizeUrl(u));
    } catch {
      /* dirección mal escrita en el sitemap */
    }
  }
  [...sitemapUrls].slice(0, 500).forEach(enqueue);

  // 3. Recorrer el sitio: 6 a la vez, hasta 60 páginas o hasta que se acabe el tiempo.
  let inflight = 0;
  let attempts = 1;
  const worker = async () => {
    while (left(crawlUntil) > 500 && attempts < MAX_ATTEMPTS) {
      if (pages.length + inflight >= MAX_PAGES) {
        if (inflight === 0) return;
        await sleep(50);
        continue;
      }
      const next = queue.shift();
      if (!next) {
        if (inflight === 0) return;
        await sleep(50);
        continue;
      }
      if (recorded.has(next)) continue;
      inflight++;
      attempts++;
      try {
        const links = await visit(next);
        links?.forEach(enqueue);
      } finally {
        inflight--;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const pending = queue.filter((u) => !recorded.has(u)).length;
  const stoppedEarly = pending > 0 && pages.length < MAX_PAGES;

  // 4. Enlaces rotos (hasta 50), fotos rotas (hasta 40) y direcciones viejas de WordPress (hasta 20), 6 a la vez.
  const checkStatus = async (u: string, map: Map<string, number>, until: number) => {
    if (left(until) < 500) return;
    try {
      const h = await net.get(u, "HEAD", left(until));
      drop(h.res);
      if (![400, 403, 405, 501].includes(h.status)) return void map.set(u, h.status);
    } catch {
      /* se intenta con GET */
    }
    try {
      const g = await net.get(u, "GET", left(until));
      drop(g.res);
      map.set(u, g.status);
    } catch {
      /* no se sabe: no se marca como roto */
    }
  };
  const imageStatus = new Map<string, number>();
  const toCheck = [...linkSources.keys()].filter((u) => !statusOf.has(u)).slice(0, MAX_LINK_CHECKS);
  const imagesToCheck = [...imageSources].sort((a, b) => b[1].size - a[1].size).map(([u]) => u).slice(0, MAX_IMAGE_CHECKS);

  // Direcciones viejas: las del sitemap, las enlazadas y unas clásicas que se prueban aunque nadie las enlace.
  const junkWhere = new Map<string, JunkUrl["where"]>();
  for (const u of sitemapNorm) if (isJunkWpUrl(u)) junkWhere.set(u, "sitemap");
  for (const u of linkSources.keys()) if (isJunkWpUrl(u) && !junkWhere.has(u)) junkWhere.set(u, "link");
  for (const p of WP_PROBES) {
    const u = normalizeUrl(new URL(p, origin));
    if (!junkWhere.has(u)) junkWhere.set(u, "probe");
  }
  const junkUrls: JunkUrl[] = [];
  const pageByUrl = new Map<string, AuditPage>();
  for (const p of pages) {
    pageByUrl.set(p.url, p);
    pageByUrl.set(p.finalUrl, p);
  }
  const checkJunk = async (u: string) => {
    const where = junkWhere.get(u)!;
    const known = pageByUrl.get(u);
    let status = known ? known.status : 0;
    let final = known ? known.finalUrl : u;
    let noindex = known?.noindex ?? false;
    let canonical = known?.canonical ?? "";
    if (!known) {
      if (left(allUntil) < 500) return;
      try {
        const r = await net.get(u, "GET", left(allUntil));
        status = r.status;
        final = normalizeUrl(r.url);
        const type = r.res.headers.get("content-type") ?? "";
        if (r.status === 200 && /html/i.test(type)) {
          const a = analyzePage((await readText(r.res)).text, final);
          noindex = a.noindex || /noindex|\bnone\b/i.test(r.res.headers.get("x-robots-tag") ?? "");
          canonical = a.canonical;
        } else drop(r.res);
      } catch {
        return;
      }
    }
    // Sigue abierta si responde 200 en una dirección vieja, Google la puede mostrar y no apunta a otra página.
    const pointsElsewhere = !!canonical && normalizeUrl(canonical) !== final && !isJunkWpUrl(canonical);
    const live = status === 200 && isJunkWpUrl(final) && !noindex && !pointsElsewhere;
    if (live || where === "sitemap") junkUrls.push({ url: u, status, where, live });
  };

  const tasks: (() => Promise<void>)[] = [
    ...toCheck.map((u) => () => checkStatus(u, statusOf, allUntil)),
    ...imagesToCheck.map((u) => () => checkStatus(u, imageStatus, allUntil)),
    ...[...junkWhere.keys()].slice(0, MAX_JUNK_CHECKS).map((u) => () => checkJunk(u)),
  ];
  await pool(tasks, CONCURRENCY, (task) => task());

  const brokenLinks: BrokenLink[] = [...linkSources]
    .filter(([u]) => (statusOf.get(u) ?? 0) >= 400)
    .slice(0, 50)
    .map(([url, from]) => ({ url, status: statusOf.get(url)!, from: [...from].slice(0, 5) }));
  const brokenImages: BrokenLink[] = [...imageSources]
    .filter(([u]) => (imageStatus.get(u) ?? 0) >= 400)
    .slice(0, 50)
    .map(([url, from]) => ({ url, status: imageStatus.get(url)!, from: [...from].slice(0, 5) }));

  // 5. Cómo están enlazadas las páginas: clics desde el inicio, enlaces que recibe cada una y si está en el sitemap.
  const alias = (u: string) => finalOf.get(u) ?? u;
  const graph = linkGraph(home, edges, alias);
  const depthCounts: Record<string, number> = {};
  const crawlComplete = pending === 0;
  for (const p of pages) {
    if (!isOk(p)) continue;
    const key = p.finalUrl || p.url;
    const d = graph.depth.get(key);
    p.depth = d ?? null;
    p.inlinks = graph.inlinks.get(key) ?? 0;
    p.inSitemap = sitemapNorm.has(normalizeUrl(p.url)) || sitemapNorm.has(normalizeUrl(key));
    const bucket = d === undefined ? "none" : d > LIMITS.deepClicks ? `${LIMITS.deepClicks + 1}+` : String(d);
    depthCounts[bucket] = (depthCounts[bucket] ?? 0) + 1;
  }

  // 6. Direcciones del sitemap que no sirven (solo las que se leyeron; las viejas de WordPress van aparte).
  const sitemapBad: SitemapBad[] = [];
  for (const p of pages) {
    const u = normalizeUrl(p.url);
    if (!sitemapNorm.has(u) || isJunkWpUrl(u) || p.error) continue;
    const final = p.finalUrl || p.url;
    if (p.status >= 400) sitemapBad.push({ url: u, status: p.status, why: "error" });
    else if (final !== u) sitemapBad.push({ url: u, status: p.status, why: "redirect", to: final });
    else if (p.noindex) sitemapBad.push({ url: u, status: p.status, why: "noindex" });
  }

  const [llms, httpRedirects, wwwRedirects] = await Promise.all([llmsP, httpP, wwwP]);
  const site: SiteInfo = {
    home,
    robots,
    sitemap,
    sitemapUrls: sitemapUrls.size,
    https,
    httpRedirects,
    localBusinessSchema: hasBusinessSchema(homeSchema),
    brokenLinks,
    checkedLinks: [...linkSources.keys()].filter((u) => statusOf.has(u)).length,
    stoppedEarly,
    robotsChecked,
    sitemapChecked,
    ...(robotsAi ? { robotsAi } : {}),
    llms,
    wwwRedirects,
    altHost,
    junkUrls: junkUrls.slice(0, 50),
    sitemapBad: sitemapBad.slice(0, 100),
    brokenImages,
    checkedImages: imageStatus.size,
    sitemapHreflang,
    depthCounts,
    crawlComplete,
  };
  const issues = findIssues(pages, site);
  // Qué se revisó de verdad (si algo no se pudo probar, no cuenta como «arreglado» al comparar).
  const skipped = new Set<IssueId>([
    ...(robotsAi ? [] : (["robots-blocks-site", "ai-search-bots-blocked", "ai-training-bots-blocked"] as IssueId[])),
    ...(llms ? [] : (["llms-txt-missing", "llms-txt-invalid"] as IssueId[])),
    ...(wwwRedirects === null ? (["www-mismatch"] as IssueId[]) : []),
    ...(robotsChecked ? [] : (["no-robots"] as IssueId[])),
    ...(sitemapChecked ? [] : (["no-sitemap"] as IssueId[])),
  ]);
  return {
    version: 2,
    website: start.href,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    pages,
    site,
    pagespeed: await psi,
    issues,
    score: scoreFor(issues, pages.length),
    checks: ISSUE_IDS.filter((id) => !skipped.has(id)),
    maxPages: MAX_PAGES,
  };
}

function emptyAnalysis(url: string): Omit<PageAnalysis, "links"> {
  let https = false;
  try {
    https = new URL(url).protocol === "https:";
  } catch {
    /* sin URL */
  }
  return { title: "", description: "", h1Count: 0, h1: "", canonical: "", noindex: false, lang: "", images: 0, imagesNoAlt: 0, words: 0, viewport: false, ogImage: false, jsonLd: false, schema: [], https };
}

// ---------- Leer un reporte guardado (con cuidado: puede ser de un formato viejo) ----------

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const bool = (v: unknown) => v === true;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown) => arr(v).filter((x): x is string => typeof x === "string");
/** Un campo opcional: solo se copia si viene (así los reportes viejos quedan igual que antes). */
const opt = <K extends string, T>(k: K, v: T | undefined): Partial<Record<K, T>> => (v === undefined ? {} : ({ [k]: v } as Record<K, T>));
const optNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const optBool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
const optStr = (v: unknown) => (typeof v === "string" ? v : undefined);
const biOf = (v: unknown) => {
  const o = obj(v);
  return typeof o.es === "string" || typeof o.en === "string" ? { es: str(o.es) || str(o.en), en: str(o.en) || str(o.es) } : undefined;
};
const brokenOf = (v: unknown): BrokenLink[] =>
  arr(v).map((x) => {
    const b = obj(x);
    return { url: str(b.url), status: num(b.status), from: strs(b.from) };
  });
const SCHEMA_KINDS = new Set<string>(["invalid-json", "wrong-property", "business-incomplete", "opening-hours", "org-incomplete"]);

function readRobotsAi(v: unknown): RobotsAi | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = obj(v);
  return { blocksGoogle: bool(o.blocksGoogle), searchBlocked: strs(o.searchBlocked), trainingBlocked: strs(o.trainingBlocked) };
}
function readLlms(v: unknown): LlmsTxtState | null | undefined {
  if (v === null) return null;
  const o = obj(v);
  if (o.status === "ok") return { status: "ok" };
  if (o.status === "missing") return { status: "missing", why: o.why === "html" ? "html" : "not-found" };
  if (o.status === "invalid") return { status: "invalid", problems: strs(o.problems).filter((p): p is "empty" | "no-title" | "no-summary" | "no-links" => ["empty", "no-title", "no-summary", "no-links"].includes(p)) };
  return undefined;
}

export function readAuditReport(data: unknown): AuditReport | null {
  const d = obj(data);
  if (!Array.isArray(d.pages) || !Array.isArray(d.issues)) return null;
  const pages: AuditPage[] = arr(d.pages).map((x) => {
    const p = obj(x);
    const findings = arr(p.schemaFindings)
      .map(obj)
      .filter((f) => SCHEMA_KINDS.has(str(f.kind)))
      .map((f) => ({ kind: str(f.kind) as SchemaFindingKind, value: str(f.value) }));
    return {
      url: str(p.url),
      finalUrl: str(p.finalUrl) || str(p.url),
      status: num(p.status),
      ms: num(p.ms),
      bytes: num(p.bytes),
      title: str(p.title),
      description: str(p.description),
      h1Count: num(p.h1Count),
      h1: str(p.h1),
      canonical: str(p.canonical),
      noindex: bool(p.noindex),
      lang: str(p.lang),
      images: num(p.images),
      imagesNoAlt: num(p.imagesNoAlt),
      words: num(p.words),
      internalLinks: num(p.internalLinks),
      viewport: bool(p.viewport),
      ogImage: bool(p.ogImage),
      jsonLd: bool(p.jsonLd),
      schema: strs(p.schema),
      https: bool(p.https),
      ...(typeof p.error === "string" ? { error: p.error } : {}),
      ...opt("h2Count", optNum(p.h2Count)),
      ...opt("hasMain", optBool(p.hasMain)),
      ...opt("longParagraphs", optNum(p.longParagraphs)),
      ...opt("longestParagraph", optNum(p.longestParagraph)),
      ...opt("longSample", optStr(p.longSample)),
      ...opt("textRatio", optNum(p.textRatio)),
      ...opt("linksTotal", optNum(p.linksTotal)),
      ...opt("wpLinks", optNum(p.wpLinks)),
      ...opt("wpSample", optStr(p.wpSample)),
      ...opt("mixed", Array.isArray(p.mixed) ? strs(p.mixed) : undefined),
      ...opt("mixedCount", optNum(p.mixedCount)),
      ...opt("hreflang", optNum(p.hreflang)),
      ...opt("textHash", optStr(p.textHash)),
      ...opt("schemaFindings", Array.isArray(p.schemaFindings) ? findings : undefined),
      ...opt("depth", p.depth === null ? null : optNum(p.depth)),
      ...opt("inlinks", optNum(p.inlinks)),
      ...opt("inSitemap", optBool(p.inSitemap)),
    };
  });
  const issues: Issue[] = arr(d.issues).flatMap((x) => {
    const i = obj(x);
    const id = str(i.id);
    if (!isIssueId(id)) return [];
    const urls = strs(i.pages);
    const items: IssueItem[] = Array.isArray(i.items)
      ? arr(i.items)
          .map(obj)
          .filter((it) => typeof it.url === "string")
          .map((it) => ({ url: str(it.url), ...opt("value", optStr(it.value)), ...opt("detail", biOf(it.detail)) }))
      : urls.map((url) => ({ url }));
    return [{ id, severity: ISSUE_SEVERITY[id], pages: urls, count: num(i.count, urls.length), category: ISSUE_META[id].category, items, ...opt("total", optNum(i.total)) }];
  });
  const s = obj(d.site);
  const site: SiteInfo = {
    home: str(s.home) || pages[0]?.finalUrl || "",
    robots: bool(s.robots),
    sitemap: bool(s.sitemap),
    sitemapUrls: num(s.sitemapUrls),
    https: bool(s.https),
    httpRedirects: typeof s.httpRedirects === "boolean" ? s.httpRedirects : null,
    localBusinessSchema: bool(s.localBusinessSchema),
    brokenLinks: brokenOf(s.brokenLinks),
    checkedLinks: num(s.checkedLinks),
    stoppedEarly: bool(s.stoppedEarly),
    ...opt("robotsChecked", optBool(s.robotsChecked)),
    ...opt("sitemapChecked", optBool(s.sitemapChecked)),
    ...opt("robotsAi", readRobotsAi(s.robotsAi)),
    ...opt("llms", readLlms(s.llms)),
    ...opt("wwwRedirects", typeof s.wwwRedirects === "boolean" ? s.wwwRedirects : s.wwwRedirects === null ? null : undefined),
    ...opt("altHost", optStr(s.altHost)),
    ...opt(
      "junkUrls",
      Array.isArray(s.junkUrls)
        ? arr(s.junkUrls).map((x) => {
            const j = obj(x);
            const where: JunkUrl["where"] = j.where === "sitemap" || j.where === "link" ? j.where : "probe";
            return { url: str(j.url), status: num(j.status), where, live: bool(j.live) };
          })
        : undefined,
    ),
    ...opt(
      "sitemapBad",
      Array.isArray(s.sitemapBad)
        ? arr(s.sitemapBad).map((x) => {
            const b = obj(x);
            const why: SitemapBad["why"] = b.why === "redirect" || b.why === "noindex" ? b.why : "error";
            return { url: str(b.url), status: num(b.status), why, ...opt("to", optStr(b.to)) };
          })
        : undefined,
    ),
    ...opt("brokenImages", Array.isArray(s.brokenImages) ? brokenOf(s.brokenImages) : undefined),
    ...opt("checkedImages", optNum(s.checkedImages)),
    ...opt("sitemapHreflang", optBool(s.sitemapHreflang)),
    ...opt(
      "depthCounts",
      s.depthCounts && typeof s.depthCounts === "object" ? Object.fromEntries(Object.entries(obj(s.depthCounts)).filter(([, v]) => typeof v === "number")) as Record<string, number> : undefined,
    ),
    ...opt("crawlComplete", optBool(s.crawlComplete)),
  };
  const ps = obj(d.pagespeed);
  const pagespeed: PageSpeed =
    typeof ps.error === "string" || !Object.keys(ps).length
      ? { error: str(ps.error) || "—" }
      : {
          performance: numOrNull(ps.performance),
          seo: numOrNull(ps.seo),
          accessibility: numOrNull(ps.accessibility),
          bestPractices: numOrNull(ps.bestPractices),
          lcp: str(ps.lcp),
          cls: str(ps.cls),
          tbt: str(ps.tbt),
        };
  const checks = strs(d.checks).filter(isIssueId);
  return {
    version: d.version === 2 ? 2 : 1,
    website: str(d.website),
    startedAt: str(d.startedAt),
    finishedAt: str(d.finishedAt),
    pages,
    site,
    pagespeed,
    issues: issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count),
    score: Math.max(0, Math.min(100, Math.round(num(d.score, scoreFor(issues, pages.length))))),
    ...(checks.length ? { checks } : {}),
    ...opt("maxPages", optNum(d.maxPages)),
  };
}

// ---------- Para otras pantallas (plan de acción): cada problema listo para mostrar ----------

export type IssueView = {
  id: IssueId;
  severity: Severity;
  category: IssueCategory;
  categoryLabel: { es: string; en: string };
  title: { es: string; en: string };
  fix: { es: string; en: string };
  /** En qué se cuenta (páginas, enlaces, direcciones, fotos o todo el sitio). */
  unit: (typeof ISSUE_META)[IssueId]["unit"];
  count: number;
  total?: number;
  items: IssueItem[];
};

/** Un problema con todo lo necesario para convertirlo en tarea (título y arreglo en es/en, grupo, direcciones y valores). */
export function issueView(i: Issue): IssueView {
  const meta = ISSUE_META[i.id];
  const t = ISSUE_TEXT[i.id];
  return {
    id: i.id,
    severity: ISSUE_SEVERITY[i.id],
    category: meta.category,
    categoryLabel: CATEGORY_LABEL[meta.category],
    title: { es: t.es.title, en: t.en.title },
    fix: { es: t.es.fix, en: t.en.fix },
    unit: meta.unit,
    count: i.count,
    ...(i.total !== undefined ? { total: i.total } : {}),
    items: i.items?.length ? i.items : i.pages.map((url) => ({ url })),
  };
}
