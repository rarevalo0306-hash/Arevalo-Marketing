// Enlaces hacia tu página (DataForSEO Backlinks API, pago por uso). Como "Backlink Analytics" + "Backlink Gap":
// 1) Resumen de tu dominio: enlaces, sitios que te enlazan, fuerza (rank 0–1000), nofollow, rotos, spam.
// 2) Nuevos y perdidos por mes (backlinks/history).
// 3) Los sitios que te enlazan, de más a menos fuerza (backlinks/referring_domains).
// 4) Tu competencia: lo mismo de cada uno (backlinks/summary), hasta 3 competidores del reporte "competitors".
// 5) Sitios que enlazan a tu competencia y a ti no (backlinks/domain_intersection con exclude_targets = tu dominio),
//    con una pista simple de cómo conseguir ese enlace (directorio, noticias, asociación, blog, proveedor…).
// Docs: docs.dataforseo.com/v3/backlinks/{summary,history,referring_domains,domain_intersection}/live.
// Precio (dataforseo.com/pricing/backlinks/backlinks, desde el 1 jul 2026): US$0.024 por llamada + US$0.000036 por
// fila. Ese mismo día DataForSEO quitó la cuota mínima de US$100 al mes: ahora es solo pago por uso. Si la cuenta
// no tiene acceso, DataForSEO responde 40204 "Access denied. Visit Plans and Subscriptions to activate your
// subscription…" (docs.dataforseo.com/v3/appendix/errors): se muestra como explicación amable, no como error.
import { bi, BiError, type T } from "@/lib/i18n";
import { brandToken, isDirectory, normalizeDomain, sameSite, type BiText, type CompetitorsReport } from "@/lib/seo/competitors";
import { dfsError, dfsTask } from "@/lib/seo/dataforseo";

// ---------- Tipos ----------

export type BacklinksSummary = {
  domain: string;
  /** Fuerza del dominio según DataForSEO, de 0 a 1000 (rank_scale one_thousand, el de por defecto). */
  rank: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  referringMainDomains: number | null;
  referringIps: number | null;
  referringSubnets: number | null;
  /** Enlaces con nofollow (referring_links_attributes.nofollow). */
  nofollowLinks: number | null;
  /** Sitios que te ponen al menos un enlace nofollow (referring_domains_nofollow). */
  nofollowDomains: number | null;
  /** Parte de los enlaces que sí pasan fuerza (dofollow), de 0 a 1. */
  dofollowShare: number | null;
  brokenBacklinks: number | null;
  brokenPages: number | null;
  /** Spam de los enlaces que te llegan, de 0 a 100 (backlinks_spam_score). */
  spamScore: number | null;
  firstSeen: string | null;
  /** Nuevos y perdidos en el último mes y en los últimos 3 meses (backlinks/history, por mes). */
  newBacklinks1m: number | null;
  lostBacklinks1m: number | null;
  newDomains1m: number | null;
  lostDomains1m: number | null;
  newBacklinks3m: number | null;
  lostBacklinks3m: number | null;
  newDomains3m: number | null;
  lostDomains3m: number | null;
  /** Mes a mes: fuerza, enlaces y sitios que te enlazan. */
  trend: { date: string; rank: number | null; backlinks: number | null; referringDomains: number | null }[];
};

export type ReferringDomain = {
  domain: string;
  rank: number | null;
  backlinks: number | null;
  firstSeen: string | null;
  /** Al menos un enlace de este sitio pasa fuerza (no es nofollow). null si no se sabe. */
  dofollow: boolean | null;
  spamScore: number | null;
};

export type CompetitorLinks = {
  domain: string;
  rank: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  dofollowShare: number | null;
  /** Se pudo leer (si falló, los números quedan en null). */
  ok: boolean;
};

export type LinkHint = "directory" | "social" | "news" | "public" | "association" | "forum" | "blog" | "supplier" | "other";

export type GapDomain = {
  domain: string;
  /** La mayor fuerza que pasa a alguno de tus competidores. */
  rank: number | null;
  /** A cuáles de tus competidores enlaza. */
  linksTo: string[];
  backlinks: number | null;
  spamScore: number | null;
  hint: LinkHint;
};

