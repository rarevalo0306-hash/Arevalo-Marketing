// «Enlaces dañinos»: revisión de los sitios que enlazan al negocio y desautorización (disavow) guiada y prudente.
// PURO: sin base de datos ni red (se usa en el servidor, en el plan de acción y en tests/toxic-links.test.ts).
// La lectura de la base de datos está en src/lib/toxic-links-data.ts y las llamadas a DataForSEO en
// src/lib/seo/backlinks.ts (fetchToxicLinkData, fetchBulkSpamScores).
//
// La postura de la app (la del asesor de Ricardo): Google ya ignora casi todos los enlaces de spam. Subir un archivo de
// desautorización solo conviene si Search Console muestra una «Acción manual» por enlaces no naturales, o si hay un
// ataque claro (muchos enlaces nuevos de sitios dañinos y una caída fuerte en Google). Desautorizar enlaces buenos
// hace daño. Por eso: el resultado por defecto es «No hagas nada», la app nunca sube nada sola, nunca marca como
// dañinos el sitio del negocio, sus otros sitios, directorios, redes sociales, noticias, gobierno ni universidades.
//
// Riesgo de cada sitio (puntos; ≥5 alto · 3–4 medio · 1–2 bajo · ≤0 seguro):
//   nivel de spam de DataForSEO ≥80 +4 · ≥60 (SPAM_CUTOFF) +3 · ≥30 +1
//   tema dañino en el nombre (casino, adultos, farmacia, cripto, préstamos…) +5 · solo en el texto del enlace +3
//   granja de enlaces: la página tiene ≥100 enlaces a otros sitios +2 (≥50 +1) · nombre de directorio de enlaces +2
//   terminación barata típica del spam (.xyz, .top, .icu…) +1 · nombre raro (muchos guiones, números, muy largo) +1
//   otro idioma o país que no tiene que ver con el negocio +1 · enlace en el pie de página de todo el sitio +1
//   texto del enlace con palabras de venta exactas (+1; +1 más si eso pasa en muchos sitios a la vez)
//   puntaje de tóxico de otra herramienta (Semrush) ≥60 +2 · ≥45 +1 (Semrush marca de más: solo suma)
//   a favor: sitio con fuerza (rank ≥300 de 1000) −2 · enlace nofollow −1
//   sitios automáticos de estadísticas (hypestat, siteprice…) quedan como «bajo»: Google ya los ignora.
import { directoriesFor, type BizKind, type Region } from "@/lib/directories";
import { dfsDate, linkHint, SPAM_CUTOFF } from "@/lib/seo/backlinks";
import { brandToken, isDirectory, normalizeDomain, sameSite } from "@/lib/seo/competitors";
import { isRelevantKeyword } from "@/lib/seo/gap";
import type { Answer, Bi, Outcome, RiskLevel, SpikeLevel } from "@/lib/toxic-links-shape";

export {
  decodeExport,
  DISAVOW_HELP_URL,
  DISAVOW_TOOL_URL,
  MANUAL_ACTIONS_URL,
  OUTCOME_TEXT,
  RISK_LEVELS,
  wizardOutcome,
  type Answer,
  type Bi,
  type Outcome,
  type RiskLevel,
  type SpikeLevel,
  type Wizard,
} from "@/lib/toxic-links-shape";

// ---------- Tipos ----------


/** Un sitio que enlaza al negocio, con lo que se sabe de él (de DataForSEO, de una lista importada o de los dos). */
export type LinkDomain = {
  domain: string;
  /** Nivel de spam de DataForSEO, 0–100. */
  spamScore: number | null;
  /** Puntaje de «tóxico» de otra herramienta (Semrush Toxicity Score), 0–100. */
  toolScore: number | null;
  /** Fuerza del sitio, 0–1000 (DataForSEO; de Ahrefs/Semrush se aproxima ×10). */
  rank: number | null;
  /** Enlaces de este sitio hacia el negocio. */
  backlinks: number | null;
  firstSeen: string | null;
  /** Al menos un enlace pasa fuerza (no es nofollow). null si no se sabe. */
  dofollow: boolean | null;
  /** Textos de los enlaces (hasta 5). */
  anchors: string[];
  /** Una página de ejemplo donde está el enlace. */
  url: string | null;
  /** Enlaces a otros sitios en la página que te enlaza. */
  externalLinks: number | null;
  /** El enlace está en el pie de página (en todo el sitio). */
  footer: boolean;
  /** Idioma de la página (ISO 639-1). */
  language: string | null;
};

export type ImportFormat = "semrush" | "ahrefs" | "gsc" | "disavow" | "csv" | "plain";

export type ToxicAudit = {
  version: 1;
  type: "audit";
  source: "dataforseo" | "import";
  /** Dominio del negocio. */
  domain: string;
  createdAt: string;
  /** Cuántos sitios te enlazan en total (DataForSEO), aunque solo se lean los primeros. */
  total: number | null;
  /** Sitios nuevos en los últimos 30 días (DataForSEO). */
  newThisMonth: number | null;
  items: LinkDomain[];
  cost: number;
  notes: Bi[];
  importName?: string;
  importFormat?: ImportFormat;
  /** Líneas de la lista importada que no se entendieron. */
  skipped?: number;
  /** A la lista importada ya se le revisó el nivel de spam (DataForSEO, aparte). */
  spamChecked?: boolean;
};


export type DecisionRecord = { version: 1; type: "decision"; createdAt: string; manual: Answer; drop: Answer; outcome: Outcome };
export type DisavowRecord = { version: 1; type: "disavow"; createdAt: string; domains: string[]; outcome: Outcome | null; empty: boolean };
export type SettingsRecord = { version: 1; type: "settings"; createdAt: string; ownSites: string[] };

export const TOXIC_KIND = "toxic";
/** Revisiones guardadas que se conservan (de DataForSEO y listas importadas). Los archivos y decisiones no se borran. */
export const TOXIC_AUDITS_KEEP = 8;
/** Cuántos dominios se aceptan de una lista importada. */
export const IMPORT_MAX = 5000;
/** Tamaño máximo del texto importado (≈ 5 MB). */
export const IMPORT_MAX_CHARS = 5_000_000;
/** Enlaces nuevos de sitios dañinos desde los que el plan de acción avisa. */
export const TOXIC_ALERT_MIN = 10;
/** Días en que un sitio cuenta como «nuevo». */
export const NEW_DAYS = 30;


// ---------- Ayudantes ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const bi = (es: string, en: string): Bi => ({ es, en });
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
const pushAnchor = (list: string[], a: string) => {
  const v = clean(a).slice(0, 160);
  if (v && list.length < 5 && !list.some((x) => x.toLowerCase() === v.toLowerCase())) list.push(v);
};

