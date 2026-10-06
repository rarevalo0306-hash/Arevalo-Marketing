// "Páginas que compiten entre sí" (canibalización de palabras clave, como el reporte Cannibalization de Semrush):
// cuando dos o más páginas del mismo sitio salen en Google para la misma búsqueda, se reparten los clics y la fuerza.
// Se arma solo con reportes ya guardados (Search Console, posiciones y la revisión de la página): no cuesta nada.
//  1. Search Console (lo mejor): pares página + búsqueda con impresiones reales.
//  2. Posiciones (si no hay Search Console): Google mostró distintas páginas tuyas para la misma palabra en 30 días.
//  3. Revisión de la página (extra): páginas con el mismo título o H1 (o casi).
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { T } from "@/lib/i18n";
import { readAuditReport, type AuditReport } from "@/lib/seo/audit";
import { readZones } from "@/lib/seo/dataforseo";
import { asGscReport, type GscPageQuery, type GscRange } from "@/lib/seo/gsc";
import { isBrandQuery } from "@/lib/seo/onpage";
import { domainMatches, readRankReport, siteDomain, type RankReport } from "@/lib/seo/rank";
import { norm, stems } from "@/lib/seo/writer";

/** El tipo de fila en SeoReport (todavía no está en SeoKind). */
export const CANNIBAL_KIND = "cannibal";
/** Cuántas revisiones guardadas se conservan. */
export const MAX_CANNIBAL_REPORTS = 10;
/** Días de revisiones de posiciones que se miran. */
export const RANK_WINDOW_DAYS = 30;
/** Una página cuenta para una búsqueda si tiene al menos 3 impresiones… */
export const MIN_PAGE_IMPRESSIONS = 3;
/** …y al menos el 5 % de las impresiones de esa búsqueda. */
export const MIN_PAGE_SHARE = 0.05;
/** Para que sea "alta", la búsqueda necesita algo de movimiento. */
export const MIN_ALTA_IMPRESSIONS = 10;
const MAX_ISSUES = 50;
const MAX_AUDIT_ISSUES = 10;
const MAX_AUDIT_GROUP = 8;

export type CannibalSource = "gsc" | "rank" | "audit";
export type CannibalSeverity = "alta" | "media" | "baja";
/**
 * Qué hacer:
 * merge = une las dos páginas en una y redirige la otra (301);
 * retarget = deja la principal y cambia el título/tema de la otra;
 * link = enlaza desde la secundaria a la principal con el texto de la búsqueda;
 * zones = son para ciudades distintas: está bien, que cada título diga su ciudad.
 */
export type CannibalFix = "merge" | "retarget" | "link" | "zones";

export type CannibalPage = {
  url: string;
  /** Título de la página (de la revisión de la página), si se conoce. */
  title: string | null;
  clicks: number | null;
  impressions: number | null;
  /** Posición promedio (Search Console) o la mejor posición vista (posiciones). */
  position: number | null;
  /** Parte de las impresiones (Search Console) o de las revisiones donde salió (posiciones), de 0 a 1. */
  share: number | null;
  /** Posiciones: cuántas veces salió esta página. */
  seen: number | null;
  /** Posiciones: en qué zonas salió. */
  zones: string[];
  /** La página que conviene dejar como la principal para esta búsqueda. */
  main: boolean;
};

export type CannibalIssue = {
  /** La búsqueda (o el título repetido, si viene de la revisión de la página). */
  query: string;
  source: CannibalSource;
  severity: CannibalSeverity;
  totalImpressions: number | null;
  totalClicks: number | null;
  /** Posiciones: cuántas revisiones mostraron alguna página tuya. */
  checks: number | null;
  /** La principal primero. */
  pages: CannibalPage[];
  fix: CannibalFix;
  /** Texto sugerido para el enlace (fix "link"). */
  anchor: string | null;
  /** Ciudad de la principal y de la otra (fix "zones"). */
  places: string[];
};

export type CannibalReport = {
  version: 1;
  issues: CannibalIssue[];
  /** De dónde salió la revisión principal (null = no había datos). */
  source: CannibalSource | null;
  gscRange: GscRange | null;
  createdAt: string;
};

// ---------- Direcciones ----------