export type BacklinksReport = {
  domain: string;
  summary: BacklinksSummary;
  referring: ReferringDomain[];
  /** Cuántos sitios (dominio principal) te enlazan en total, aunque solo se muestren los primeros. */
  referringTotal: number | null;
  competitors: CompetitorLinks[];
  gap: GapDomain[];
  /** Sitios de la lista de oportunidades que se quitaron por parecer spam. */
  gapSpamHidden: number;
  notes: BiText[];
  cost: number;
  createdAt: string;
};

export const BACKLINKS_KIND = "backlinks";
/** Marca guardada cuando la cuenta de DataForSEO no tiene acceso a Backlinks API (para mostrar la explicación). */
export const BACKLINKS_LOCKED_KIND = "backlinks-locked";
export const BACKLINKS_KEEP = 10;
export const BACKLINKS_MAX_COMPETITORS = 3;
export const REFERRING_LIMIT = 50;
export const GAP_LIMIT_PER_COMPETITOR = 50;
/** Spam de 0 a 100: desde aquí no vale la pena pedir un enlace a ese sitio. */
export const SPAM_CUTOFF = 60;

/** Precios de la página oficial (dataforseo.com/pricing/backlinks/backlinks), en USD. */
export const BACKLINKS_TASK_COST = 0.024;
export const BACKLINKS_ROW_COST = 0.000036;
/** Filas que devuelve history con 4 meses (un punto por mes, a veces uno más). */
const HISTORY_ROWS = 5;
const HISTORY_MONTHS = 4;

export const BACKLINKS_PRICING_URL = "https://dataforseo.com/pricing/backlinks/backlinks";
/** La página de la cuenta a la que manda el error 40204 de DataForSEO. */
export const BACKLINKS_ACTIVATE_URL = "https://app.dataforseo.com/backlinks-subscription";

/**
 * Costo máximo de una revisión: 3 llamadas tuyas (resumen, historia, sitios que te enlazan) y 2 por competidor
 * (su resumen y los sitios que lo enlazan a él y no a ti). Con 3 competidores: 9 llamadas, unos US$0.22.
 */
export function backlinksCostEstimate(competitors: number): number {
  const n = Math.max(0, Math.min(BACKLINKS_MAX_COMPETITORS, competitors));
  const calls = 3 + 2 * n;
  const rows = 1 + HISTORY_ROWS + REFERRING_LIMIT + n * (1 + GAP_LIMIT_PER_COMPETITOR);
  return Math.ceil((calls * BACKLINKS_TASK_COST + rows * BACKLINKS_ROW_COST) * 1000) / 1000;
}

// ---------- Ayudantes puros ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const sum = (list: (number | null)[]): number | null => (list.some((v) => v !== null) ? list.reduce<number>((a, v) => a + (v ?? 0), 0) : null);

