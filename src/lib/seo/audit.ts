// Auditoría SEO gratis del sitio del negocio: recorre hasta 30 páginas, lee robots.txt y el sitemap,
// revisa enlaces rotos, mide la velocidad con Google PageSpeed y arma una lista de problemas con un puntaje.
// Sin dependencias nuevas: el HTML se lee con expresiones regulares (suficiente para estas revisiones).
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { bi } from "@/lib/i18n";

export const AUDIT_UA = "Mozilla/5.0 (compatible; ArevaloMarketingBot/1.0)";
const MAX_PAGES = 30;
const MAX_ATTEMPTS = 60; // incluye respuestas que no son HTML
const CONCURRENCY = 4;
const REQ_TIMEOUT = 10_000;
const CRAWL_MS = 75_000; // leer páginas
const TOTAL_MS = 90_000; // leer páginas + revisar enlaces
const MAX_LINK_CHECKS = 50;
const PSI_TIMEOUT = 60_000;
const MAX_HTML_CHARS = 3_000_000;

// ---------- Tipos ----------

export const ISSUE_IDS = [
  "page-errors",
  "broken-links",
  "missing-title",
  "no-https",
  "no-viewport",
  "noindex",
  "duplicate-title",
  "title-too-long",
  "missing-description",
  "duplicate-description",
  "missing-h1",
  "images-no-alt",
  "slow-page",
  "no-sitemap",
  "no-structured-data",
  "title-too-short",
  "description-length",
  "multiple-h1",
  "thin-content",
  "no-og-image",
  "missing-lang",
  "no-robots",
] as const;
export type IssueId = (typeof ISSUE_IDS)[number];
export type Severity = "error" | "warning" | "notice";

export const ISSUE_SEVERITY: Record<IssueId, Severity> = {
  "page-errors": "error",
  "broken-links": "error",
  "missing-title": "error",
  "no-https": "error",
  "no-viewport": "error",
  noindex: "warning",
  "duplicate-title": "warning",
  "title-too-long": "warning",
  "missing-description": "warning",
  "duplicate-description": "warning",
  "missing-h1": "warning",
  "images-no-alt": "warning",
  "slow-page": "warning",
  "no-sitemap": "warning",
  "no-structured-data": "warning",
  "title-too-short": "notice",
  "description-length": "notice",
  "multiple-h1": "notice",
  "thin-content": "notice",
  "no-og-image": "notice",
  "missing-lang": "notice",
  "no-robots": "notice",
};

/** Problemas de todo el sitio (no de páginas sueltas): restan el peso completo. */
const SITE_LEVEL = new Set<IssueId>(["no-sitemap", "no-robots", "no-structured-data"]);

export type Issue = { id: IssueId; severity: Severity; pages: string[]; count: number };

/** Lo que se lee del HTML de una página. */
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
};

/** Lo que se guarda de cada página. */
export type AuditPage = Omit<PageAnalysis, "links"> & {
  url: string;
  finalUrl: string;
  status: number;
  ms: number;
  bytes: number;
  internalLinks: number;
  error?: string;
};

export type BrokenLink = { url: string; status: number; from: string[] };

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
  version: 1;
  website: string;
  startedAt: string;
  finishedAt: string;
  pages: AuditPage[];
  site: SiteInfo;
  pagespeed: PageSpeed;
  issues: Issue[];
  score: number;
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