/** Dirección sin parámetros (?…) ni #fragmento, para mostrar. */
export function cleanUrl(u: string): string {
  return u.trim().replace(/[?#].*$/, "");
}

/** Clave para comparar páginas: sin http/https, sin www, sin ?…, sin # y sin barra final. "https://www.X.com/a/?b#c" → "x.com/a". */
export function pageKey(u: string): string {
  const raw = cleanUrl(u);
  const m = raw.match(/^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/]+)(\/.*)?$/i);
  if (!m) return raw.toLowerCase().replace(/^www\./, "").replace(/\/+$/, "");
  const host = m[1].toLowerCase().replace(/:(80|443)$/, "").replace(/^www\./, "");
  let path = (m[2] ?? "").replace(/\/+$/, "");
  try {
    path = decodeURI(path);
  } catch {
    // se deja como venía
  }
  return `${host}${path}`;
}

const pathPart = (u: string) => pageKey(u).replace(/^[^/]*/, "") || "/";
const isHome = (u: string) => pathPart(u) === "/";
const depth = (u: string) => pathPart(u).split("/").filter(Boolean).length;

/** ¿Es un artículo del blog (o noticia/guía)? */
export function isArticle(u: string): boolean {
  return /\/(blog|blogs|noticias|articulos?|post|posts|news|guias?|consejos|tips|recursos)(\/|$)/i.test(pathPart(u)) || /\/\d{4}\/\d{1,2}\//.test(pathPart(u));
}

/** Palabras de la dirección: "/cobertura/san-juan-del-sur" → "cobertura san juan del sur". */
const slugText = (u: string) => pathPart(u).replace(/[-_/.]+/g, " ").trim();

// ---------- Ciudades ----------

/** Ciudades y departamentos (no países: una página "de Nicaragua" no compite por zona con una "de Managua"). */
const PLACES = [
  // Nicaragua
  "managua", "leon", "granada", "masaya", "chinandega", "esteli", "matagalpa", "jinotega", "rivas", "carazo", "jinotepe", "diriamba",
  "boaco", "juigalpa", "chontales", "ocotal", "somoto", "nueva segovia", "madriz", "bluefields", "bilwi", "puerto cabezas", "tipitapa",
  "ciudad sandino", "nindiri", "ticuantepe", "san juan del sur", "nagarote", "mateare", "masatepe", "nandaime", "corinto", "rio san juan",
  "chichigalpa", "el crucero", "san rafael del sur", "siuna", "nueva guinea",
  // Centroamérica y otros
  "san jose", "alajuela", "heredia", "cartago", "liberia", "puntarenas", "tegucigalpa", "san pedro sula", "la ceiba", "choluteca",
  "san salvador", "santa ana", "san miguel", "ciudad de guatemala", "quetzaltenango", "antigua guatemala", "ciudad de panama", "david", "colon",
  "santo domingo", "santiago", "bogota", "medellin", "cali", "barranquilla", "lima", "quito", "guayaquil", "monterrey", "guadalajara",
  "ciudad de mexico", "cdmx", "puebla", "tijuana", "madrid", "barcelona", "valencia", "sevilla", "miami", "houston", "dallas", "austin",
  "san antonio", "orlando", "tampa", "atlanta", "chicago", "los angeles", "new york", "nueva york", "phoenix",
];
/** Partes de la dirección que anuncian una página por ciudad: "/cobertura/leon", "/zonas/masaya", "/locations/miami". */
const PLACE_PARENTS = /^(cobertura|zonas?|ubicacion(es)?|sucursal(es)?|ciudad(es)?|sedes?|service-areas?|locations?|cities|city|donde-estamos)$/i;

/** Las ciudades que se buscan: la lista de arriba y las zonas del negocio (sin los países). */
export function placeList(zones: { name: string; type?: string }[] = []): string[] {
  const extra = zones.filter((z) => !/country|pa[ií]s/i.test(z.type ?? "")).map((z) => norm(z.name.split(",")[0] ?? ""));
  return [...new Set([...PLACES, ...extra].filter((p) => p.length >= 3))].sort((a, b) => b.length - a.length);
}

/** La ciudad de una página (por su dirección o su título), o null. */
export function placeOf(page: { url: string; title?: string | null }, places: string[]): string | null {
  const segs = pathPart(page.url).split("/").filter(Boolean);
  for (let i = 0; i + 1 < segs.length; i++) if (PLACE_PARENTS.test(segs[i])) return norm(segs[i + 1]);
  const text = ` ${norm(`${slugText(page.url)} ${page.title ?? ""}`)} `;
  return places.find((p) => text.includes(` ${p} `)) ?? null;
}