/** "2020-01-18 11:50:58 +00:00" → "2020-01-18T11:50:58.000Z". null si no es una fecha. */
export function dfsDate(v: unknown): string | null {
  const s = str(v).trim();
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}):?(\d{2})$/.exec(s);
  const d = new Date(m ? `${m[1]}T${m[2]}${m[3]}:${m[4]}` : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** El código 40204 de DataForSEO: la cuenta no tiene acceso a Backlinks API. Acepta el código, el mensaje o el error. */
export function isNoBacklinksAccess(v: unknown): boolean {
  if (v === 40204) return true;
  const text = v instanceof Error ? `${v.message} ${(v as { en?: string }).en ?? ""}` : typeof v === "string" ? v : "";
  return /\b40204\b|backlinks-subscription|activate your subscription/i.test(text);
}

/** El error amable (en los dos idiomas) cuando la cuenta no tiene acceso a Backlinks API. */
export class NoBacklinksAccessError extends BiError {
  constructor() {
    super(
      "Tu cuenta de DataForSEO todavía no tiene activada la parte de Enlaces (Backlinks API).",
      "Your DataForSEO account doesn't have the Links part (Backlinks API) turned on yet.",
    );
  }
}

/** Los competidores para comparar: hasta 3 del último reporte de competencia, sin directorios ni tu propio sitio. */
export function pickBacklinkCompetitors(report: Pick<CompetitorsReport, "competitors"> | null, self: string | null): string[] {
  if (!report) return [];
  const out: string[] = [];
  for (const c of report.competitors) {
    const d = normalizeDomain(c.domain);
    if (!d || (self && sameSite(d, self)) || out.some((o) => sameSite(o, d))) continue;
    // Los que agregó el dueño se respetan aunque parezcan directorio (igual que en "Palabras que te faltan").
    if (c.source !== "owner" && isDirectory(d)) continue;
    out.push(d);
    if (out.length >= BACKLINKS_MAX_COMPETITORS) break;
  }
  return out;
}

// ---------- ¿Cómo conseguir el enlace? (reglas simples) ----------

const SOCIAL = new Set(["facebook", "instagram", "youtube", "tiktok", "linkedin", "twitter", "x", "pinterest", "whatsapp", "telegram", "threads", "snapchat", "flickr", "vimeo"]);
const DIRECTORIES = new Set([
  "yelp", "angi", "bbb", "thumbtack", "homeadvisor", "yellowpages", "superpages", "manta", "houzz", "porch", "bark", "chamberofcommerce",
  "birdeye", "tripadvisor", "trustpilot", "buildzoom", "brownbook", "hotfrog", "cylex", "infobel", "tuugo", "find-us-here", "storeboard",
  "kompass", "europages", "paginasamarillas", "amarillas", "paginas-amarillas", "guiamais", "encuentra24", "diredi", "cybo", "starofservice",
  "findglocal", "infoisinfo", "habitissimo", "cronoshare", "nicaraguacompanies", "empresite", "infoempresas", "guialocal", "guiaempresas",
  "dondeir", "clasificados", "foursquare", "waze", "mapquest", "google", "bing", "apple", "mercadolibre", "olx", "alibaba", "made-in-china",
  "globalspec", "thomasnet", "zoominfo", "dnb", "opencorporates", "bizapedia", "nicaraguabusiness", "nicamarket", "tumercado",
]);
const KNOWN_NEWS = new Set(["laprensani", "laprensa", "elnuevodiario", "confidencial", "100noticias", "articulo66", "despacho505", "elpais", "infobae", "cnn", "bbc", "nytimes", "elmundo", "eltiempo", "lajornada", "vostv", "canal10", "canal2", "tn8", "radiocorporacion", "elheraldo", "laprensagrafica", "prensalibre", "nacion", "forbes", "bloomberg", "reuters", "elsalvador"]);
const BLOG_HOSTS = new Set(["blogspot", "wordpress", "medium", "tumblr", "wixsite", "weebly", "substack", "blogger", "over-blog", "hashnode"]);
const FORUM_HOSTS = new Set(["reddit", "quora", "stackexchange", "forocoches", "taringa"]);
const PUBLIC = new Set(["gov", "gob", "gub", "gouv", "govt", "mil", "edu"]);

const DIRECTORY_RE = /directori|directory|listing|amarillas|yellow|guia|empresas|companies|negocios|catalog/;
const NEWS_RE = /noticia|periodico|diario|news|prensa|press|revista|magazine|semanario|tv$|^tv|radio|canal/;
const ASSOCIATION_RE = /camara|chamber|asociacion|association|federacion|federation|gremio|cooperativa|colegio|consejo|cosep|amcham|canacintra|club|fundacion|foundation|sindicato/;
const FORUM_RE = /foro|forum|comunidad|community/;
const BLOG_RE = /blog/;
const SUPPLIER_RE = /acero|steel|metal|hierro|ferreter|hardware|supply|supplies|suministr|distribu|import|proveedor|materiales|industrial|motor|automatiza|puerta|door|gate|porton|construc|pintura|soldad|weld|aluminio|vidrio/;

/**
 * Una pista simple de cómo conseguir el enlace, según el nombre del sitio y el tipo de sitio que reporta DataForSEO
 * (referring_links_platform_types: news, blogs, organization, message-boards, ecommerce…).
 */
export function linkHint(domain: string, platforms: string[] = []): LinkHint {
  const d = normalizeDomain(domain) ?? String(domain ?? "").trim().toLowerCase();
  const labels = d.split(".").filter(Boolean);
  const named = labels.slice(0, -1);
  const brand = brandToken(d);
  const has = (set: Set<string>) => named.some((l) => set.has(l)) || set.has(brand);
  if (has(SOCIAL) || d === "x.com" || d === "t.co" || d === "youtu.be") return "social";
  if (has(DIRECTORIES)) return "directory";
  if (has(KNOWN_NEWS)) return "news";
  if (labels.slice(1).some((l) => PUBLIC.has(l))) return "public";
  if (has(FORUM_HOSTS)) return "forum";
  if (has(BLOG_HOSTS) || named.includes("blog")) return "blog";
  if (DIRECTORY_RE.test(brand)) return "directory";
  if (NEWS_RE.test(brand)) return "news";
  if (ASSOCIATION_RE.test(brand)) return "association";
  if (FORUM_RE.test(brand)) return "forum";
  if (BLOG_RE.test(brand)) return "blog";
  if (SUPPLIER_RE.test(brand)) return "supplier";
  const p = new Set(platforms.map((x) => x.toLowerCase()));
  if (p.has("news")) return "news";
  if (p.has("organization")) return "association";
  if (p.has("message-boards")) return "forum";
  if (p.has("blogs")) return "blog";
  if (labels.at(-1) === "org" || (labels.at(-2) === "org" && labels.length > 2)) return "association";
  return "other";
}

/** Qué tan fácil es (para ordenar las pistas y pintar la etiqueta). */
export const HINT_EASY: Record<LinkHint, boolean> = {
  directory: true,
  social: true,
  news: false,
  public: false,
  association: false,
  forum: true,
  blog: false,
  supplier: false,
  other: false,
};

/** Nombre corto y qué hacer para conseguir el enlace, según el tipo de sitio. */
export function hintText(t: T): Record<LinkHint, { label: string; how: string }> {
  return {
    directory: { label: t("Directorio · fácil", "Directory · easy"), how: t("Fácil: regístrate gratis con tu nombre, teléfono y la dirección de tu página.", "Easy: sign up for free with your name, phone and website address.") },
    social: { label: t("Red social · fácil", "Social network · easy"), how: t("Crea o completa tu perfil y pon el enlace a tu página.", "Create or complete your profile and add the link to your website.") },
    news: { label: t("Noticias · nota de prensa", "News · press release"), how: t("Nota de prensa: mándales una novedad (un proyecto grande, un aniversario, algo nuevo que ofreces).", "Press release: send them some news (a big project, an anniversary, something new you offer).") },
    public: { label: t("Gobierno o universidad", "Government or university"), how: t("Pregunta por su registro de proveedores, o patrocina o da una charla.", "Ask about their supplier registry, or sponsor or give a talk.") },
    association: { label: t("Asociación o cámara", "Association or chamber"), how: t("Hazte miembro y pide aparecer en su lista de socios.", "Become a member and ask to be listed among their members.") },
    forum: { label: t("Foro · fácil", "Forum · easy"), how: t("Responde preguntas de tu tema y comparte tu página solo cuando de verdad ayude.", "Answer questions about your trade and share your website only when it really helps.") },
    blog: { label: t("Blog", "Blog"), how: t("Ofréceles un artículo útil escrito por ti, o pide que te mencionen.", "Offer them a useful article you write, or ask them to mention you.") },
    supplier: { label: t("Proveedor o socio", "Supplier or partner"), how: t("Si les compras o trabajas con ellos, pide que te pongan en su lista de clientes o distribuidores.", "If you buy from them or work with them, ask to be added to their list of clients or dealers.") },
    other: { label: t("Otro sitio", "Other site"), how: t("Escríbeles, preséntate y pide que te mencionen si tiene sentido para ellos.", "Write to them, introduce yourself and ask for a mention if it makes sense for them.") },
  };
}

// ---------- Lectura de respuestas de DataForSEO ----------

/** backlinks/summary/live: un solo resultado con rank, backlinks, referring_domains, broken_*, spam… */
export function parseBacklinksSummary(result: unknown[], fallbackDomain = ""): BacklinksSummary {
  const r = obj(result[0]);
  const backlinks = num(r.backlinks);
  const attrs = r.referring_links_attributes;
  // Sin atributos (null) todos los enlaces son normales; si viene la lista y no tiene "nofollow", no hay nofollow.
  const nofollowLinks = backlinks === null ? null : attrs === null || attrs === undefined ? 0 : (num(obj(attrs).nofollow) ?? 0);
  return {
    domain: normalizeDomain(str(r.target)) ?? fallbackDomain,
    rank: num(r.rank),
    backlinks,
    referringDomains: num(r.referring_domains),
    referringMainDomains: num(r.referring_main_domains),
    referringIps: num(r.referring_ips),
    referringSubnets: num(r.referring_subnets),
    nofollowLinks,
    nofollowDomains: num(r.referring_domains_nofollow),
    dofollowShare: backlinks && nofollowLinks !== null ? Math.max(0, Math.min(1, (backlinks - nofollowLinks) / backlinks)) : null,
    brokenBacklinks: num(r.broken_backlinks),
    brokenPages: num(r.broken_pages),
    spamScore: num(r.backlinks_spam_score),
    firstSeen: dfsDate(r.first_seen),
    newBacklinks1m: null,
    lostBacklinks1m: null,
    newDomains1m: null,
    lostDomains1m: null,
    newBacklinks3m: null,
    lostBacklinks3m: null,
    newDomains3m: null,
    lostDomains3m: null,
    trend: [],
  };
}

export type HistoryPoint = {
  date: string;
  rank: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  newBacklinks: number | null;
  lostBacklinks: number | null;
  newDomains: number | null;
  lostDomains: number | null;
};

/** backlinks/history/live: items[] mes a mes (type backlinks_history), del más viejo al más nuevo. */
export function parseHistory(result: unknown[]): HistoryPoint[] {
  return arr(obj(result[0]).items)
    .map((raw) => {
      const it = obj(raw);
      return {
        date: dfsDate(it.date) ?? "",
        rank: num(it.rank),
        backlinks: num(it.backlinks),
        referringDomains: num(it.referring_domains),
        newBacklinks: num(it.new_backlinks),
        lostBacklinks: num(it.lost_backlinks),
        newDomains: num(it.new_referring_domains),
        lostDomains: num(it.lost_referring_domains),
      };
    })
    .filter((p) => p.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Agrega al resumen los nuevos/perdidos del último mes y de los últimos 3, y la tendencia. */
export function withHistory(summary: BacklinksSummary, points: HistoryPoint[]): BacklinksSummary {
  if (!points.length) return summary;
  const last = points.slice(-1);
  const last3 = points.slice(-3);
  return {
    ...summary,
    newBacklinks1m: sum(last.map((p) => p.newBacklinks)),
    lostBacklinks1m: sum(last.map((p) => p.lostBacklinks)),
    newDomains1m: sum(last.map((p) => p.newDomains)),
    lostDomains1m: sum(last.map((p) => p.lostDomains)),
    newBacklinks3m: sum(last3.map((p) => p.newBacklinks)),
    lostBacklinks3m: sum(last3.map((p) => p.lostBacklinks)),
    newDomains3m: sum(last3.map((p) => p.newDomains)),
    lostDomains3m: sum(last3.map((p) => p.lostDomains)),
    trend: points.map((p) => ({ date: p.date, rank: p.rank, backlinks: p.backlinks, referringDomains: p.referringDomains })),
  };
}

/** ¿Algún enlace de este sitio pasa fuerza? Compara los enlaces con los que tienen nofollow. */
function hasDofollow(it: Record<string, unknown>): boolean | null {
  const backlinks = num(it.backlinks);
  if (backlinks === null || backlinks <= 0) return null;
  const attrs = it.referring_links_attributes;
  const nofollow = attrs === null || attrs === undefined ? 0 : (num(obj(attrs).nofollow) ?? 0);
  return nofollow < backlinks;
}

/** backlinks/referring_domains/live: total_count e items[] (type backlinks_referring_domain). */
export function parseReferringDomains(result: unknown[]): { total: number | null; items: ReferringDomain[] } {
  const r = obj(result[0]);
  const items: ReferringDomain[] = [];
  for (const raw of arr(r.items)) {
    const it = obj(raw);
    const domain = normalizeDomain(str(it.domain));
    if (!domain || items.some((x) => x.domain === domain)) continue;
    items.push({ domain, rank: num(it.rank), backlinks: num(it.backlinks), firstSeen: dfsDate(it.first_seen), dofollow: hasDofollow(it), spamScore: num(it.backlinks_spam_score) });
  }
  return { total: num(r.total_count), items };
}

export type IntersectionRow = { domain: string; rank: number | null; backlinks: number | null; spamScore: number | null; platforms: string[]; linksTo: string[] };

/**
 * backlinks/domain_intersection/live: items[] con domain_intersection {"1": {...}, "2": {...}} (un bloque por cada
 * sitio de `targets`, con `target` = el sitio que enlaza). `targets` dice a qué competidor corresponde cada número.
 */
export function parseIntersection(result: unknown[], targets: Record<string, string>): IntersectionRow[] {
  const r = obj(result[0]);
  const names = { ...targets, ...Object.fromEntries(Object.entries(obj(r.targets)).filter(([, v]) => typeof v === "string")) } as Record<string, string>;
  const rows: IntersectionRow[] = [];
  for (const raw of arr(r.items)) {
    const blocks = obj(obj(raw).domain_intersection);
    let row: IntersectionRow | null = null;
    for (const [key, value] of Object.entries(blocks)) {
      const b = obj(value);
      const domain = normalizeDomain(str(b.target));
      if (!domain) continue;
      // Un bloque vacío (sin enlaces) no cuenta como "enlaza a ese competidor".
      if (num(b.backlinks) === 0) continue;
      row ??= { domain, rank: null, backlinks: null, spamScore: null, platforms: [], linksTo: [] };
      const rank = num(b.rank);
      if (rank !== null && (row.rank === null || rank > row.rank)) row.rank = rank;
      const bl = num(b.backlinks);
      if (bl !== null) row.backlinks = (row.backlinks ?? 0) + bl;
      const spam = num(b.backlinks_spam_score);
      if (spam !== null && (row.spamScore === null || spam > row.spamScore)) row.spamScore = spam;
      for (const p of Object.keys(obj(b.referring_links_platform_types))) if (p !== "unknown" && !row.platforms.includes(p)) row.platforms.push(p);
      const competitor = normalizeDomain(names[key] ?? "") ?? names[key];
      if (competitor && !row.linksTo.includes(competitor)) row.linksTo.push(competitor);
    }
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * Junta los sitios que enlazan a cada competidor (y no a ti): sin tu sitio ni los competidores, sin spam;
 * ordenados por a cuántos competidores enlazan y luego por fuerza. `spamHidden` dice cuántos se quitaron por spam.
 */
export function mergeGapDomains(lists: IntersectionRow[][], self: string, competitors: string[], keep = 60): { gap: GapDomain[]; spamHidden: number } {
  const byDomain = new Map<string, IntersectionRow>();
  for (const list of lists) {
    for (const row of list) {
      if (sameSite(row.domain, self) || competitors.some((c) => sameSite(row.domain, c))) continue;
      const cur = byDomain.get(row.domain);
      if (!cur) {
        byDomain.set(row.domain, { ...row, platforms: [...row.platforms], linksTo: [...row.linksTo] });
        continue;
      }
      if (row.rank !== null && (cur.rank === null || row.rank > cur.rank)) cur.rank = row.rank;
      if (row.backlinks !== null) cur.backlinks = (cur.backlinks ?? 0) + row.backlinks;
      if (row.spamScore !== null && (cur.spamScore === null || row.spamScore > cur.spamScore)) cur.spamScore = row.spamScore;
      for (const p of row.platforms) if (!cur.platforms.includes(p)) cur.platforms.push(p);
      for (const c of row.linksTo) if (!cur.linksTo.includes(c)) cur.linksTo.push(c);
    }
  }
  let spamHidden = 0;
  const gap: GapDomain[] = [];
  for (const row of byDomain.values()) {
    if (row.spamScore !== null && row.spamScore >= SPAM_CUTOFF) {
      spamHidden++;
      continue;
    }
    gap.push({ domain: row.domain, rank: row.rank, linksTo: row.linksTo, backlinks: row.backlinks, spamScore: row.spamScore, hint: linkHint(row.domain, row.platforms) });
  }
  gap.sort((a, b) => b.linksTo.length - a.linksTo.length || (b.rank ?? -1) - (a.rank ?? -1) || a.domain.localeCompare(b.domain));
  return { gap: gap.slice(0, keep), spamHidden };
}

// ---------- Leer un reporte guardado ----------

const HINTS: LinkHint[] = ["directory", "social", "news", "public", "association", "forum", "blog", "supplier", "other"];

/** Lee un reporte guardado sin confiar en su forma; null si no sirve. */
export function readBacklinksReport(json: unknown): BacklinksReport | null {
  const r = obj(json);
  const s = obj(r.summary);
  const domain = normalizeDomain(str(r.domain)) ?? normalizeDomain(str(s.domain));
  if (!domain || !r.summary || typeof r.summary !== "object") return null;
  const n = (k: string) => num(s[k]);
  const share = n("dofollowShare");
  const summary: BacklinksSummary = {
    domain,
    rank: n("rank"),
    backlinks: n("backlinks"),
    referringDomains: n("referringDomains"),
    referringMainDomains: n("referringMainDomains"),
    referringIps: n("referringIps"),
    referringSubnets: n("referringSubnets"),
    nofollowLinks: n("nofollowLinks"),
    nofollowDomains: n("nofollowDomains"),
    dofollowShare: share === null ? null : Math.max(0, Math.min(1, share)),
    brokenBacklinks: n("brokenBacklinks"),
    brokenPages: n("brokenPages"),
    spamScore: n("spamScore"),
    firstSeen: str(s.firstSeen) || null,
    newBacklinks1m: n("newBacklinks1m"),
    lostBacklinks1m: n("lostBacklinks1m"),
    newDomains1m: n("newDomains1m"),
    lostDomains1m: n("lostDomains1m"),
    newBacklinks3m: n("newBacklinks3m"),
    lostBacklinks3m: n("lostBacklinks3m"),
    newDomains3m: n("newDomains3m"),
    lostDomains3m: n("lostDomains3m"),
    trend: arr(s.trend)
      .map((raw) => {
        const p = obj(raw);
        return { date: str(p.date), rank: num(p.rank), backlinks: num(p.backlinks), referringDomains: num(p.referringDomains) };
      })
      .filter((p) => p.date),
  };
  const referring: ReferringDomain[] = arr(r.referring)
    .map((raw) => {
      const x = obj(raw);
      return {
        domain: normalizeDomain(str(x.domain)) ?? "",
        rank: num(x.rank),
        backlinks: num(x.backlinks),
        firstSeen: str(x.firstSeen) || null,
        dofollow: typeof x.dofollow === "boolean" ? x.dofollow : null,
        spamScore: num(x.spamScore),
      };
    })
    .filter((x) => x.domain);
  const competitors: CompetitorLinks[] = arr(r.competitors)
    .map((raw) => {
      const x = obj(raw);
      return {
        domain: normalizeDomain(str(x.domain)) ?? "",
        rank: num(x.rank),
        backlinks: num(x.backlinks),
        referringDomains: num(x.referringDomains),
        dofollowShare: num(x.dofollowShare),
        ok: x.ok !== false,
      };
    })
    .filter((x) => x.domain);
  const gap: GapDomain[] = arr(r.gap)
    .map((raw) => {
      const x = obj(raw);
      const d = normalizeDomain(str(x.domain)) ?? "";
      const hint = HINTS.includes(x.hint as LinkHint) ? (x.hint as LinkHint) : linkHint(d);
      return {
        domain: d,
        rank: num(x.rank),
        linksTo: arr(x.linksTo).filter((c): c is string => typeof c === "string" && c.length > 0),
        backlinks: num(x.backlinks),
        spamScore: num(x.spamScore),
        hint,
      };
    })
    .filter((x) => x.domain);
  const notes: BiText[] = arr(r.notes)
    .map((v) => obj(v))
    .filter((v) => typeof v.es === "string" && typeof v.en === "string")
    .map((v) => ({ es: v.es as string, en: v.en as string }));
  return {
    domain,
    summary,
    referring,
    referringTotal: num(r.referringTotal),
    competitors,
    gap,
    gapSpamHidden: num(r.gapSpamHidden) ?? 0,
    notes,
    cost: num(r.cost) ?? 0,
    createdAt: str(r.createdAt),
  };
}

/** La marca de "sin acceso a Backlinks API" guardada; null si no es una. */
export function readBacklinksLocked(json: unknown): { at: string } | null {
  const r = obj(json);
  return r.locked === true ? { at: str(r.at) } : null;
}

// ---------- Llamadas a DataForSEO ----------

/** Una llamada "live": lanza NoBacklinksAccessError si la cuenta no tiene acceso, o el error normal si falla. */
async function live<T>(path: string, task: Record<string, unknown>): Promise<{ result: T[]; cost: number }> {
  let t;
  try {
    t = await dfsTask<T>("POST", path, task, 60_000);
  } catch (e) {
    if (isNoBacklinksAccess(e)) throw new NoBacklinksAccessError();
    throw e;
  }
  if (isNoBacklinksAccess(t.statusCode) || isNoBacklinksAccess(t.statusMessage)) throw new NoBacklinksAccessError();
  if (t.statusCode !== 20000) throw dfsError(t.statusCode, t.statusMessage);
  return { result: t.result, cost: t.cost };
}

const monthsAgo = (now: Date, months: number) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  return d.toISOString().slice(0, 10);
};

/**
 * La revisión completa. Primero el resumen de tu dominio (si la cuenta no tiene acceso, se detiene ahí sin gastar
 * más); después, todo lo demás a la vez. Con 3 competidores son 9 llamadas (unos US$0.22) y tarda ~10–30 s.
 */
export async function runBacklinksReport(input: { website: string; competitors: string[]; now?: Date }): Promise<BacklinksReport> {
  const self = normalizeDomain(input.website);
  if (!self) throw bi("La dirección de tu página web no parece válida. Revísala en Ajustes del negocio.", "Your website address doesn't look valid. Check it in Business settings.");
  const competitors = input.competitors
    .map((c) => normalizeDomain(c))
    .filter((c): c is string => Boolean(c) && !sameSite(c as string, self))
    .slice(0, BACKLINKS_MAX_COMPETITORS);
  const now = input.now ?? new Date();
  const notes: BiText[] = [];
  let cost = 0;

  // 1) Tu resumen (si no hay acceso, aquí se corta).
  const first = await live<unknown>("/backlinks/summary/live", { target: self, internal_list_limit: 20 });
  cost += first.cost;
  let summary = parseBacklinksSummary(first.result, self);

  // 2) Todo lo demás a la vez.
  const [history, referring, ...rest] = await Promise.allSettled([
    live<unknown>("/backlinks/history/live", { target: self, date_from: monthsAgo(now, HISTORY_MONTHS) }),
    live<unknown>("/backlinks/referring_domains/live", { target: self, limit: REFERRING_LIMIT, order_by: ["rank,desc"], internal_list_limit: 20 }),
    ...competitors.map((c) => live<unknown>("/backlinks/summary/live", { target: c, internal_list_limit: 20 })),
    ...competitors.map((c) =>
      live<unknown>("/backlinks/domain_intersection/live", {
        targets: { "1": c },
        exclude_targets: [self],
        limit: GAP_LIMIT_PER_COMPETITOR,
        order_by: ["1.rank,desc"],
        internal_list_limit: 20,
      }),
    ),
  ]);
  const all = [history, referring, ...rest];
  if (all.some((x) => x.status === "rejected" && x.reason instanceof NoBacklinksAccessError)) throw new NoBacklinksAccessError();
  for (const x of all) if (x.status === "fulfilled") cost += x.value.cost;

  if (history.status === "fulfilled") summary = withHistory(summary, parseHistory(history.value.result));
  else notes.push({ es: "No se pudo leer cuántos enlaces ganaste o perdiste por mes.", en: "Couldn't read how many links you gained or lost each month." });

  let referringItems: ReferringDomain[] = [];
  let referringTotal: number | null = null;
  if (referring.status === "fulfilled") {
    const parsed = parseReferringDomains(referring.value.result);
    referringItems = parsed.items;
    referringTotal = parsed.total;
  } else notes.push({ es: "No se pudo leer la lista de sitios que te enlazan.", en: "Couldn't read the list of sites linking to you." });

  const summaries = rest.slice(0, competitors.length);
  const gaps = rest.slice(competitors.length);
  const competitorRows: CompetitorLinks[] = competitors.map((c, i) => {
    const s = summaries[i];
    if (s?.status === "fulfilled") {
      const p = parseBacklinksSummary(s.value.result, c);
      return { domain: c, rank: p.rank, backlinks: p.backlinks, referringDomains: p.referringDomains, dofollowShare: p.dofollowShare, ok: true };
    }
    notes.push({ es: `No se pudieron leer los enlaces de ${c}.`, en: `Couldn't read ${c}'s links.` });
    return { domain: c, rank: null, backlinks: null, referringDomains: null, dofollowShare: null, ok: false };
  });
  const lists: IntersectionRow[][] = [];
  competitors.forEach((c, i) => {
    const g = gaps[i];
    if (g?.status === "fulfilled") lists.push(parseIntersection(g.value.result, { "1": c }));
    else notes.push({ es: `No se pudo ver qué sitios enlazan a ${c} y a ti no.`, en: `Couldn't see which sites link to ${c} but not to you.` });
  });
  const { gap, spamHidden } = mergeGapDomains(lists, self, competitors);

  return {
    domain: self,
    summary,
    referring: referringItems,
    referringTotal,
    competitors: competitorRows,
    gap,
    gapSpamHidden: spamHidden,
    notes,
    cost: Math.round(cost * 10000) / 10000,
    createdAt: now.toISOString(),
  };
}