/** Tipos de schema.org (JSON-LD) en la página, incluidos los de @graph. */
function jsonLdTypes(html: string): { found: boolean; types: string[] } {
  const types = new Set<string>();
  let found = false;
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    const o = v as Record<string, unknown>;
    const t = o["@type"];
    for (const x of Array.isArray(t) ? t : [t]) if (typeof x === "string") types.add(x.replace(/^https?:\/\/schema\.org\//, ""));
    for (const k of Object.keys(o)) if (k !== "@type") walk(o[k], depth + 1);
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1].trim();
    if (!raw) continue;
    found = true;
    try {
      walk(JSON.parse(raw), 0);
    } catch {
      for (const t of raw.matchAll(/"@type"\s*:\s*"([^"]+)"/g)) types.add(t[1]);
    }
  }
  return { found, types: [...types].slice(0, 20) };
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

export function analyzePage(html: string, url: string): PageAnalysis {
  const page = new URL(url);
  const doc = html.slice(0, MAX_HTML_CHARS).replace(/<!--[\s\S]*?-->/g, " ");
  const ld = jsonLdTypes(doc);
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
  const words = visible.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

  const links = new Set<string>();
  for (const a of tags(body, "a")) {
    const href = a.href?.trim();
    if (!href || href.startsWith("#") || /^(mailto|tel|sms|javascript|data|whatsapp|fax):/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      if ((u.protocol === "http:" || u.protocol === "https:") && sameSite(u.hostname, page.hostname)) links.add(normalizeUrl(u));
    } catch {
      /* enlace mal escrito: se ignora */
    }
    if (links.size >= 300) break;
  }

  return {
    title: clean(body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 300),
    description: meta("description").replace(/\s+/g, " ").slice(0, 500),
    h1Count: h1s.length,
    h1: clean(h1s[0]?.[1] ?? "").slice(0, 200),
    canonical: abs(tags(body, "link").find((l) => (l.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"))?.href),
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
  };
}

// ---------- Problemas y puntaje ----------

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, notice: 2 };
const isOk = (p: AuditPage) => !p.error && p.status >= 200 && p.status < 400;

export function findIssues(pages: AuditPage[], site: SiteInfo): Issue[] {
  const hits = new Map<IssueId, string[]>();
  const add = (id: IssueId, url: string) => hits.set(id, [...(hits.get(id) ?? []), url]);
  const ok = pages.filter(isOk);

  for (const p of pages) if (!p.error && p.status >= 400) add("page-errors", p.url);
  for (const p of ok) {
    const u = p.finalUrl || p.url;
    if (!p.title) add("missing-title", u);
    else if (p.title.length > 60) add("title-too-long", u);
    else if (p.title.length < 20) add("title-too-short", u);
    if (!p.description) add("missing-description", u);
    else if (p.description.length < 70 || p.description.length > 160) add("description-length", u);
    if (p.h1Count === 0) add("missing-h1", u);
    else if (p.h1Count > 1) add("multiple-h1", u);
    if (p.imagesNoAlt > 0) add("images-no-alt", u);
    if (p.noindex) add("noindex", u);
    else if (p.words < 250) add("thin-content", u);
    if (!p.https) add("no-https", u);
    if (!p.viewport) add("no-viewport", u);
    if (!p.ogImage) add("no-og-image", u);
    if (p.ms > 3000) add("slow-page", u);
    if (!p.lang) add("missing-lang", u);
  }

  // Duplicados: entre las páginas que Google puede mostrar, contando una vez las que apuntan al mismo canonical.
  const docs = new Map<string, AuditPage>();
  for (const p of ok) if (!p.noindex) docs.set(p.canonical || p.finalUrl || p.url, p);
  const dupes = (id: IssueId, key: (p: AuditPage) => string) => {
    const groups = new Map<string, string[]>();
    for (const [url, p] of docs) {
      const k = key(p).trim().toLowerCase();
      if (k) groups.set(k, [...(groups.get(k) ?? []), url]);
    }
    for (const urls of groups.values()) if (urls.length > 1) urls.forEach((u) => add(id, u));
  };
  dupes("duplicate-title", (p) => p.title);
  dupes("duplicate-description", (p) => p.description);

  if (site.httpRedirects === false) {
    try {
      add("no-https", `http://${new URL(site.home).host}/`);
    } catch {
      /* sin inicio válido */
    }
  }
  for (const b of site.brokenLinks) add("broken-links", b.url);
  if (site.home) {
    if (!site.sitemap) add("no-sitemap", site.home);
    if (!site.robots) add("no-robots", site.home);
    if (!site.localBusinessSchema) add("no-structured-data", site.home);
  }

  return ISSUE_IDS.filter((id) => hits.has(id))
    .map((id) => {
      const urls = [...new Set(hits.get(id))];
      return { id, severity: ISSUE_SEVERITY[id], count: urls.length, pages: urls.slice(0, 10) };
    })
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count);
}

/**
 * Puntaje de 0 a 100. Se empieza en 100 y cada problema resta:
 *   peso × (0.5 + 0.5 × parte)
 * peso: error 12, advertencia 4, sugerencia 1.
 * parte: páginas afectadas ÷ páginas revisadas (máximo 1); los problemas de todo el sitio (sitemap, robots.txt,
 * datos estructurados) cuentan como parte = 1. Así un problema en una sola página resta la mitad de su peso y
 * en todas, el peso completo. Se redondea y nunca baja de 0.
 */
export function scoreFor(issues: Pick<Issue, "id" | "severity" | "count">[], pageCount: number): number {
  const WEIGHT: Record<Severity, number> = { error: 12, warning: 4, notice: 1 };
  let score = 100;
  for (const i of issues) {
    const share = SITE_LEVEL.has(i.id) || pageCount <= 0 ? 1 : Math.min(1, Math.max(0, i.count) / pageCount);
    score -= (WEIGHT[i.severity] ?? 0) * (0.5 + 0.5 * share);
  }
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

/** Las direcciones de un sitemap (<loc>) y si es un índice de sitemaps. */
export function parseSitemap(xml: string): { index: boolean; urls: string[] } {
  const urls = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decodeEntities(m[1].trim())).filter(Boolean);
  return { index: /<sitemapindex\b/i.test(xml), urls };
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

  const pages: AuditPage[] = [];
  const statusOf = new Map<string, number>();
  const linkSources = new Map<string, Set<string>>();
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
      f = await net.get(url, "GET", left(crawlUntil));
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
    const { links, ...rest } = a;
    pages.push({ ...rest, url, finalUrl: final, status: f.status, ms: Date.now() - t, bytes: body.bytes, internalLinks: links.length });
    for (const l of links) {
      const from = linkSources.get(l) ?? new Set<string>();
      from.add(final);
      linkSources.set(l, from);
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
    homeLinks = await visit(homeUrl, true);
  } catch (e) {
    throw bi(`No se pudo abrir ${start.href} (${reason(e)}). Revisa que la dirección esté bien escrita y que la página funcione.`, `Couldn't open ${start.href} (${reason(e)}). Check that the address is spelled right and the site is up.`);
  }
  if (!pages.length || homeLinks === null) {
    throw bi(`${start.href} no parece una página web (no devolvió HTML).`, `${start.href} doesn't look like a web page (it didn't return HTML).`);
  }
  const home = pages[0].finalUrl;
  const origin = new URL(home).origin;
  homeLinks.forEach(enqueue);

  // 2. Velocidad con Google (en paralelo) + robots.txt y sitemap
  const psi = pageSpeed(home);
  let robots = false;
  let sitemapFiles: string[] = [];
  try {
    const r = await net.get(`${origin}/robots.txt`, "GET", left(crawlUntil));
    if (r.status === 200) {
      const { text } = await readText(r.res);
      if (!/^\s*</.test(text)) {
        robots = true;
        sitemapFiles = [...text.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]);
      }
    } else drop(r.res);
  } catch {
    /* sin robots.txt */
  }
  if (!sitemapFiles.length) sitemapFiles = [`${origin}/sitemap.xml`];
  let sitemap = false;
  const sitemapUrls = new Set<string>();
  const readSitemap = async (url: string): Promise<{ index: boolean; urls: string[] } | null> => {
    try {
      const r = await net.get(url, "GET", left(crawlUntil));
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
      for (const c of children) if (c && !c.index) c.urls.forEach((u) => sitemapUrls.add(u));
    } else s.urls.forEach((u) => sitemapUrls.add(u));
  }
  [...sitemapUrls].slice(0, 500).forEach(enqueue);

  // 3. Recorrer el sitio: 4 a la vez, hasta 30 páginas o hasta que se acabe el tiempo.
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
  const stoppedEarly = queue.length > 0 && pages.length < MAX_PAGES;

  // 4. Enlaces rotos: los enlaces internos que no se leyeron arriba (hasta 50), con HEAD y si falla, GET.
  const toCheck = [...linkSources.keys()].filter((u) => !statusOf.has(u)).slice(0, MAX_LINK_CHECKS);
  await pool(toCheck, CONCURRENCY, async (u) => {
    if (left(allUntil) < 500) return;
    try {
      const h = await net.get(u, "HEAD", left(allUntil));
      drop(h.res);
      if (![400, 403, 405, 501].includes(h.status)) return void statusOf.set(u, h.status);
    } catch {
      /* se intenta con GET */
    }
    try {
      const g = await net.get(u, "GET", left(allUntil));
      drop(g.res);
      statusOf.set(u, g.status);
    } catch {
      /* no se sabe: no se marca como roto */
    }
  });
  const brokenLinks: BrokenLink[] = [...linkSources]
    .filter(([u]) => (statusOf.get(u) ?? 0) >= 400)
    .slice(0, 50)
    .map(([url, from]) => ({ url, status: statusOf.get(url)!, from: [...from].slice(0, 5) }));

  // 5. https y redirección desde http
  const https = new URL(home).protocol === "https:";
  let httpRedirects: boolean | null = null;
  if (https) {
    try {
      const r = await net.get(`http://${new URL(home).host}/`, "GET", Math.min(REQ_TIMEOUT, Math.max(3000, left(allUntil))));
      drop(r.res);
      httpRedirects = new URL(r.url).protocol === "https:";
    } catch {
      httpRedirects = null;
    }
  }

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
  };
  const issues = findIssues(pages, site);
  return {
    version: 1,
    website: start.href,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    pages,
    site,
    pagespeed: await psi,
    issues,
    score: scoreFor(issues, pages.length),
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

export function readAuditReport(data: unknown): AuditReport | null {
  const d = obj(data);
  if (!Array.isArray(d.pages) || !Array.isArray(d.issues)) return null;
  const pages: AuditPage[] = arr(d.pages).map((x) => {
    const p = obj(x);
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
    };
  });
  const issues: Issue[] = arr(d.issues).flatMap((x) => {
    const i = obj(x);
    const id = str(i.id) as IssueId;
    if (!(ISSUE_IDS as readonly string[]).includes(id)) return [];
    const urls = strs(i.pages);
    return [{ id, severity: ISSUE_SEVERITY[id], pages: urls, count: num(i.count, urls.length) }];
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
    brokenLinks: arr(s.brokenLinks).map((x) => {
      const b = obj(x);
      return { url: str(b.url), status: num(b.status), from: strs(b.from) };
    }),
    checkedLinks: num(s.checkedLinks),
    stoppedEarly: bool(s.stoppedEarly),
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
  return {
    version: 1,
    website: str(d.website),
    startedAt: str(d.startedAt),
    finishedAt: str(d.finishedAt),
    pages,
    site,
    pagespeed,
    issues: issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count),
    score: Math.max(0, Math.min(100, Math.round(num(d.score, scoreFor(issues, pages.length))))),
  };
}

// ---------- Textos de cada problema ----------

type IssueCopy = { title: string; fix: string };
export const ISSUE_TEXT: Record<IssueId, { es: IssueCopy; en: IssueCopy }> = {
  "page-errors": {
    es: { title: "Páginas que no abren", fix: "Algunas páginas dan error (por ejemplo, «no encontrada»). Arréglalas o haz que lleven a una página que sí exista, y quita los enlaces que apuntan a ellas." },
    en: { title: "Pages that don't load", fix: "Some pages return an error (like \"not found\"). Fix them or redirect them to a page that exists, and remove links pointing to them." },
  },
  "broken-links": {
    es: { title: "Enlaces rotos", fix: "Hay enlaces en tu página que llevan a páginas que no existen. Cámbialos por la dirección correcta o quítalos." },
    en: { title: "Broken links", fix: "Some links on your site go to pages that don't exist. Point them to the right address or remove them." },
  },
  "missing-title": {
    es: { title: "Páginas sin título", fix: "Cada página necesita su propio título de 50 a 60 letras que diga de qué trata y tu ciudad. Es lo que sale en azul en Google." },
    en: { title: "Pages without a title", fix: "Each page needs its own title of 50-60 characters that says what the page is about and your city. It's the blue headline people see on Google." },
  },
  "no-https": {
    es: { title: "Sin conexión segura (https)", fix: "Tu página debe abrir con https (el candado). Pídele a quien maneja tu hosting que active el certificado SSL gratis y que http mande siempre a https." },
    en: { title: "No secure connection (https)", fix: "Your site should open with https (the padlock). Ask whoever runs your hosting to turn on a free SSL certificate and send all http visits to https." },
  },
  "no-viewport": {
    es: { title: "No se adapta al celular", fix: "Falta la etiqueta que hace que la página se vea bien en el celular. Pídele a tu diseñador que agregue la etiqueta «viewport»; Google da prioridad a las páginas que se ven bien en el teléfono." },
    en: { title: "Not mobile-friendly", fix: "The tag that makes the page fit on phones is missing. Ask your web designer to add the \"viewport\" tag; Google favors pages that work well on phones." },
  },
  noindex: {
    es: { title: "Páginas escondidas de Google", fix: "Estas páginas le dicen a Google que no las muestre (noindex). Si quieres que la gente las encuentre, quita esa opción en tu editor de página." },
    en: { title: "Pages hidden from Google", fix: "These pages tell Google not to show them (noindex). If you want people to find them, turn that setting off in your website editor." },
  },
  "duplicate-title": {
    es: { title: "Títulos repetidos", fix: "Varias páginas tienen el mismo título. Dale a cada una un título distinto que diga el servicio específico y tu ciudad." },
    en: { title: "Duplicate titles", fix: "Several pages share the same title. Give each one a different title that names the specific service and your city." },
  },
  "title-too-long": {
    es: { title: "Títulos muy largos", fix: "Google corta los títulos de más de 60 letras. Acórtalos y pon primero lo más importante: el servicio y la ciudad." },
    en: { title: "Titles too long", fix: "Google cuts off titles longer than 60 characters. Shorten them and put the most important part first: the service and the city." },
  },
  "missing-description": {
    es: { title: "Sin descripción", fix: "Escribe para cada página una descripción de 120 a 155 letras que invite a hacer clic: qué ofreces, dónde y por qué elegirte. Es el texto gris debajo del título en Google." },
    en: { title: "Missing description", fix: "Write a 120-155 character description for each page that makes people want to click: what you offer, where, and why choose you. It's the gray text under the title on Google." },
  },
  "duplicate-description": {
    es: { title: "Descripciones repetidas", fix: "Varias páginas tienen la misma descripción. Escribe una distinta para cada página, según lo que ofrece esa página." },
    en: { title: "Duplicate descriptions", fix: "Several pages share the same description. Write a different one for each page, based on what that page offers." },
  },
  "missing-h1": {
    es: { title: "Sin título principal (H1)", fix: "Cada página necesita un título grande arriba (H1) que diga de qué trata, por ejemplo «Reparación de techos en Miami»." },
    en: { title: "Missing main heading (H1)", fix: "Each page needs one big heading at the top (H1) that says what it's about, like \"Roof Repair in Miami\"." },
  },
  "images-no-alt": {
    es: { title: "Fotos sin descripción (alt)", fix: "Agrega a cada foto una descripción corta de lo que muestra (texto alternativo). Ayuda a salir en Google Imágenes y a las personas con problemas de vista." },
    en: { title: "Images without alt text", fix: "Add a short description of what each photo shows (alt text). It helps you show up in Google Images and helps people with low vision." },
  },
  "slow-page": {
    es: { title: "Páginas lentas", fix: "Estas páginas tardan más de 3 segundos en responder. Usa fotos más livianas, quita lo que no uses y considera un hosting más rápido." },
    en: { title: "Slow pages", fix: "These pages take more than 3 seconds to respond. Use lighter photos, remove what you don't use, and consider faster hosting." },
  },
  "no-sitemap": {
    es: { title: "Sin mapa del sitio (sitemap)", fix: "Un sitemap le dice a Google qué páginas tienes. La mayoría de los editores (WordPress, Wix, Squarespace) lo crean solos: actívalo y envíalo en Google Search Console." },
    en: { title: "No sitemap", fix: "A sitemap tells Google which pages you have. Most website builders (WordPress, Wix, Squarespace) make one for you: turn it on and submit it in Google Search Console." },
  },
  "no-structured-data": {
    es: { title: "Google no sabe que eres un negocio local", fix: "Agrega a tu página de inicio los datos del negocio en formato de Google (LocalBusiness): nombre, dirección, teléfono y horario. Ayuda a salir en el mapa y en las IAs." },
    en: { title: "Google can't tell you're a local business", fix: "Add your business details to your home page in Google's format (LocalBusiness): name, address, phone and hours. It helps you show up on the map and in AI answers." },
  },
  "title-too-short": {
    es: { title: "Títulos muy cortos", fix: "Un título de menos de 20 letras desperdicia espacio. Agrega el servicio y tu ciudad, por ejemplo «Plomero en Doral | Tu Negocio»." },
    en: { title: "Titles too short", fix: "A title under 20 characters wastes space. Add the service and your city, like \"Plumber in Doral | Your Business\"." },
  },
  "description-length": {
    es: { title: "Descripción muy corta o muy larga", fix: "La descripción funciona mejor con 120 a 155 letras: menos dice muy poco y más se corta en Google." },
    en: { title: "Description too short or too long", fix: "Descriptions work best at 120-155 characters: shorter says too little and longer gets cut off on Google." },
  },
  "multiple-h1": {
    es: { title: "Más de un título principal (H1)", fix: "Usa un solo título grande (H1) por página y los demás como subtítulos (H2), para que Google entienda cuál es el tema." },
    en: { title: "More than one main heading (H1)", fix: "Use just one big heading (H1) per page and make the others subheadings (H2), so Google knows what the main topic is." },
  },
  "thin-content": {
    es: { title: "Poco texto", fix: "Estas páginas tienen menos de 250 palabras. Explica mejor el servicio: qué incluye, a quién ayudas, en qué zonas trabajas y preguntas frecuentes." },
    en: { title: "Not much text", fix: "These pages have fewer than 250 words. Explain the service better: what's included, who you help, the areas you serve, and common questions." },
  },
  "no-og-image": {
    es: { title: "Sin foto al compartir", fix: "Cuando alguien comparte tu página en Facebook o WhatsApp no sale foto. Elige una imagen para compartir (og:image) en tu editor de página." },
    en: { title: "No image when shared", fix: "When someone shares your page on Facebook or WhatsApp, no photo shows up. Pick a sharing image (og:image) in your website editor." },
  },
  "missing-lang": {
    es: { title: "No dice en qué idioma está", fix: "La página no indica su idioma. Pídele a tu diseñador que lo marque (por ejemplo, lang=\"es\") para que Google la muestre a quien habla ese idioma." },
    en: { title: "Language not set", fix: "The page doesn't say what language it's in. Ask your web designer to set it (for example, lang=\"en\") so Google shows it to the right people." },
  },
  "no-robots": {
    es: { title: "Sin archivo robots.txt", fix: "Es un archivo pequeño que guía a Google por tu página y le dice dónde está el sitemap. Casi todos los editores lo pueden crear; no es urgente." },
    en: { title: "No robots.txt file", fix: "It's a small file that guides Google through your site and points to your sitemap. Most website builders can create it; it's not urgent." },
  },
};