// ---------- Parecido entre textos ----------

/** Palabras de direcciones y títulos que no dicen el tema (raíces). */
const GENERIC = new Set(["servici", "servic", "product", "inicio", "home", "pagina", "page", "categor", "web", "sitio"]);

/** Raíces con significado de un texto, sin las del nombre del negocio, las ciudades ni palabras genéricas. */
function topicStems(s: string, brand: string[], places: string[]): Set<string> {
  let text = ` ${norm(s)} `;
  for (const p of places) text = text.replaceAll(` ${p} `, " ");
  const b = new Set(brand.flatMap((x) => stems(x)));
  return new Set(stems(text).filter((w) => !b.has(w) && !GENERIC.has(w)));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// ---------- Cuál es la principal y qué hacer ----------

/** La principal: más clics (en posiciones: la que más veces salió), después mejor posición (más arriba), después más impresiones. */
export function byMain(a: Pick<CannibalPage, "clicks" | "position" | "impressions" | "seen">, b: Pick<CannibalPage, "clicks" | "position" | "impressions" | "seen">): number {
  const pos = (p: number | null) => (p && p > 0 ? p : Infinity);
  return (b.clicks ?? 0) - (a.clicks ?? 0) || (b.seen ?? 0) - (a.seen ?? 0) || pos(a.position) - pos(b.position) || (b.impressions ?? 0) - (a.impressions ?? 0);
}

type FixCtx = { brand: string[]; places: string[] };

/**
 * Qué hacer con la principal y la otra página más fuerte:
 * 1. Son de ciudades distintas → está bien, que cada título diga su ciudad.
 * 2. Una es la de inicio, o una es un artículo del blog y la otra no → enlaza desde la secundaria a la principal con el texto de la búsqueda.
 * 3. Tratan de lo mismo (títulos o direcciones casi iguales) → únelas y redirige la otra (301).
 * 4. La otra casi no sale (menos del 15 %) → basta con un enlace a la principal.
 * 5. Si no → deja la principal y cambia el título/tema de la otra.
 */
export function chooseFix(query: string, main: CannibalPage, other: CannibalPage, ctx: FixCtx): Pick<CannibalIssue, "fix" | "anchor" | "places"> {
  const pm = placeOf(main, ctx.places);
  const po = placeOf(other, ctx.places);
  if (pm && po && pm !== po) return { fix: "zones", anchor: null, places: [pm, po] };
  const anchor = query.trim() || null;
  // La de inicio no se une ni se cambia de tema; un artículo y una página de servicio se ayudan con un enlace.
  if (isHome(main.url) || isHome(other.url) || isArticle(main.url) !== isArticle(other.url)) return { fix: "link", anchor, places: [] };
  const st = (x: string) => topicStems(x, ctx.brand, ctx.places);
  const bySlug = jaccard(st(slugText(main.url)), st(slugText(other.url)));
  const byTitle = main.title && other.title ? jaccard(st(main.title), st(other.title)) : 0;
  const same = Math.max(bySlug, byTitle) >= 0.6;
  if (same) return { fix: "merge", anchor: null, places: [] };
  if (other.share !== null && other.share < 0.15) return { fix: "link", anchor, places: [] };
  return { fix: "retarget", anchor: null, places: [] };
}

// ---------- 1. Search Console ----------

export type CannibalCtx = {
  /** Nombre del negocio (y su dominio): las búsquedas con el nombre no cuentan. */
  brand: string[];
  /** Títulos conocidos por pageKey. */
  titles?: Map<string, string>;
  places?: string[];
};

const isBrand = (q: string, brand: string[]) => brand.some((b) => isBrandQuery(q, b));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Severidad con datos de Search Console: alta si las dos más fuertes se reparten parejo y las dos salen en página 1–2. */
export function gscSeverity(pages: Pick<CannibalPage, "impressions" | "position" | "share">[], total: number): CannibalSeverity {
  const [a, b] = [...pages].sort((x, y) => (y.impressions ?? 0) - (x.impressions ?? 0));
  if (!a || !b) return "baja";
  const close = (b.impressions ?? 0) >= 0.5 * (a.impressions ?? 0);
  const within = (p: number | null, max: number) => p !== null && p > 0 && p <= max;
  const page12 = within(a.position, 20) && within(b.position, 20);
  if (close && page12 && total >= MIN_ALTA_IMPRESSIONS) return "alta";
  if ((close && page12) || ((b.share ?? 0) >= 0.2 && within(a.position, 30) && within(b.position, 30))) return "media";
  return "baja";
}

/** Búsquedas donde 2 o más páginas tuyas tuvieron impresiones (Search Console, pares página + búsqueda). */
export function gscCannibals(pairs: GscPageQuery[], ctx: CannibalCtx): CannibalIssue[] {
  const places = ctx.places ?? placeList();
  type Acc = { url: string; urlImpr: number; clicks: number; impressions: number; posSum: number };
  const byQuery = new Map<string, { query: string; queryImpr: number; pages: Map<string, Acc> }>();
  for (const p of pairs) {
    const q = norm(p.query);
    if (!q || !p.page || isBrand(p.query, ctx.brand)) continue;
    let g = byQuery.get(q);
    if (!g) byQuery.set(q, (g = { query: p.query.trim(), queryImpr: -1, pages: new Map() }));
    if (p.impressions > g.queryImpr) {
      g.query = p.query.trim();
      g.queryImpr = p.impressions;
    }
    const key = pageKey(p.page);
    let a = g.pages.get(key);
    if (!a) g.pages.set(key, (a = { url: cleanUrl(p.page), urlImpr: -1, clicks: 0, impressions: 0, posSum: 0 }));
    // La misma página con http/https, www o ?parámetros se suma; se muestra la variante con más impresiones.
    if (p.impressions > a.urlImpr) {
      a.url = cleanUrl(p.page);
      a.urlImpr = p.impressions;
    }
    a.clicks += p.clicks;
    a.impressions += p.impressions;
    a.posSum += p.position * p.impressions;
  }

  const out: CannibalIssue[] = [];
  for (const g of byQuery.values()) {
    const all = [...g.pages.entries()];
    const total = all.reduce((s, [, a]) => s + a.impressions, 0);
    if (!total) continue;
    const kept = all.filter(([, a]) => a.impressions >= MIN_PAGE_IMPRESSIONS && a.impressions / total >= MIN_PAGE_SHARE);
    if (kept.length < 2) continue;
    const pages: CannibalPage[] = kept
      .map(([key, a]) => ({
        url: a.url,
        title: ctx.titles?.get(key) ?? null,
        clicks: a.clicks,
        impressions: a.impressions,
        position: a.impressions ? round1(a.posSum / a.impressions) : null,
        share: a.impressions / total,
        seen: null,
        zones: [],
        main: false,
      }))
      .sort(byMain);
    pages[0].main = true;
    const fix = chooseFix(g.query, pages[0], pages[1], { brand: ctx.brand, places });
    out.push({
      query: g.query,
      source: "gsc",
      severity: fix.fix === "zones" ? "baja" : gscSeverity(pages, total),
      totalImpressions: total,
      totalClicks: all.reduce((s, [, a]) => s + a.clicks, 0),
      checks: null,
      pages,
      ...fix,
    });
  }
  return out;
}

// ---------- 2. Posiciones ----------

/**
 * Palabras seguidas donde Google mostró distintas páginas tuyas en los últimos 30 días (en distintas revisiones o zonas,
 * o dos a la vez). Es una señal más suave: "Google no se decide entre dos de tus páginas".
 */
export function rankCannibals(reports: RankReport[], ctx: CannibalCtx & { domain: string; now?: Date; days?: number }): CannibalIssue[] {
  const places = ctx.places ?? placeList();
  const since = (ctx.now ?? new Date()).getTime() - (ctx.days ?? RANK_WINDOW_DAYS) * 86_400_000;
  type Acc = { url: string; seen: number; best: number | null; zones: Set<string>; last: number };
  const byKw = new Map<string, { keyword: string; checks: number; pages: Map<string, Acc> }>();
  for (const r of reports) {
    const when = Date.parse(r.createdAt);
    if (!(when >= since)) continue;
    for (const row of r.rows) {
      if (row.error || isBrand(row.keyword, ctx.brand)) continue;
      const mine = new Map<string, { url: string; position: number | null }>();
      if (row.url) mine.set(pageKey(row.url), { url: cleanUrl(row.url), position: row.position });
      for (const t of row.top)
        if (ctx.domain && domainMatches(t.domain || t.url, ctx.domain) && t.url && !mine.has(pageKey(t.url))) mine.set(pageKey(t.url), { url: cleanUrl(t.url), position: t.position });
      if (!mine.size) continue;
      const k = norm(row.keyword);
      let g = byKw.get(k);
      if (!g) byKw.set(k, (g = { keyword: row.keyword, checks: 0, pages: new Map() }));
      g.checks++;
      for (const [key, m] of mine) {
        let a = g.pages.get(key);
        if (!a) g.pages.set(key, (a = { url: m.url, seen: 0, best: null, zones: new Set(), last: 0 }));
        a.seen++;
        if (m.position !== null && m.position > 0 && (a.best === null || m.position < a.best)) a.best = m.position;
        if (r.location) a.zones.add(r.location);
        if (when >= a.last) {
          a.last = when;
          a.url = m.url;
        }
      }
    }
  }

  const out: CannibalIssue[] = [];
  for (const g of byKw.values()) {
    if (g.pages.size < 2) continue;
    const pages: CannibalPage[] = [...g.pages.entries()]
      .map(([key, a]) => ({
        url: a.url,
        title: ctx.titles?.get(key) ?? null,
        clicks: null,
        impressions: null,
        position: a.best,
        share: a.seen / g.checks,
        seen: a.seen,
        zones: [...a.zones],
        main: false,
      }))
      .sort(byMain);
    pages[0].main = true;
    const fix = chooseFix(g.keyword, pages[0], pages[1], { brand: ctx.brand, places });
    const steady = pages.filter((p) => (p.seen ?? 0) >= 2 && p.position !== null && p.position <= 20).length >= 2;
    out.push({
      query: g.keyword,
      source: "rank",
      severity: fix.fix !== "zones" && steady ? "media" : "baja",
      totalImpressions: null,
      totalClicks: null,
      checks: g.checks,
      pages,
      ...fix,
    });
  }
  return out;
}

// ---------- 3. Revisión de la página ----------

/** La parte útil de un título: "Cortinas metálicas | FAMESEG" → "Cortinas metálicas". */
const titleCore = (s: string) => s.split(/\s[|–—-]\s/)[0]?.trim() || s.trim();

/** Páginas con el mismo título o H1 (o casi): posible competencia entre páginas. */
export function auditCannibals(audit: Pick<AuditReport, "pages" | "site">, ctx: CannibalCtx & { skip?: CannibalIssue[] }): CannibalIssue[] {
  const places = ctx.places ?? placeList();
  const seen = new Set<string>();
  const pages = audit.pages.filter((p) => {
    const url = p.finalUrl || p.url;
    const key = pageKey(url);
    if (p.error || p.status !== 200 || p.noindex || !/^https?:\/\//i.test(url) || /[?#]/.test(url) || /\/page\/\d+\/?$/i.test(url) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sig = pages.map((p) => ({
    page: p,
    url: cleanUrl(p.finalUrl || p.url),
    title: topicStems(p.title, ctx.brand, []),
    h1: topicStems(p.h1, ctx.brand, []),
  }));
  // Grupos: dos páginas van juntas si su título o su H1 se parecen en 80 % o más (con al menos 2 palabras con significado).
  const parent = sig.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const similar = (a: Set<string>, b: Set<string>) => a.size >= 2 && b.size >= 2 && jaccard(a, b) >= 0.8;
  for (let i = 0; i < sig.length; i++)
    for (let j = i + 1; j < sig.length; j++) if (similar(sig[i].title, sig[j].title) || similar(sig[i].h1, sig[j].h1)) parent[find(j)] = find(i);
  const groups = new Map<number, typeof sig>();
  sig.forEach((s, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), s]));

  const covered = (ctx.skip ?? []).map((x) => new Set(x.pages.map((p) => pageKey(p.url))));
  const out: CannibalIssue[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const keys = g.map((s) => pageKey(s.url));
    if (covered.some((c) => keys.every((k) => c.has(k)))) continue;
    // Sin datos de Google: la principal es la de inicio o la de dirección más corta.
    const list = [...g].sort((a, b) => Number(isHome(b.url)) - Number(isHome(a.url)) || depth(a.url) - depth(b.url) || a.url.length - b.url.length).slice(0, MAX_AUDIT_GROUP);
    const cps: CannibalPage[] = list.map((s, i) => ({
      url: s.url,
      title: s.page.title || null,
      clicks: null,
      impressions: null,
      position: null,
      share: null,
      seen: null,
      zones: [],
      main: i === 0,
    }));
    const main = list[0].page;
    const query = titleCore(similar(list[0].h1, list[1].h1) && main.h1 ? main.h1 : main.title || main.h1);
    const pm = placeOf(cps[0], places);
    const po = placeOf(cps[1], places);
    const fix: Pick<CannibalIssue, "fix" | "anchor" | "places"> =
      pm && po && pm !== po ? { fix: "zones", anchor: null, places: [pm, po] } : { fix: "retarget", anchor: null, places: [] };
    out.push({ query, source: "audit", severity: "baja", totalImpressions: null, totalClicks: null, checks: null, pages: cps, ...fix });
    if (out.length >= MAX_AUDIT_ISSUES) break;
  }
  return out;
}