/** Un número escrito en una celda: "75", "75%", "1,234". null si no es un número. */
function cellNumber(v: string): number | null {
  const s = v.replace(/[%\s]/g, "").replace(/,(?=\d{3}\b)/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const emptyDomain = (domain: string): LinkDomain => ({
  domain,
  spamScore: null,
  toolScore: null,
  rank: null,
  backlinks: null,
  firstSeen: null,
  dofollow: null,
  anchors: [],
  url: null,
  externalLinks: null,
  footer: false,
  language: null,
});

// ---------- Leer listas importadas (Semrush, Ahrefs, Search Console, archivo disavow o texto) ----------

/** Separa una línea de CSV/TSV respetando comillas ("a, b" queda junto; "" es una comilla). */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"' && cur.trim() === "") {
      quoted = true;
      cur = "";
    } else if (c === sep) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** Junta líneas partidas por saltos dentro de comillas (títulos de páginas con saltos de línea). */
function csvRecords(text: string): string[] {
  const lines = text.split(/\r\n|\n|\r/);
  const out: string[] = [];
  let buf = "";
  for (const line of lines) {
    buf = buf ? `${buf}\n${line}` : line;
    const quotes = (buf.match(/"/g) ?? []).length;
    if (quotes % 2 === 0) {
      out.push(buf);
      buf = "";
    }
  }
  if (buf) out.push(buf);
  return out;
}

const HEAD = (s: string) => fold(s).replace(/[^a-z0-9]+/g, " ").trim();
type ColRole = "domain" | "url" | "anchor" | "toxic" | "spam" | "authority" | "firstSeen" | "nofollow" | "external";
const COLS: [ColRole, RegExp][] = [
  ["toxic", /^(toxicity score|toxic score|toxicity|ts|puntuacion de toxicidad|toxicidad)$/],
  ["spam", /^(spam score|spam|nivel de spam)$/],
  ["authority", /^(domain rating|dr|authority score|as|domain authority|da|page authority|rank|domain rank|ur|url rating)$/],
  ["anchor", /^(anchor|anchor text|anchors|texto ancla|texto del enlace|ancla)$/],
  ["firstSeen", /^(first seen|first found|first indexed|first crawled|primera vez|date|fecha|last crawled|ultimo rastreo|discovered)$/],
  ["nofollow", /^(nofollow|no follow|link type|tipo de enlace|rel|dofollow)$/],
  ["external", /^(external links|outgoing links|external links count|enlaces externos|linked domains)$/],
  ["url", /^(source url|source page|referring page url|referring page|referring url|linking page|linking pages url|url from|from url|page url|backlink|backlink url|source|url|link|enlace|pagina de origen|url de origen|pagina que enlaza)$/],
  ["domain", /^(domain|domains|root domain|referring domain|referring domains|source domain|linking site|linking sites|site|sitio|dominio|dominio de referencia|dominios|top linking sites|referring site)$/],
];

function roleOf(header: string): ColRole | null {
  const h = HEAD(header);
  for (const [role, re] of COLS) if (re.test(h)) return role;
  return null;
}

/** El dominio de una celda: «https://www.x.com/p», «x.com», «domain:x.com», «*.x.com». null si no es uno. */
export function domainOf(cell: string): string | null {
  const v = cell
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^domain:/i, "")
    .replace(/^\*\./, "");
  if (!v || /\s/.test(v) || !/[a-z0-9]\.[a-z]/i.test(v)) return null;
  return normalizeDomain(v);
}

export type ImportedList = {
  format: ImportFormat;
  items: LinkDomain[];
  /** Líneas con algo escrito que no tenían un dominio. */
  skipped: number;
  /** Se cortó en IMPORT_MAX dominios. */
  truncated: boolean;
};

/**
 * Lee la lista que el dueño ya tiene: CSV/TSV de Semrush (Backlink Audit: Source url, Anchor, Toxicity Score…),
 * Ahrefs (Referring page URL, Domain rating, Anchor…), Search Console (Top linking sites / Latest links), un archivo
 * de desautorización (domain:x.com) o simplemente una lista de dominios o direcciones (uno por línea o separados
 * por comas). Junta los repetidos por dominio (mantiene subdominios: spam.blogspot.com nunca es blogspot.com).
 */
export function parseLinkList(input: string): ImportedList {
  const text = String(input ?? "")
    .replace(/^﻿/, "")
    .slice(0, IMPORT_MAX_CHARS);
  const records = csvRecords(text).filter((l) => l.trim() && !/^\s*#/.test(l) && !/^\s*sep=.$/i.test(l));
  const byDomain = new Map<string, LinkDomain>();
  let skipped = 0;
  let truncated = false;
  const add = (domain: string | null, extra: Partial<Omit<LinkDomain, "anchors">> & { anchor?: string } = {}): boolean => {
    if (!domain) return false;
    let cur = byDomain.get(domain);
    if (!cur) {
      if (byDomain.size >= IMPORT_MAX) {
        truncated = true;
        return true;
      }
      cur = emptyDomain(domain);
      byDomain.set(domain, cur);
    }
    cur.backlinks = (cur.backlinks ?? 0) + 1;
    if (extra.anchor) pushAnchor(cur.anchors, extra.anchor);
    if (extra.url && !cur.url) cur.url = extra.url;
    if (extra.toolScore != null) cur.toolScore = Math.max(cur.toolScore ?? 0, extra.toolScore);
    if (extra.spamScore != null) cur.spamScore = Math.max(cur.spamScore ?? 0, extra.spamScore);
    if (extra.rank != null) cur.rank = Math.max(cur.rank ?? 0, extra.rank);
    if (extra.externalLinks != null) cur.externalLinks = Math.max(cur.externalLinks ?? 0, extra.externalLinks);
    if (extra.firstSeen && (!cur.firstSeen || extra.firstSeen < cur.firstSeen)) cur.firstSeen = extra.firstSeen;
    if (extra.dofollow === true) cur.dofollow = true;
    else if (extra.dofollow === false && cur.dofollow === null) cur.dofollow = false;
    return true;
  };

  const first = records[0] ?? "";
  const counts = { "\t": (first.match(/\t/g) ?? []).length, ",": (first.match(/,/g) ?? []).length, ";": (first.match(/;/g) ?? []).length };
  const [bestSep, bestCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const sep = bestCount > 0 ? bestSep : "";
  const headerCells = sep ? splitCsvLine(first, sep) : [first.trim()];
  const roles = headerCells.map(roleOf);
  const hasHeader = roles.some((r) => r === "domain" || r === "url") && !headerCells.some((c) => domainOf(c));

  const isDisavow = records.some((l) => /^\s*domain:/i.test(l));
  let format: ImportFormat = isDisavow ? "disavow" : sep ? "csv" : "plain";
  if (hasHeader) {
    const h = headerCells.map(HEAD);
    if (roles.includes("toxic") || h.includes("toxic markers") || (h.includes("source url") && h.includes("source title"))) format = "semrush";
    else if (h.some((x) => x === "referring page url" || x === "domain rating" || x === "dr" || x === "url rating")) format = "ahrefs";
    else if (h.some((x) => x === "linking page" || x === "linking pages" || x === "last crawled" || x === "top linking sites" || x === "target pages")) format = "gsc";
    else format = "csv";
  }

  if (hasHeader && sep) {
    const col = (role: ColRole) => roles.indexOf(role);
    const iDomain = col("domain");
    const iUrl = col("url");
    const iAnchor = col("anchor");
    const iToxic = col("toxic");
    const iSpam = col("spam");
    const iAuth = col("authority");
    const iSeen = col("firstSeen");
    const iNofollow = col("nofollow");
    // Columna «Nofollow» (Ahrefs, Semrush): TRUE quiere decir que NO pasa fuerza. «Link type»/«Rel»: el texto lo dice.
    const nofollowCol = iNofollow >= 0 && /^no ?follow$/.test(HEAD(headerCells[iNofollow] ?? ""));
    const iExternal = col("external");
    for (const rec of records.slice(1)) {
      const cells = splitCsvLine(rec, sep);
      if (cells.every((c) => !c)) continue;
      const url = iUrl >= 0 ? (cells[iUrl] ?? "") : "";
      const domain = (iDomain >= 0 ? domainOf(cells[iDomain] ?? "") : null) ?? domainOf(url) ?? cells.map(domainOf).find(Boolean) ?? null;
      const auth = iAuth >= 0 ? cellNumber(cells[iAuth] ?? "") : null;
      const rel = iNofollow >= 0 ? fold(cells[iNofollow] ?? "") : "";
      const ok = add(domain, {
        url: /^https?:\/\//i.test(url) ? url.slice(0, 500) : null,
        anchor: iAnchor >= 0 ? (cells[iAnchor] ?? "") : "",
        toolScore: iToxic >= 0 ? cellNumber(cells[iToxic] ?? "") : null,
        spamScore: iSpam >= 0 ? cellNumber(cells[iSpam] ?? "") : null,
        // Domain Rating / Authority Score (0–100) ≈ rank de DataForSEO (0–1000).
        rank: auth !== null && auth >= 0 && auth <= 100 ? Math.round(auth * 10) : null,
        externalLinks: iExternal >= 0 ? cellNumber(cells[iExternal] ?? "") : null,
        firstSeen: iSeen >= 0 ? dfsDate(cells[iSeen] ?? "") : null,
        dofollow: !rel
          ? undefined
          : nofollowCol
            ? /^(true|yes|si|1)$/.test(rel)
              ? false
              : /^(false|no|0)$/.test(rel)
                ? true
                : undefined
            : /nofollow|no follow|ugc|sponsored|false|^no$/.test(rel)
              ? false
              : /dofollow|follow|true|^si$|^yes$/.test(rel)
                ? true
                : undefined,
      });
      if (!ok) skipped++;
    }
  } else {
    for (const rec of records) {
      const tokens = rec.split(/[\s,;\t|]+/).filter(Boolean);
      let any = false;
      for (const tok of tokens) any = add(domainOf(tok), { url: /^https?:\/\//i.test(tok) ? tok.slice(0, 500) : null }) || any;
      if (!any) skipped++;
    }
  }
  return { format, items: [...byDomain.values()], skipped, truncated };
}

// ---------- Leer respuestas de DataForSEO ----------

function dofollowOf(it: Record<string, unknown>): boolean | null {
  const backlinks = num(it.backlinks);
  if (backlinks === null || backlinks <= 0) return null;
  const attrs = it.referring_links_attributes;
  const nofollow = attrs === null || attrs === undefined ? 0 : (num(obj(attrs).nofollow) ?? 0);
  return nofollow < backlinks;
}

/**
 * Junta backlinks/referring_domains/live (un sitio por fila: spam, fuerza, pie de página…) con
 * backlinks/backlinks/live en modo one_per_domain (un enlace de ejemplo por sitio: texto, página, idioma, enlaces
 * externos de la página). Devuelve los sitios y el total que reporta DataForSEO.
 */
export function parseToxicFetch(referring: unknown[], backlinks: unknown[]): { total: number | null; items: LinkDomain[] } {
  const byDomain = new Map<string, LinkDomain>();
  const r = obj(referring[0]);
  for (const raw of arr(r.items)) {
    const it = obj(raw);
    const domain = normalizeDomain(str(it.domain));
    if (!domain || byDomain.has(domain)) continue;
    const loc = obj(it.referring_links_semantic_locations);
    const total = Object.values(loc).reduce<number>((a, v) => a + (num(v) ?? 0), 0);
    const footer = num(loc.footer) ?? 0;
    byDomain.set(domain, {
      ...emptyDomain(domain),
      spamScore: num(it.backlinks_spam_score),
      rank: num(it.rank),
      backlinks: num(it.backlinks),
      firstSeen: dfsDate(it.first_seen),
      dofollow: dofollowOf(it),
      footer: total > 0 && footer / total >= 0.5,
    });
  }
  for (const raw of arr(obj(backlinks[0]).items)) {
    const it = obj(raw);
    const domain = normalizeDomain(str(it.domain_from));
    if (!domain) continue;
    let cur = byDomain.get(domain);
    if (!cur) {
      cur = { ...emptyDomain(domain), rank: num(it.domain_from_rank), firstSeen: dfsDate(it.first_seen), backlinks: num(it.group_count) };
      byDomain.set(domain, cur);
    }
    pushAnchor(cur.anchors, str(it.anchor));
    cur.url ??= str(it.url_from) || null;
    cur.externalLinks ??= num(it.page_from_external_links);
    cur.language ??= str(it.page_from_language).toLowerCase().slice(0, 5) || null;
    if (str(it.semantic_location).toLowerCase() === "footer") cur.footer = true;
    if (cur.dofollow === null && typeof it.dofollow === "boolean") cur.dofollow = it.dofollow;
    cur.spamScore ??= num(it.backlink_spam_score);
  }
  return { total: num(r.total_count), items: [...byDomain.values()] };
}

/** El total_count de una respuesta de DataForSEO (los sitios nuevos del mes). */
export const totalCountOf = (result: unknown[]): number | null => num(obj(result[0]).total_count);

/** backlinks/bulk_spam_score/live: items[] {target, spam_score} → dominio → nivel de spam. */
export function parseBulkSpam(result: unknown[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const raw of arr(obj(result[0]).items)) {
    const it = obj(raw);
    const d = normalizeDomain(str(it.target));
    const s = num(it.spam_score);
    if (d && s !== null) out.set(d, s);
  }
  return out;
}

// ---------- Sitios que nunca se marcan (lista blanca) ----------

export type ToxicCtx = {
  /** Página web del negocio. */
  site: string;
  /** Otros sitios del negocio y de socios (los escribe el dueño). */
  ownSites: string[];
  /** Nombre del negocio (para reconocer los textos de marca). */
  name?: string;
  /** Vocabulario de lo que vende (businessTopicVocab): para los textos «de venta». */
  vocab: string[];
  /** Idioma del negocio ("es" | "en"). */
  language?: string;
};

/** Dominios de todos los directorios de la app (src/lib/directories.ts), en todas las regiones. */
const DIRECTORY_DOMAINS: string[] = (() => {
  const out = new Set<string>();
  const regions: Region[] = ["us", "ca", "other"];
  const kinds: BizKind[] = ["adjuster", "home", "general"];
  for (const region of regions)
    for (const kind of kinds)
      for (const florida of [false, true])
        for (const d of directoriesFor({ region, kind, florida, name: "x" })) {
          const n = normalizeDomain(d.domain);
          if (n) out.add(n);
        }
  return [...out];
})();

/** Grandes plataformas y servicios conocidos: nunca son un ataque (aunque DataForSEO les ponga spam). */
const BIG_PLATFORMS = [
  "google.com", "youtube.com", "facebook.com", "instagram.com", "whatsapp.com", "linkedin.com", "twitter.com", "x.com", "t.co", "tiktok.com",
  "pinterest.com", "reddit.com", "quora.com", "wikipedia.org", "wikimedia.org", "wikidata.org", "amazon.com", "apple.com", "microsoft.com",
  "bing.com", "yahoo.com", "duckduckgo.com", "github.com", "gitlab.com", "medium.com", "wordpress.org", "wordpress.com", "blogger.com",
  "blogspot.com", "tumblr.com", "wix.com", "squarespace.com", "shopify.com", "godaddy.com", "cloudflare.com", "gravatar.com", "archive.org",
  "trustpilot.com", "tripadvisor.com", "yelp.com", "bbb.org", "waze.com", "mapquest.com", "foursquare.com", "vimeo.com", "flickr.com",
  "issuu.com", "slideshare.net", "scribd.com", "about.me", "linktr.ee", "canva.com", "behance.net", "dribbble.com", "mercadolibre.com",
  "nextdoor.com", "threads.net", "telegram.org", "t.me", "wa.me", "goo.gl", "bit.ly", "msn.com", "outlook.com", "live.com", "office.com",
  "zoom.us", "dropbox.com", "adobe.com", "mozilla.org", "w3.org", "europa.eu", "un.org", "who.int",
];

/** Servicios de blogs gratis: el sitio principal es seguro, pero un subdominio (spam.blogspot.com) es de cualquiera. */
const BLOG_HOSTS = ["blogspot.com", "wordpress.com", "tumblr.com", "wixsite.com", "weebly.com", "medium.com", "over-blog.com", "webnode.com", "jimdofree.com", "site123.me", "substack.com", "github.io", "netlify.app", "vercel.app", "000webhostapp.com", "blogger.com"];

export type SafeReason = "own" | "partner" | "platform" | "directory" | "social" | "news" | "public";

/** ¿Este sitio nunca debe marcarse como dañino? Devuelve por qué, o null. */
export function safeReason(domain: string, ctx: Pick<ToxicCtx, "site" | "ownSites">): SafeReason | null {
  const d = normalizeDomain(domain);
  if (!d) return null;
  const self = normalizeDomain(ctx.site);
  if (self && sameSite(d, self)) return "own";
  if (ctx.ownSites.some((o) => {
    const n = normalizeDomain(o);
    return !!n && sameSite(d, n);
  }))
    return "partner";
  const host = BLOG_HOSTS.find((h) => d.endsWith(`.${h}`));
  if (host) return null; // un blog gratis de alguien: se revisa como cualquier otro sitio
  if (BIG_PLATFORMS.some((p) => d === p || d.endsWith(`.${p}`))) return "platform";
  if (DIRECTORY_DOMAINS.some((p) => d === p || d.endsWith(`.${p}`))) return "directory";
  // Lo que se deduce por el nombre no vale si el sitio tiene pinta de spam («casino-news.xyz» no es un periódico).
  const labels = d.split(".");
  if (harmfulWord(d, true) || SPAMMY_TLDS.has(labels.at(-1) ?? "") || LINK_FARM_RE.test(d)) return null;
  const hint = linkHint(d);
  if (hint === "public") return "public";
  if (hint === "social") return "social";
  if (isDirectory(d)) {
    if (labels.slice(1).some((l) => ["gov", "gob", "gub", "gouv", "govt", "mil", "edu"].includes(l))) return "public";
    return hint === "news" ? "news" : "directory";
  }
  return null;
}

const SAFE_TEXT: Record<SafeReason, Bi> = {
  own: bi("Es tu propia página web: nunca se desautoriza.", "It's your own website: never disavow it."),
  partner: bi("Es uno de tus sitios o de un socio (lo marcaste tú).", "It's one of your sites or a partner's (you marked it)."),
  platform: bi("Es una plataforma grande y conocida: Google sabe que no es un ataque.", "It's a big, well-known platform: Google knows it isn't an attack."),
  directory: bi("Es un directorio o sitio de reseñas: estos enlaces son normales y buenos.", "It's a directory or review site: these links are normal and good."),
  social: bi("Es una red social: estos enlaces son normales.", "It's a social network: these links are normal."),
  news: bi("Es un sitio de noticias: un enlace así es bueno.", "It's a news site: a link like this is good."),
  public: bi("Es de gobierno o de una universidad: un enlace así es muy bueno.", "It's a government or university site: a link like this is very good."),
};

// ---------- Señales de riesgo ----------

/** Temas que no tienen que ver con un negocio local y que usan los ataques de spam. Palabras largas: dentro del nombre. */
const HARMFUL_LONG = ["casino", "viagra", "cialis", "levitra", "porn", "xxx", "hentai", "poker", "escort", "bitcoin", "crypto", "forex", "payday", "gambling", "betting", "apuestas", "onlyfans", "camgirl", "pharmacy", "farmaciaonline", "tramadol", "xanax", "kratom", "steroid", "essaywriting", "slotgacor", "togel", "bokep", "sportsbook"];
/** Palabras cortas: solo como palabra sola (para no confundir sussex o alphabet). */
const HARMFUL_SHORT = new Set(["sex", "sexy", "bet", "bets", "slot", "slots", "loan", "loans", "pills", "pill", "dating", "nude", "nudes", "porno", "milf", "cbd", "vape", "pharma", "meds", "prestamos", "jackpot", "lottery", "loteria", "gacor", "judi", "replica", "replicas"]);
/** Terminaciones baratas que usan mucho los sitios de spam. */
const SPAMMY_TLDS = new Set(["xyz", "top", "icu", "buzz", "click", "loan", "work", "gq", "tk", "ml", "cf", "ga", "pw", "su", "cyou", "sbs", "cfd", "monster", "rest", "bond", "quest", "fun", "best", "shop", "store", "live", "life", "website", "space", "site", "online", "win", "bid", "trade", "date", "party", "review", "stream", "download", "racing", "men", "kim", "country", "science", "accountant", "cricket", "faith", "zip", "mov", "lol", "uno", "today"]);
/** Terminaciones de países lejanos (para un negocio en español o inglés). */
const FAR_TLDS: Record<string, Bi> = {
  ru: bi("Rusia", "Russia"), su: bi("Rusia", "Russia"), by: bi("Bielorrusia", "Belarus"), kz: bi("Kazajistán", "Kazakhstan"), ua: bi("Ucrania", "Ukraine"),
  cn: bi("China", "China"), ir: bi("Irán", "Iran"), vn: bi("Vietnam", "Vietnam"), th: bi("Tailandia", "Thailand"), id: bi("Indonesia", "Indonesia"),
  pk: bi("Pakistán", "Pakistan"), bd: bi("Bangladés", "Bangladesh"), kr: bi("Corea", "Korea"), jp: bi("Japón", "Japan"), tr: bi("Turquía", "Turkey"),
};
const LANG_NAME: Record<string, Bi> = {
  ru: bi("ruso", "Russian"), zh: bi("chino", "Chinese"), ja: bi("japonés", "Japanese"), ko: bi("coreano", "Korean"), vi: bi("vietnamita", "Vietnamese"),
  id: bi("indonesio", "Indonesian"), th: bi("tailandés", "Thai"), ar: bi("árabe", "Arabic"), fa: bi("persa", "Persian"), tr: bi("turco", "Turkish"),
  pl: bi("polaco", "Polish"), uk: bi("ucraniano", "Ukrainian"), hi: bi("hindi", "Hindi"), de: bi("alemán", "German"), fr: bi("francés", "French"),
  it: bi("italiano", "Italian"), pt: bi("portugués", "Portuguese"), nl: bi("neerlandés", "Dutch"), cs: bi("checo", "Czech"), ro: bi("rumano", "Romanian"),
  bn: bi("bengalí", "Bengali"), ms: bi("malayo", "Malay"), he: bi("hebreo", "Hebrew"), el: bi("griego", "Greek"), hu: bi("húngaro", "Hungarian"),
};
/** Sitios que solo ponen enlaces (directorios de enlaces, «sube tu web», granjas). */
const LINK_FARM_RE = /link-?farm|backlinks?|seo-?links?|freelinks|addurl|add-?url|submit(url|site)|webdir|linkdir|link-?direct|dir-?submit|top-?sites|bookmark|article-?directory|guest-?post|pbn/;
/** Sitios automáticos de estadísticas de páginas (precio, tráfico, whois): Google ya los ignora. */
const STATS_RE = /hypestat|siteprice|statshow|websiteoutlook|sitelike|similarsites|siteworth|worthofweb|websitevalue|sitevaluecalculator|whois|domaintools|site-?info|websiteinfo|webstatsdomain|statscrop|siteoverview|ranksignal|websitelooker|bigdomaindata|domainstats|traffic-?estimate|isitdown|sur\.ly|site-?analyzer|seo-?analy[sz]|webrank|rankchecker|domainmarket|webinfodb|minify|seoprofiler/;
/** Textos de enlace que no dicen nada (no cuentan como «de venta»). */
const GENERIC_ANCHORS = /^(click here|here|aqui|aca|clic aqui|haz clic aqui|website|web|sitio web|pagina web|visit|visitar|ver mas|more|read more|leer mas|link|enlace|home|inicio|source|fuente|this|este|url|\[no anchor\]|no anchor|empty|image|imagen|logo)$/;

const domainWords = (d: string) => fold(d).split(/[.\-_0-9]+/).filter(Boolean);
const anchorWords = (a: string) => fold(a).split(/[^a-z0-9]+/).filter(Boolean);

/** ¿El nombre del sitio o el texto tiene un tema dañino? Devuelve la palabra encontrada. */
export function harmfulWord(text: string, isDomain = false): string | null {
  const f = fold(text);
  const compact = f.replace(/[^a-z0-9]/g, "");
  const long = HARMFUL_LONG.find((w) => compact.includes(w.replace(/[^a-z0-9]/g, "")));
  if (long) return long;
  const words = isDomain ? domainWords(text) : anchorWords(text);
  return words.find((w) => HARMFUL_SHORT.has(w)) ?? null;
}

/** ¿El texto del enlace es «de venta» (palabras de lo que vende, sin la marca)? */
export function isCommercialAnchor(anchor: string, ctx: Pick<ToxicCtx, "site" | "name" | "vocab">): boolean {
  const a = fold(clean(anchor));
  if (!a || a.length > 120 || GENERIC_ANCHORS.test(a) || /^https?:|^www\.|\.[a-z]{2,6}(\/|$)/.test(a)) return false;
  const words = anchorWords(a);
  if (words.length < 2) return false;
  const self = normalizeDomain(ctx.site);
  const brand = self ? brandToken(self) : "";
  const compact = a.replace(/[^a-z0-9]/g, "");
  if (brand.length >= 4 && compact.includes(brand)) return false;
  const name = fold(ctx.name ?? "").replace(/[^a-z0-9]/g, "");
  if (name.length >= 4 && compact.includes(name)) return false;
  if (!ctx.vocab.length) return false;
  return isRelevantKeyword(a, ctx.vocab);
}

/** Texto relleno de palabras clave: muy largo o con la misma palabra repetida. */
function isStuffedAnchor(anchor: string): boolean {
  const words = anchorWords(anchor).filter((w) => w.length > 2);
  if (words.length >= 10) return true;
  const seen = new Map<string, number>();
  for (const w of words) seen.set(w, (seen.get(w) ?? 0) + 1);
  return [...seen.values()].some((n) => n >= 3);
}

export type Reason = { id: string; tone: "bad" | "good" | "info"; text: Bi };

export type Classified = LinkDomain & {
  level: RiskLevel;
  points: number;
  reasons: Reason[];
  /** Por qué es seguro siempre (no se puede desautorizar desde la app). */
  safe: SafeReason | null;
  /** De dónde salió: DataForSEO, la lista importada o los dos. */
  sources: ("dataforseo" | "import")[];
  /** Llegó en los últimos 30 días (o no estaba en la revisión anterior). */
  isNew: boolean;
};

export type ClassifyOpts = {
  /** Muchos sitios usan el mismo texto de venta (señal de enlaces comprados o de un ataque). */
  bulkCommercial?: boolean;
};

/** El riesgo de un sitio, con razones en palabras simples. */
export function classifyDomain(item: LinkDomain, ctx: ToxicCtx, opts: ClassifyOpts = {}): Omit<Classified, "sources" | "isNew"> {
  const safe = safeReason(item.domain, ctx);
  if (safe) return { ...item, level: "seguro", points: 0, reasons: [{ id: `safe:${safe}`, tone: "good", text: SAFE_TEXT[safe] }], safe };

  const reasons: Reason[] = [];
  let points = 0;
  const bad = (id: string, p: number, text: Bi) => {
    points += p;
    reasons.push({ id, tone: "bad", text });
  };
  const good = (id: string, p: number, text: Bi) => {
    points -= p;
    reasons.push({ id, tone: "good", text });
  };
  const d = item.domain;
  const labels = d.split(".");
  const tld = labels.at(-1) ?? "";
  const brand = brandToken(d);
  const stats = STATS_RE.test(d);

  // Nivel de spam (DataForSEO).
  const spam = item.spamScore;
  if (spam !== null) {
    if (spam >= 80) bad("spam-high", 4, bi(`Nivel de spam muy alto: ${spam} de 100.`, `Very high spam level: ${spam} out of 100.`));
    else if (spam >= SPAM_CUTOFF) bad("spam-high", 3, bi(`Nivel de spam alto: ${spam} de 100.`, `High spam level: ${spam} out of 100.`));
    else if (spam >= 30) bad("spam-mid", 1, bi(`Nivel de spam medio: ${spam} de 100.`, `Medium spam level: ${spam} out of 100.`));
  }

  // Tema dañino.
  const wordInName = harmfulWord(d, true);
  const wordInAnchor = wordInName ? null : item.anchors.map((a) => harmfulWord(a)).find(Boolean);
  if (wordInName)
    bad("topic", 5, bi(`Sitio de un tema que no tiene nada que ver contigo (“${wordInName}”: casino, adultos, farmacia, cripto, préstamos…).`, `A site about something unrelated to you (“${wordInName}”: casino, adult, pharmacy, crypto, loans…).`));
  else if (wordInAnchor)
    bad("topic-anchor", 3, bi(`El texto del enlace habla de un tema dañino (“${wordInAnchor}”).`, `The link text is about a harmful topic (“${wordInAnchor}”).`));

  // Granjas de enlaces.
  if (item.externalLinks !== null && item.externalLinks >= 100)
    bad("farm", 2, bi(`La página que te enlaza tiene ${item.externalLinks} enlaces a otros sitios: parece una granja de enlaces.`, `The page linking to you has ${item.externalLinks} links to other sites: it looks like a link farm.`));
  else if (item.externalLinks !== null && item.externalLinks >= 50)
    bad("farm", 1, bi(`La página que te enlaza tiene muchos enlaces a otros sitios (${item.externalLinks}).`, `The page linking to you has lots of links to other sites (${item.externalLinks}).`));
  if (!stats && LINK_FARM_RE.test(d)) bad("farm-name", 2, bi("Es un sitio hecho solo para poner enlaces (directorio de enlaces o «sube tu web»).", "It's a site made only to post links (a link directory or “submit your site”)."));

  // Nombre y terminación.
  if (SPAMMY_TLDS.has(tld)) bad("tld", 1, bi(`Termina en .${tld}, una terminación barata que usan mucho los sitios de spam.`, `It ends in .${tld}, a cheap ending often used by spam sites.`));
  const namepart = labels.slice(0, -1).join(".");
  if ((namepart.match(/-/g) ?? []).length >= 3 || /\d{4,}/.test(namepart) || brand.length > 25)
    bad("name", 1, bi("El nombre es raro (muchos guiones, números o muy largo), típico de sitios hechos para poner enlaces.", "The name is odd (many hyphens, numbers or very long), typical of sites built to post links."));

  // Idioma o país.
  const lang = (item.language ?? "").slice(0, 2);
  const ownLang = (ctx.language ?? "es").slice(0, 2);
  if (lang && lang !== ownLang && lang !== "en" && lang !== "es") {
    const name = LANG_NAME[lang] ?? bi(lang, lang);
    bad("language", 1, bi(`La página está en ${name.es}, un idioma que no tiene que ver con tu negocio.`, `The page is in ${name.en}, a language unrelated to your business.`));
  } else if (!lang && FAR_TLDS[tld]) {
    bad("country", 1, bi(`Es un sitio de ${FAR_TLDS[tld].es}, un país que no tiene que ver con tu negocio.`, `It's a site from ${FAR_TLDS[tld].en}, a country unrelated to your business.`));
  }

  // Pie de página en todo el sitio.
  if (item.footer || (item.backlinks !== null && item.backlinks >= 200))
    bad("sitewide", 1, bi("El enlace está en el pie de página de todo el sitio (cientos de enlaces iguales).", "The link sits in the footer of the whole site (hundreds of identical links)."));

  // Textos de enlace.
  const commercial = item.anchors.find((a) => isCommercialAnchor(a, ctx));
  if (commercial) {
    bad("anchor", 1, bi(`El texto del enlace son palabras de venta exactas («${commercial}»), algo que la gente rara vez escribe sola.`, `The link text is exact sales keywords (“${commercial}”), something people rarely write on their own.`));
    if (opts.bulkCommercial) bad("anchor-bulk", 1, bi("Muchos otros sitios usan ese mismo tipo de texto: parece hecho a propósito.", "Many other sites use the same kind of text: it looks deliberate."));
  } else if (item.anchors.some(isStuffedAnchor)) bad("anchor-stuffed", 1, bi("El texto del enlace está relleno de palabras repetidas.", "The link text is stuffed with repeated words."));

  // Otra herramienta (Semrush marca de más: solo suma un poco).
  const tool = item.toolScore;
  if (tool !== null && tool >= 60) bad("tool", 2, bi(`Tu herramienta (Semrush u otra) lo marcó como tóxico: ${tool} de 100.`, `Your tool (Semrush or other) marked it as toxic: ${tool} out of 100.`));
  else if (tool !== null && tool >= 45) bad("tool", 1, bi(`Tu herramienta lo marcó como «posiblemente tóxico»: ${tool} de 100.`, `Your tool marked it as “potentially toxic”: ${tool} out of 100.`));

  // A favor.
  if (item.rank !== null && item.rank >= 300) good("strong", 2, bi("Es un sitio con fuerza y buena reputación.", "It's a strong site with a good reputation."));
  if (item.dofollow === false) good("nofollow", 1, bi("El enlace es «nofollow»: no pasa fuerza y Google casi no lo cuenta.", "The link is “nofollow”: it passes no strength and Google barely counts it."));

  // Sitios de estadísticas automáticas: inofensivos.
  if (stats && !wordInName) {
    points = Math.min(points, 2);
    reasons.push({ id: "stats", tone: "info", text: bi("Es un sitio automático de estadísticas de páginas: Google ya lo ignora, no hace falta desautorizarlo.", "It's an automatic website-stats site: Google already ignores it, no need to disavow it.") });
  }

  const known = spam !== null || tool !== null || item.rank !== null;
  let level: RiskLevel = points >= 5 ? "alto" : points >= 3 ? "medio" : points >= 1 ? "bajo" : "seguro";
  if (level === "seguro" && !known) {
    level = "bajo";
    reasons.push({ id: "no-data", tone: "info", text: bi("No vimos nada raro, pero no tenemos su nivel de spam.", "We saw nothing odd, but we don't have its spam level.") });
  } else if (level === "seguro" && !reasons.length) {
    reasons.push({ id: "clean", tone: "good", text: bi("Sin señales de riesgo.", "No risk signs.") });
  }
  return { ...item, level, points, reasons, safe: null };
}

/** ¿Hay demasiados sitios con texto de venta exacto? (≥10 sitios y ≥30 % de los que tienen texto). */
export function bulkCommercialAnchors(items: LinkDomain[], ctx: ToxicCtx): { count: number; share: number; flagged: boolean } {
  const withAnchor = items.filter((i) => i.anchors.length && !safeReason(i.domain, ctx));
  const count = withAnchor.filter((i) => i.anchors.some((a) => isCommercialAnchor(a, ctx))).length;
  const share = withAnchor.length ? count / withAnchor.length : 0;
  return { count, share, flagged: count >= 10 && share >= 0.3 };
}

const ORDER: Record<RiskLevel, number> = { alto: 0, medio: 1, bajo: 2, seguro: 3 };

/** ¿Llegó hace poco? Fecha de DataForSEO en los últimos 30 días, o no estaba en la revisión anterior. */
export function isNewDomain(item: LinkDomain, now: Date, previous: Set<string> | null): boolean {
  if (item.firstSeen) {
    const t = new Date(item.firstSeen).getTime();
    if (Number.isFinite(t)) return now.getTime() - t <= NEW_DAYS * 86400_000;
  }
  return previous ? !previous.has(item.domain) : false;
}

/** Junta dos listas por dominio (DataForSEO manda; la lista importada agrega su puntaje y textos). */
export function mergeLinkLists(primary: LinkDomain[], secondary: LinkDomain[]): { items: LinkDomain[]; sources: Map<string, ("dataforseo" | "import")[]> } {
  const map = new Map<string, LinkDomain>();
  const sources = new Map<string, ("dataforseo" | "import")[]>();
  for (const p of primary) {
    map.set(p.domain, { ...p, anchors: [...p.anchors] });
    sources.set(p.domain, ["dataforseo"]);
  }
  for (const s of secondary) {
    const cur = map.get(s.domain);
    if (!cur) {
      map.set(s.domain, { ...s, anchors: [...s.anchors] });
      sources.set(s.domain, ["import"]);
      continue;
    }
    sources.set(s.domain, ["dataforseo", "import"]);
    cur.toolScore ??= s.toolScore;
    cur.spamScore ??= s.spamScore;
    cur.rank ??= s.rank;
    cur.url ??= s.url;
    cur.firstSeen ??= s.firstSeen;
    for (const a of s.anchors) pushAnchor(cur.anchors, a);
  }
  return { items: [...map.values()], sources };
}

/** Clasifica todos los sitios: de más riesgo a menos (y dentro, por spam). */
export function classifyAll(
  items: LinkDomain[],
  ctx: ToxicCtx,
  opts: { now?: Date; previous?: string[] | null; sources?: Map<string, ("dataforseo" | "import")[]> } = {},
): Classified[] {
  const now = opts.now ?? new Date();
  const prev = opts.previous ? new Set(opts.previous) : null;
  const bulk = bulkCommercialAnchors(items, ctx).flagged;
  return items
    .map((it) => {
      const sources = opts.sources?.get(it.domain) ?? ["dataforseo" as const];
      // Los que solo vienen de la lista importada no se comparan con la revisión anterior (no estaban porque no se leyeron).
      return { ...classifyDomain(it, ctx, { bulkCommercial: bulk }), sources, isNew: isNewDomain(it, now, sources.includes("dataforseo") ? prev : null) };
    })
    .sort((a, b) => ORDER[a.level] - ORDER[b.level] || b.points - a.points || (b.spamScore ?? -1) - (a.spamScore ?? -1) || a.domain.localeCompare(b.domain));
}

export function countLevels(rows: Pick<Classified, "level">[]): Record<RiskLevel, number> {
  const out: Record<RiskLevel, number> = { alto: 0, medio: 0, bajo: 0, seguro: 0 };
  for (const r of rows) out[r.level]++;
  return out;
}

// ---------- ¿Un ataque? (muchos sitios dañinos nuevos de golpe) ----------

export type Spike = { level: SpikeLevel; newDomains: number; newRisky: number; baseline: number | null };

export const SPIKE_WATCH = 8;
export const SPIKE_ATTACK = 25;

/**
 * Compara los sitios nuevos de riesgo (alto o medio) de este mes con lo normal del negocio (sitios nuevos por mes en
 * los meses anteriores, de la revisión de enlaces). Ataque: ≥25 nuevos de riesgo y al menos el triple de lo normal.
 * Vigilar: ≥8 nuevos de riesgo, o el doble de sitios nuevos de lo normal (+10).
 */
export function detectSpike(input: { rows: Pick<Classified, "level" | "isNew">[]; baselineMonthly?: number | null; newThisMonth?: number | null }): Spike {
  const fresh = input.rows.filter((r) => r.isNew);
  const newRisky = fresh.filter((r) => r.level === "alto" || r.level === "medio").length;
  const newDomains = Math.max(input.newThisMonth ?? 0, fresh.length);
  const baseline = input.baselineMonthly ?? null;
  let level: SpikeLevel = "calm";
  if (newRisky >= SPIKE_ATTACK && (baseline === null || newRisky >= 3 * Math.max(baseline, 5))) level = "attack";
  else if (newRisky >= SPIKE_WATCH || (baseline !== null && newDomains >= 2 * baseline + 10)) level = "watch";
  return { level, newDomains, newRisky, baseline };
}

/** Sitios nuevos por mes en los meses anteriores (sin el último): de la revisión de enlaces (backlinks). */
export function baselineFromBacklinks(summary: { newDomains1m: number | null; newDomains3m: number | null } | null | undefined): number | null {
  if (!summary || summary.newDomains3m === null || summary.newDomains1m === null) return null;
  return Math.max(0, Math.round((summary.newDomains3m - summary.newDomains1m) / 2));
}

// ---------- El archivo para Google ----------

/** Los dominios que de verdad se pueden poner en el archivo: válidos, sin repetir, sin tu sitio ni sitios seguros. */
export function disavowable(domains: string[], ctx: Pick<ToxicCtx, "site" | "ownSites">): { domains: string[]; excluded: string[] } {
  const out = new Set<string>();
  const excluded: string[] = [];
  for (const raw of domains) {
    const d = domainOf(raw);
    if (!d) continue;
    if (safeReason(d, ctx)) {
      if (!excluded.includes(d)) excluded.push(d);
      continue;
    }
    out.add(d);
  }
  return { domains: [...out].sort(), excluded };
}

export function disavowFileName(site: string, date: Date): string {
  const d = normalizeDomain(site) ?? "sitio";
  return `disavow-${d}-${date.toISOString().slice(0, 10)}.txt`;
}

/**
 * El archivo en el formato de Google (texto UTF-8, una línea por dominio «domain:ejemplo.com», comentarios con #).
 * Sin dominios queda un archivo «vacío» (solo comentarios) para deshacer una desautorización anterior.
 */
export function buildDisavowFile(input: { site: string; domains: string[]; ownSites?: string[]; date: Date; reason: string; lang: "es" | "en" }): { text: string; domains: string[]; excluded: string[] } {
  const { domains, excluded } = disavowable(input.domains, { site: input.site, ownSites: input.ownSites ?? [] });
  const t = (es: string, en: string) => (input.lang === "en" ? en : es);
  const site = normalizeDomain(input.site) ?? input.site;
  const day = input.date.toISOString().slice(0, 10);
  const reason = clean(String(input.reason ?? "").replace(/[\r\n#]/g, " ")).slice(0, 300);
  const lines = [
    t(`# Archivo de desautorización de enlaces para ${site}`, `# Disavow links file for ${site}`),
    t(`# Fecha: ${day}`, `# Date: ${day}`),
    reason ? t(`# Motivo: ${reason}`, `# Reason: ${reason}`) : null,
    domains.length
      ? t(`# ${domains.length} ${domains.length === 1 ? "dominio" : "dominios"}. Este archivo reemplaza al anterior en Search Console.`, `# ${domains.length} ${domains.length === 1 ? "domain" : "domains"}. This file replaces the previous one in Search Console.`)
      : t("# Archivo vacío: quita cualquier desautorización anterior.", "# Empty file: removes any previous disavow."),
    ...domains.map((d) => `domain:${d}`),
  ].filter((l): l is string => l !== null);
  return { text: `${lines.join("\n")}\n`, domains, excluded };
}

/** Los dominios de un archivo de desautorización (domain:x.com y direcciones sueltas). */
export function readDisavowFile(text: string): string[] {
  return parseLinkList(text).items.map((i) => i.domain);
}

// ---------- Leer lo guardado (SeoReport kind "toxic") ----------

function readItem(raw: unknown): LinkDomain | null {
  const x = obj(raw);
  const domain = normalizeDomain(str(x.domain));
  if (!domain) return null;
  return {
    domain,
    spamScore: num(x.spamScore),
    toolScore: num(x.toolScore),
    rank: num(x.rank),
    backlinks: num(x.backlinks),
    firstSeen: str(x.firstSeen) || null,
    dofollow: typeof x.dofollow === "boolean" ? x.dofollow : null,
    anchors: arr(x.anchors).filter((a): a is string => typeof a === "string").slice(0, 5),
    url: str(x.url) || null,
    externalLinks: num(x.externalLinks),
    footer: x.footer === true,
    language: str(x.language) || null,
  };
}

const ANSWERS: Answer[] = ["yes", "no", "unsure"];
const OUTCOMES: Outcome[] = ["nothing", "watch", "prepare"];
const FORMATS: ImportFormat[] = ["semrush", "ahrefs", "gsc", "disavow", "csv", "plain"];

export function readToxicAudit(json: unknown): ToxicAudit | null {
  const r = obj(json);
  if (r.type !== "audit") return null;
  const domain = normalizeDomain(str(r.domain)) ?? "";
  const items = arr(r.items)
    .map(readItem)
    .filter((x): x is LinkDomain => !!x);
  return {
    version: 1,
    type: "audit",
    source: r.source === "import" ? "import" : "dataforseo",
    domain,
    createdAt: str(r.createdAt),
    total: num(r.total),
    newThisMonth: num(r.newThisMonth),
    items,
    cost: num(r.cost) ?? 0,
    notes: arr(r.notes)
      .map(obj)
      .filter((n) => typeof n.es === "string" && typeof n.en === "string")
      .map((n) => ({ es: n.es as string, en: n.en as string })),
    importName: str(r.importName) || undefined,
    importFormat: FORMATS.includes(r.importFormat as ImportFormat) ? (r.importFormat as ImportFormat) : undefined,
    skipped: num(r.skipped) ?? undefined,
    spamChecked: r.spamChecked === true,
  };
}

export function readDecision(json: unknown): DecisionRecord | null {
  const r = obj(json);
  if (r.type !== "decision" || !OUTCOMES.includes(r.outcome as Outcome)) return null;
  return {
    version: 1,
    type: "decision",
    createdAt: str(r.createdAt),
    manual: ANSWERS.includes(r.manual as Answer) ? (r.manual as Answer) : "unsure",
    drop: ANSWERS.includes(r.drop as Answer) ? (r.drop as Answer) : "unsure",
    outcome: r.outcome as Outcome,
  };
}

export function readDisavowRecord(json: unknown): DisavowRecord | null {
  const r = obj(json);
  if (r.type !== "disavow") return null;
  const domains = arr(r.domains).filter((d): d is string => typeof d === "string");
  return { version: 1, type: "disavow", createdAt: str(r.createdAt), domains, outcome: OUTCOMES.includes(r.outcome as Outcome) ? (r.outcome as Outcome) : null, empty: domains.length === 0 };
}

export function readSettings(json: unknown): SettingsRecord | null {
  const r = obj(json);
  if (r.type !== "settings") return null;
  return { version: 1, type: "settings", createdAt: str(r.createdAt), ownSites: arr(r.ownSites).filter((d): d is string => typeof d === "string" && !!normalizeDomain(d)).slice(0, 30) };
}

/** «a.com, b.org y c.net» escritos por el dueño → dominios válidos (máx. 30). */
export function parseOwnSites(text: string): string[] {
  const out: string[] = [];
  for (const tok of String(text ?? "").split(/[\s,;]+/)) {
    const d = domainOf(tok);
    if (d && !out.includes(d)) out.push(d);
    if (out.length >= 30) break;
  }
  return out;
}

// ---------- Aviso para el plan de acción ----------

export type Saved = { data: unknown; createdAt: Date | string };

export type ToxicAlert = { count: number; attack: boolean; domains: string[]; at: Date | string; source: "toxic" | "backlinks" };

/**
 * Enlaces nuevos de sitios dañinos desde la revisión anterior: compara las dos últimas revisiones de DataForSEO
 * (kind "toxic") y las dos últimas revisiones de enlaces (kind "backlinks": sitios nuevos con spam ≥ SPAM_CUTOFF).
 * null si no llegan al menos TOXIC_ALERT_MIN.
 */
export function toxicAlert(input: { toxic: Saved[]; backlinks: Saved[]; ctx: ToxicCtx }): ToxicAlert | null {
  const audits = input.toxic
    .map((s) => ({ s, a: readToxicAudit(s.data) }))
    .filter((x): x is { s: Saved; a: ToxicAudit } => !!x.a && x.a.source === "dataforseo")
    .sort((a, b) => new Date(b.s.createdAt).getTime() - new Date(a.s.createdAt).getTime());
  const fresh = new Set<string>();
  let at: Date | string | null = null;
  let source: ToxicAlert["source"] = "toxic";
  let attack = false;
  if (audits[0]) {
    const now = new Date(audits[0].s.createdAt);
    const previous = audits[1] ? audits[1].a.items.map((i) => i.domain) : null;
    const rows = classifyAll(audits[0].a.items, input.ctx, { now, previous });
    for (const r of rows) if (r.isNew && r.level === "alto") fresh.add(r.domain);
    attack = detectSpike({ rows, newThisMonth: audits[0].a.newThisMonth }).level === "attack";
    at = audits[0].s.createdAt;
  }
  const bl = [...input.backlinks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  if (bl.length >= 2) {
    const ref = (s: Saved) => arr(obj(s.data).referring).map(obj);
    const before = new Set(ref(bl[1]).map((x) => normalizeDomain(str(x.domain))).filter(Boolean) as string[]);
    let added = 0;
    for (const x of ref(bl[0])) {
      const d = normalizeDomain(str(x.domain));
      const spam = num(x.spamScore);
      if (!d || before.has(d) || spam === null || spam < SPAM_CUTOFF || safeReason(d, input.ctx)) continue;
      if (!fresh.has(d)) added++;
      fresh.add(d);
    }
    if (added && (!at || new Date(bl[0].createdAt) > new Date(at))) {
      at = bl[0].createdAt;
      source = "backlinks";
    }
  }
  if (!at || fresh.size < TOXIC_ALERT_MIN) return null;
  return { count: fresh.size, attack, domains: [...fresh].sort().slice(0, 5), at, source };
}