// ---------- Todo junto ----------

const SEVERITY_ORDER: Record<CannibalSeverity, number> = { alta: 0, media: 1, baja: 2 };
const SOURCE_ORDER: Record<CannibalSource, number> = { gsc: 0, rank: 1, audit: 2 };

export function sortIssues(issues: CannibalIssue[]): CannibalIssue[] {
  return [...issues].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
      (b.totalImpressions ?? 0) - (a.totalImpressions ?? 0) ||
      (b.checks ?? 0) - (a.checks ?? 0) ||
      b.pages.length - a.pages.length ||
      a.query.localeCompare(b.query),
  );
}

export type CannibalInput = {
  businessName: string;
  website: string;
  zones?: { name: string; type?: string }[];
  /** Pares página + búsqueda del último reporte de Search Console (null = no hay Search Console). */
  gsc: { pageQueries: GscPageQuery[]; range: GscRange } | null;
  ranks: RankReport[];
  audit: Pick<AuditReport, "pages" | "site"> | null;
  now?: Date;
};

/** Arma la revisión: Search Console si hay pares página + búsqueda; si no, las posiciones; y siempre la revisión de la página. */
export function buildCannibal(input: CannibalInput): CannibalReport {
  const domain = siteDomain(input.website);
  const brand = [input.businessName, domain.split(".")[0] ?? ""].filter((x) => x.trim().length >= 3);
  const places = placeList(input.zones);
  const titles = new Map<string, string>();
  for (const p of input.audit?.pages ?? []) if (p.title && !p.error) titles.set(pageKey(p.finalUrl || p.url), p.title);
  const ctx: CannibalCtx = { brand, titles, places };

  let source: CannibalSource | null = null;
  let main: CannibalIssue[] = [];
  if (input.gsc && input.gsc.pageQueries.length) {
    source = "gsc";
    main = gscCannibals(input.gsc.pageQueries, ctx);
  } else if (input.ranks.length) {
    source = "rank";
    main = rankCannibals(input.ranks, { ...ctx, domain, now: input.now });
  }
  const extra = input.audit ? auditCannibals(input.audit, { ...ctx, skip: main }) : [];
  if (!source && input.audit) source = "audit";
  return {
    version: 1,
    issues: sortIssues([...main, ...extra]).slice(0, MAX_ISSUES),
    source,
    gscRange: source === "gsc" && input.gsc ? input.gsc.range : null,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

/** Clave para comparar una búsqueda entre revisiones. */
export const issueKey = (i: Pick<CannibalIssue, "query" | "source">) => `${i.source}:${norm(i.query)}`;

/** Qué cambió desde la revisión guardada anterior. */
export function compareCannibal(current: CannibalReport, previous: CannibalReport | null): { added: number; solved: number } {
  if (!previous) return { added: current.issues.length, solved: 0 };
  const before = new Set(previous.issues.map(issueKey));
  const now = new Set(current.issues.map(issueKey));
  return { added: [...now].filter((k) => !before.has(k)).length, solved: [...before].filter((k) => !now.has(k)).length };
}

// ---------- Leer revisiones guardadas ----------

const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pick = <K extends string>(v: unknown, list: readonly K[], fallback: K): K => (list.includes(v as K) ? (v as K) : fallback);

/** Una revisión guardada (SeoReport kind "cannibal"), sin confiar en su forma. null si no lo parece. */
export function readCannibalReport(json: unknown): CannibalReport | null {
  const d = o(json);
  if (!Array.isArray(d.issues)) return null;
  const issues: CannibalIssue[] = d.issues.flatMap((x) => {
    const i = o(x);
    const query = s(i.query).trim();
    const pages: CannibalPage[] = (Array.isArray(i.pages) ? i.pages : [])
      .map(o)
      .filter((p) => s(p.url))
      .map((p) => ({
        url: s(p.url),
        title: s(p.title) || null,
        clicks: n(p.clicks),
        impressions: n(p.impressions),
        position: n(p.position),
        share: n(p.share),
        seen: n(p.seen),
        zones: Array.isArray(p.zones) ? p.zones.filter((z): z is string => typeof z === "string") : [],
        main: p.main === true,
      }));
    if (!query || pages.length < 2) return [];
    if (!pages.some((p) => p.main)) pages[0].main = true;
    return [
      {
        query,
        source: pick(i.source, ["gsc", "rank", "audit"] as const, "gsc"),
        severity: pick(i.severity, ["alta", "media", "baja"] as const, "baja"),
        totalImpressions: n(i.totalImpressions),
        totalClicks: n(i.totalClicks),
        checks: n(i.checks),
        pages,
        fix: pick(i.fix, ["merge", "retarget", "link", "zones"] as const, "retarget"),
        anchor: s(i.anchor) || null,
        places: Array.isArray(i.places) ? i.places.filter((z): z is string => typeof z === "string") : [],
      },
    ];
  });
  const r = o(d.gscRange);
  const created = s(d.createdAt);
  return {
    version: 1,
    issues,
    source: d.source === null || d.source === undefined ? null : pick(d.source, ["gsc", "rank", "audit"] as const, "gsc"),
    gscRange: s(r.start) && s(r.end) ? { start: s(r.start), end: s(r.end) } : null,
    createdAt: created && !Number.isNaN(Date.parse(created)) ? created : new Date(0).toISOString(),
  };
}

// ---------- Textos (para el panel, el resumen, el correo y el PDF) ----------

const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") || url;
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

export function severityLabel(sev: CannibalSeverity, t: T): string {
  return sev === "alta" ? t("Urgente", "Urgent") : sev === "media" ? t("Conviene arreglar", "Worth fixing") : t("Leve", "Minor");
}

/** Por qué se marcó, en una frase. */
export function issueWhy(issue: CannibalIssue, t: T): string {
  const n = issue.pages.length;
  if (issue.source === "gsc")
    return t(
      `${n} de tus páginas salen en Google para esta búsqueda y se reparten las visitas.`,
      `${n} of your pages show up on Google for this search and split the visits.`,
    );
  if (issue.source === "rank")
    return t(
      `Google no se decide entre ${n === 2 ? "dos" : n} de tus páginas: en las revisiones de los últimos ${RANK_WINDOW_DAYS} días la página que sale cambia.`,
      `Google can't decide between ${n === 2 ? "two" : n} of your pages: in the checks from the last ${RANK_WINDOW_DAYS} days the page that shows up changes.`,
    );
  return t(
    "Posible competencia entre páginas: tienen el mismo título o encabezado (o casi), así que Google no sabe cuál mostrar.",
    "Possible competition between pages: they have the same (or almost the same) title or heading, so Google doesn't know which one to show.",
  );
}

/** Qué hacer, en palabras simples. */
export function fixText(issue: CannibalIssue, t: T): string {
  const main = issue.pages.find((p) => p.main) ?? issue.pages[0];
  const other = issue.pages.find((p) => p !== main) ?? issue.pages[1];
  const m = shortUrl(main.url);
  const x = shortUrl(other.url);
  const more = issue.pages.length > 2 ? t(` (y lo mismo con las otras ${issue.pages.length - 2})`, ` (and the same with the other ${issue.pages.length - 2})`) : "";
  switch (issue.fix) {
    case "merge":
      return t(
        `Une las dos páginas en una y redirige la otra (301): pasa lo mejor de ${x} a ${m} y haz que ${x} mande a ${m}${more}.`,
        `Merge both pages into one and redirect the other (301): move the best parts of ${x} into ${m} and make ${x} send visitors to ${m}${more}.`,
      );
    case "link":
      return t(
        `Enlaza desde la página secundaria a la principal con el texto «${issue.anchor ?? issue.query}»: en ${x}, agrega un enlace a ${m}${more}.`,
        `Link from the secondary page to the main one with the text “${issue.anchor ?? issue.query}”: on ${x}, add a link to ${m}${more}.`,
      );
    case "zones": {
      const [a, b] = issue.places.map(cap);
      return t(
        `Si son para zonas distintas (${a ?? "una ciudad"} y ${b ?? "otra"}), está bien: haz que cada título diga su ciudad para que Google muestre la correcta.`,
        `If they're for different areas (${a ?? "one city"} and ${b ?? "another"}), that's fine: make each title say its city so Google shows the right one.`,
      );
    }
    default:
      return t(
        `Deja ${m} como la página principal para «${issue.query}» y cambia el título y el tema de ${x} hacia otra búsqueda${more}.`,
        `Keep ${m} as the main page for “${issue.query}” and change the title and topic of ${x} to a different search${more}.`,
      );
  }
}

/** Una línea para resúmenes (plain.ts, correo semanal, PDF). */
export function cannibalSummary(report: CannibalReport | null, t: T): string | null {
  if (!report || !report.source) return null;
  const urgent = report.issues.filter((i) => i.severity === "alta").length;
  const total = report.issues.length;
  if (!total) return t("Ninguna de tus páginas compite con otra por la misma búsqueda. ¡Bien!", "None of your pages compete with each other for the same search. Nice!");
  const top = report.issues[0];
  return t(
    `${total} ${total === 1 ? "búsqueda tiene" : "búsquedas tienen"} varias páginas tuyas compitiendo${urgent ? ` (${urgent} urgente${urgent === 1 ? "" : "s"})` : ""}. La primera: «${top.query}».`,
    `${total} ${total === 1 ? "search has" : "searches have"} several of your pages competing${urgent ? ` (${urgent} urgent)` : ""}. First one: “${top.query}”.`,
  );
}

// ---------- Leer de la base de datos y guardar ----------

/** Lo que hace falta del negocio y los últimos reportes guardados (sin llamar a ninguna API). */
export async function loadCannibalInput(businessId: string, now = new Date()): Promise<(CannibalInput & { hasGsc: boolean; gscOld: boolean }) | null> {
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true },
  });
  if (!b) return null;
  const since = new Date(now.getTime() - RANK_WINDOW_DAYS * 86_400_000);
  const [gscRows, rankRows, auditRows] = await Promise.all([
    db.seoReport.findMany({ where: { businessId, kind: "gsc" }, orderBy: { createdAt: "desc" }, take: 1 }),
    db.seoReport.findMany({ where: { businessId, kind: "rank", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.seoReport.findMany({ where: { businessId, kind: "audit" }, orderBy: { createdAt: "desc" }, take: 1 }),
  ]);
  const gsc = gscRows[0] ? asGscReport(gscRows[0].data) : null;
  const ranks = rankRows.flatMap((r) => {
    const rep = readRankReport(r.data);
    // Reportes viejos sin fecha: se usa la de la fila.
    return rep ? [{ ...rep, createdAt: Date.parse(rep.createdAt) > 0 ? rep.createdAt : r.createdAt.toISOString() }] : [];
  });
  const audit = auditRows[0] ? readAuditReport(auditRows[0].data) : null;
  return {
    businessName: b.name,
    website: b.website,
    zones: readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName),
    gsc: gsc ? { pageQueries: gsc.pageQueries, range: gsc.range } : null,
    ranks,
    audit,
    now,
    hasGsc: Boolean(gsc),
    gscOld: Boolean(gsc && !gsc.pageQueries.length),
  };
}

/** Las últimas revisiones guardadas (la más nueva primero). */
export async function latestCannibalReports(businessId: string, take = 1) {
  const rows = await db.seoReport.findMany({ where: { businessId, kind: CANNIBAL_KIND }, orderBy: { createdAt: "desc" }, take });
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt, report: readCannibalReport(r.data) }));
}

/** Guarda una revisión y borra las más viejas (quedan las últimas 10). */
export async function saveCannibalReport(businessId: string, report: CannibalReport) {
  const row = await db.seoReport.create({ data: { businessId, kind: CANNIBAL_KIND, data: report as unknown as Prisma.InputJsonValue } });
  const old = await db.seoReport.findMany({
    where: { businessId, kind: CANNIBAL_KIND },
    orderBy: { createdAt: "desc" },
    skip: MAX_CANNIBAL_REPORTS,
    select: { id: true },
  });
  if (old.length) await db.seoReport.deleteMany({ where: { id: { in: old.map((x) => x.id) } } });
  return row;
}
