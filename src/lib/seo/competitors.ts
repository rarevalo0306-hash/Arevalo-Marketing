// Tu competencia en Google (DataForSEO Labs, pago por uso).
// 1) Busca competidores: los que DataForSEO ve compitiendo por las mismas búsquedas (todo el país), los que salen
//    arriba en tus palabras clave del seguimiento de posiciones (tu zona) y los que el dueño escribe.
// 2) Para ti y los 3 primeros: las búsquedas por las que salen en Google (con volumen) y sus visitas estimadas.
// 3) Oportunidades: búsquedas donde ellos están en la primera página y tú no apareces (o estás después del 20).
// DataForSEO Labs solo acepta países (docs.dataforseo.com/v3/dataforseo_labs/locations_and_languages): si la zona
// del negocio es una ciudad o un estado, se usa su país. Con varias zonas se usa el país de la zona principal
// (una sola corrida, mismo costo); los competidores locales salen de las posiciones de TODAS las zonas.
import { bi } from "@/lib/i18n";
import { dfsGet, dfsPost, type Zone } from "@/lib/seo/dataforseo";

export type CompetitorSource = "labs" | "serp" | "owner";

export type RankedKeyword = { keyword: string; position: number; volume: number | null; url: string };

export type DomainStats = {
  domain: string;
  /** Búsquedas por las que sale en Google (en el país). */
  keywords: number | null;
  /** Visitas al mes estimadas desde Google (en el país). */
  traffic: number | null;
  /** Búsquedas que comparte contigo según DataForSEO. */
  overlap: number | null;
  top: RankedKeyword[];
};

export type Competitor = DomainStats & {
  source: CompetitorSource;
  /** En cuántas de tus palabras clave del seguimiento sale en el top 5 (tu zona). */
  serpHits: number | null;
  /** Si se pidieron sus búsquedas (solo los 3 primeros). */
  analyzed: boolean;
};

export type GapKeyword = { keyword: string; volume: number | null; bestCompetitor: string; competitorPosition: number; yourPosition: number | null };

export type CompetitorsLocation = {
  /** La zona del negocio (puede ser ciudad). */
  code: number | null;
  name: string;
  /** La zona del negocio es más chica que un país: los datos de competencia son de todo el país. */
  local: boolean;
  countryCode: number;
  countryName: string;
  countryIso: string;
  language: string;
};

export type BiText = { es: string; en: string };

export type CompetitorsReport = {
  domain: string;
  location: CompetitorsLocation;
  competitors: Competitor[];
  you: DomainStats;
  gap: GapKeyword[];
  /** Sitios que escribió el dueño en la última corrida. */
  ownerDomains: string[];
  /** Cuántas palabras del seguimiento de posiciones se usaron para buscar competidores. */
  rankKeywords: number;
  notes: BiText[];
  cost: number;
  createdAt: string;
};

/**
 * Directorios, redes sociales, buscadores, mapas, clasificados y marketplaces: salen arriba en todo, pero no son
 * competencia directa. Se comparan con cada parte del dominio menos la terminación, así que cubren cualquier país
 * (yelp.com, m.facebook.com, google.com.mx, paginasamarillas.com.ni, es.cybo.com, encuentra24.com…).
 */
export const DIRECTORY_SITES = [
  // Redes sociales y videos
  "facebook",
  "instagram",
  "youtube",
  "tiktok",
  "linkedin",
  "twitter",
  "pinterest",
  "reddit",
  "quora",
  "whatsapp",
  "telegram",
  "snapchat",
  "nextdoor",
  // Buscadores, mapas y grandes plataformas
  "google",
  "bing",
  "yahoo",
  "apple",
  "amazon",
  "waze",
  "mapquest",
  "foursquare",
  "wikipedia",
  "wikiwand",
  "fandom",
  "blogspot",
  "wordpress",
  "wixsite",
  // Directorios y reseñas (EE. UU.)
  "yelp",
  "angi",
  "angieslist",
  "bbb",
  "thumbtack",
  "homeadvisor",
  "yellowpages",
  "superpages",
  "manta",
  "houzz",
  "porch",
  "bark",
  "chamberofcommerce",
  "birdeye",
  "tripadvisor",
  "trustpilot",
  "buildzoom",
  "expertise",
  "brownbook",
  "hotfrog",
  "cylex",
  "infobel",
  "tuugo",
  "find-us-here",
  "storeboard",
  "kompass",
  "europages",
  // Directorios y clasificados de Latinoamérica y España
  "paginasamarillas",
  "amarillas",
  "paginas-amarillas",
  "guiamais",
  "encuentra24",
  "diredi",
  "cybo",
  "starofservice",
  "findglocal",
  "infoisinfo",
  "habitissimo",
  "cronoshare",
  "doctoralia",
  "nicaraguacompanies",
  "empresite",
  "infoempresas",
  "guialocal",
  "guiaempresas",
  "dondeir",
  "clasificados",
  // Marketplaces y empleo
  "mercadolibre",
  "mercadolivre",
  "olx",
  "ebay",
  "etsy",
  "alibaba",
  "aliexpress",
  "temu",
  "craigslist",
  "indeed",
  "glassdoor",
  "computrabajo",
  "tecoloco",
  "bumeran",
  // Noticias
  "laprensani",
  "elnuevodiario",
  "confidencial",
  "100noticias",
  "articulo66",
  "despacho505",
  "elpais",
  "infobae",
  "cnn",
  "bbc",
  "nytimes",
] as const;

const DIRECTORY_SET = new Set<string>(DIRECTORY_SITES);
/** Gobierno, ejército y universidades: .gov, .gob.ni, .gov.uk, .gub.uy, .gouv.fr, .mil, .edu, .edu.ni. */
const PUBLIC_LABELS = new Set(["gov", "gob", "gub", "gouv", "govt", "mil", "edu"]);
/** Sitios de noticias por su nombre ("noticiasdenicaragua.com", "miaminews.com", "diariolibre.com"). */
const NEWS_RE = /noticia|periodico|diario|^news|news$/;

// ---------- Ayudantes puros ----------

/** "https://www.Ejemplo.com/contacto" → "ejemplo.com". Devuelve null si no parece un dominio. */
export function normalizeDomain(input: string): string | null {
  let s = String(input ?? "").trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#\s]/)[0] ?? "";
  s = s.replace(/^[^@]*@/, "").replace(/:\d*$/, "").replace(/\.$/, "");
  if (!s) return null;
  try {
    s = new URL(`http://${s}`).hostname; // dominios con acentos → punycode
  } catch {
    return null;
  }
  s = s.replace(/^www\d*\./, "");
  if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(s)) return null;
  return s;
}

/** El mismo sitio (o un subdominio de él). */
export function sameSite(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Directorios, redes sociales, buscadores, marketplaces, gobierno y noticias: no son competencia directa
 * (yelp.com, m.facebook.com, google.com.mx, es.wikipedia.org, paginasamarillas.com.ni, minsa.gob.ni, usa.gov…).
 * Acepta un dominio o una dirección completa.
 */
export function isDirectory(domain: string): boolean {
  const d = normalizeDomain(domain) ?? String(domain ?? "").trim().toLowerCase();
  const labels = d.split(".").filter(Boolean);
  if (labels.length < 2) return false;
  if (labels.slice(0, -1).some((l) => DIRECTORY_SET.has(l))) return true;
  // La terminación del gobierno o de una universidad: .gov, .gob.ni, .gov.uk, .edu.ni; o el portal mismo (gov.uk, gob.mx).
  if (labels.slice(1).some((l) => PUBLIC_LABELS.has(l))) return true;
  if (labels.length === 2 && PUBLIC_LABELS.has(labels[0]) && labels[1].length === 2) return true;
  return NEWS_RE.test(brandToken(d));
}
/** El nombre del sitio sin terminación: "joesplumbing.co.uk" → "joesplumbing". */
export function brandToken(domain: string): string {
  const labels = domain.split(".");
  let i = labels.length - 2;
  if (i > 0 && labels[i].length <= 3 && ["co", "com", "net", "org", "gov", "edu", "ac"].includes(labels[i])) i--;
  return (labels[Math.max(0, i)] ?? "").replace(/[^a-z0-9]/g, "");
}

/** La búsqueda es el nombre de ese sitio (no es una oportunidad: buscan a esa empresa). */
export function isBranded(keyword: string, domain: string): boolean {
  const token = brandToken(domain);
  if (token.length < 4) return false;
  const compact = keyword
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
  return compact.includes(token);
}

/** Varios sitios escritos por el dueño (separados por coma, espacio o renglón): normalizados, sin repetir, máx. `max`. */
export function parseOwnerDomains(text: string, self: string | null, max = 3): string[] {
  const out: string[] = [];
  for (const part of String(text ?? "").split(/[\s,;]+/)) {
    const d = normalizeDomain(part);
    if (!d || (self && sameSite(d, self)) || out.some((o) => sameSite(o, d))) continue;
    out.push(d);
    if (out.length >= max) break;
  }
  return out;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Una fila del seguimiento de posiciones: la búsqueda y los dominios de arriba, en orden. */
export type RankRow = { keyword: string; domains: string[] };

/**
 * Lee el último reporte de posiciones ("rank") sin depender de su forma exacta:
 * busca filas con `keyword` y una lista de resultados (dominio o url, con posición si la hay).
 */
export function readRankRows(json: unknown): RankRow[] {
  const root = obj(json);
  const list = [root.rows, root.keywords, root.items, root.results].find(Array.isArray) ?? (Array.isArray(json) ? json : []);
  const rows: RankRow[] = [];
  for (const raw of list as unknown[]) {
    const r = obj(raw);
    const keyword = str(r.keyword).trim();
    if (!keyword) continue;
    const results = [r.top, r.results, r.organic, r.serp, r.items, r.competitors].find(Array.isArray) ?? [];
    const entries = (results as unknown[])
      .map((e, i) => {
        if (typeof e === "string") return { domain: normalizeDomain(e), pos: i + 1 };
        const o = obj(e);
        const domain = normalizeDomain(str(o.domain) || str(o.url));
        const pos = num(o.position) ?? num(o.rank) ?? num(o.rank_group) ?? num(o.rankGroup) ?? i + 1;
        return { domain, pos };
      })
      .filter((e): e is { domain: string; pos: number } => Boolean(e.domain))
      .sort((a, b) => a.pos - b.pos);
    rows.push({ keyword, domains: entries.map((e) => e.domain) });
  }
  return rows;
}

/** Las filas de varios reportes de posiciones (uno por zona), juntas. */
export function readRankRowsMany(jsons: unknown[]): RankRow[] {
  return jsons.flatMap((j) => readRankRows(j));
}

/** Cuántas búsquedas distintas hay entre las filas (la misma palabra en dos zonas cuenta una vez). */
export function distinctKeywords(rows: RankRow[]): number {
  return new Set(rows.map((r) => r.keyword.trim().toLowerCase())).size;
}

/**
 * En cuántas de tus búsquedas sale cada dominio en el top `topN` (sin ti ni directorios).
 * Con varias zonas, cada búsqueda cuenta una vez aunque salga arriba en varias zonas.
 */
export function serpCandidates(rows: RankRow[], self: string, topN = 5): { domain: string; hits: number }[] {
  const hits = new Map<string, Set<string>>();
  for (const row of rows) {
    const keyword = row.keyword.trim().toLowerCase();
    const seen = new Set<string>();
    for (const d of row.domains.slice(0, topN)) {
      if (sameSite(d, self) || isDirectory(d) || [...seen].some((s) => sameSite(s, d))) continue;
      seen.add(d);
      hits.set(d, (hits.get(d) ?? new Set<string>()).add(keyword));
    }
  }
  return [...hits].map(([domain, set]) => ({ domain, hits: set.size })).sort((a, b) => b.hits - a.hits || a.domain.localeCompare(b.domain));
}

/** El país de una zona: la zona misma si es un país, o lo último del nombre ("Miami,Florida,United States"). */
export function zoneCountry(zone: Pick<Zone, "name" | "type">): string {
  if (zone.type === "Country") return zone.name.trim();
  return zone.name.split(",").pop()?.trim() ?? "";
}

/** Los países de las zonas, sin repetir y en orden (el primero es el de la zona principal). */
export function distinctCountries(zones: Pick<Zone, "name" | "type">[]): string[] {
  const out: string[] = [];
  for (const z of zones) {
    const c = zoneCountry(z);
    if (c && !out.some((o) => o.toLowerCase() === c.toLowerCase())) out.push(c);
  }
  return out;
}

export type LabsCompetitor = { domain: string; overlap: number | null; keywords: number | null; traffic: number | null };

export type Candidate = LabsCompetitor & { source: CompetitorSource; serpHits: number | null; score: number };

/**
 * Junta y ordena los candidatos: primero los que escribió el dueño; luego por qué tanto salen en tus búsquedas
 * locales (lo que más pesa) y cuántas búsquedas comparten en el país.
 */
export function mergeCandidates(input: { self: string; labs: LabsCompetitor[]; serp: { domain: string; hits: number }[]; owner: string[]; keep?: number }): Candidate[] {
  const { self, keep = 5 } = input;
  const byDomain = new Map<string, Candidate>();
  const find = (d: string) => [...byDomain.keys()].find((k) => sameSite(k, d));
  const ok = (d: string | null): d is string => Boolean(d) && !sameSite(d as string, self);

  const add = (domain: string, patch: Partial<Candidate>, source: CompetitorSource) => {
    const key = find(domain) ?? domain;
    const cur = byDomain.get(key) ?? { domain: key, overlap: null, keywords: null, traffic: null, serpHits: null, source, score: 0 };
    const rank: Record<CompetitorSource, number> = { owner: 3, serp: 2, labs: 1 };
    byDomain.set(key, { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null && v !== undefined)), source: rank[source] > rank[cur.source] ? source : cur.source });
  };

  for (const l of input.labs) {
    const d = normalizeDomain(l.domain);
    if (!ok(d) || isDirectory(d)) continue;
    add(d, { overlap: l.overlap, keywords: l.keywords, traffic: l.traffic }, "labs");
  }
  for (const s of input.serp) {
    const d = normalizeDomain(s.domain);
    if (!ok(d) || isDirectory(d) || s.hits <= 0) continue;
    add(d, { serpHits: s.hits }, "serp");
  }
  input.owner.forEach((o) => {
    const d = normalizeDomain(o);
    if (ok(d)) add(d, {}, "owner");
  });

  const all = [...byDomain.values()];
  const maxHits = Math.max(1, ...all.map((c) => c.serpHits ?? 0));
  const maxOverlap = Math.max(1, ...all.map((c) => c.overlap ?? 0));
  const ownerOrder = input.owner.map((o) => normalizeDomain(o));
  for (const c of all) {
    c.score = c.source === "owner" ? 10 - ownerOrder.findIndex((o) => o && sameSite(o, c.domain)) : 0.6 * ((c.serpHits ?? 0) / maxHits) + 0.4 * ((c.overlap ?? 0) / maxOverlap);
  }
  return all.sort((a, b) => b.score - a.score || (b.traffic ?? 0) - (a.traffic ?? 0) || a.domain.localeCompare(b.domain)).slice(0, keep);
}

/**
 * Oportunidades: búsquedas donde un competidor está en el top 10 y tú no sales (o estás después del 20).
 * Se quitan las búsquedas con el nombre de un competidor. Ordenadas por volumen.
 */
export function computeGap(you: RankedKeyword[], competitors: { domain: string; top: RankedKeyword[] }[], limit = 30): GapKeyword[] {
  const mine = new Map<string, number>();
  for (const k of you) {
    const key = k.keyword.trim().toLowerCase();
    const prev = mine.get(key);
    if (prev === undefined || k.position < prev) mine.set(key, k.position);
  }
  const gap = new Map<string, GapKeyword>();
  for (const c of competitors) {
    for (const k of c.top) {
      const key = k.keyword.trim().toLowerCase();
      if (!key || k.position < 1 || k.position > 10) continue;
      if (competitors.some((o) => isBranded(key, o.domain))) continue;
      const yours = mine.get(key) ?? null;
      if (yours !== null && yours <= 20) continue;
      const cur = gap.get(key);
      const volume = cur?.volume == null ? k.volume : k.volume == null ? cur.volume : Math.max(cur.volume, k.volume);
      if (!cur || k.position < cur.competitorPosition) gap.set(key, { keyword: key, volume, bestCompetitor: c.domain, competitorPosition: k.position, yourPosition: yours });
      else cur.volume = volume;
    }
  }
  return [...gap.values()].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || a.competitorPosition - b.competitorPosition || a.keyword.localeCompare(b.keyword)).slice(0, limit);
}

/**
 * Para mostrar un reporte guardado: quita los directorios, redes y marketplaces (Páginas Amarillas, Facebook…)
 * que se colaron como competidores en corridas viejas, y las búsquedas que solo ellos ganaban.
 * Los que agregó el dueño se quedan aunque parezcan directorio. `hidden` dice cuáles se quitaron.
 */
export function withoutDirectories(report: CompetitorsReport): { report: CompetitorsReport; hidden: string[] } {
  const hidden = report.competitors.filter((c) => c.source !== "owner" && isDirectory(c.domain)).map((c) => c.domain);
  if (!hidden.length) return { report, hidden };
  const gone = (d: string) => hidden.some((h) => sameSite(h, d));
  return {
    report: { ...report, competitors: report.competitors.filter((c) => !gone(c.domain)), gap: report.gap.filter((g) => !gone(g.bestCompetitor)) },
    hidden,
  };
}

// ---------- Lectura de respuestas de DataForSEO ----------

/** competitors_domain: items[] con domain, intersections y full_domain_metrics.organic (count, etv). */
export function parseLabsCompetitors(result: unknown[]): LabsCompetitor[] {
  const items = arr(obj(result[0]).items);
  return items
    .map((raw) => {
      const it = obj(raw);
      const organic = obj(obj(it.full_domain_metrics).organic);
      return { domain: str(it.domain), overlap: num(it.intersections) ?? num(obj(obj(it.metrics).organic).count), keywords: num(organic.count), traffic: num(organic.etv) };
    })
    .filter((c) => c.domain);
}

/** ranked_keywords: metrics.organic (count, etv) y items[] con keyword_data y ranked_serp_element.serp_item. */
export function parseRankedKeywords(result: unknown[]): { keywords: number | null; traffic: number | null; top: RankedKeyword[] } {
  const r = obj(result[0]);
  const organic = obj(obj(r.metrics).organic);
  const top: RankedKeyword[] = [];
  for (const raw of arr(r.items)) {
    const it = obj(raw);
    const kd = obj(it.keyword_data);
    const serp = obj(obj(it.ranked_serp_element).serp_item);
    const keyword = str(kd.keyword).trim().toLowerCase();
    const position = num(serp.rank_group) ?? num(serp.rank_absolute);
    if (!keyword || position === null) continue;
    top.push({ keyword, position, volume: num(obj(kd.keyword_info).search_volume), url: str(serp.url) });
  }
  return { keywords: num(organic.count) ?? num(r.total_count), traffic: num(organic.etv), top };
}

export type LabsCountry = { code: number; name: string; iso: string; languages: string[] };

/** El país de DataForSEO Labs para la zona del negocio: la misma zona si es país, o el país al final del nombre ("Miami,Florida,United States"). */
export function pickCountry(countries: LabsCountry[], code: number | null, name: string): LabsCountry | null {
  if (code !== null) {
    const exact = countries.find((c) => c.code === code);
    if (exact) return exact;
  }
  const last = name.split(",").pop()?.trim().toLowerCase();
  return (last && countries.find((c) => c.name.toLowerCase() === last)) || null;
}

/** El idioma pedido si el país lo tiene en Labs; si no, el primero que tenga. */
export function pickLanguage(country: LabsCountry, wanted: string): string {
  return country.languages.includes(wanted) ? wanted : (country.languages[0] ?? wanted);
}

/** Lee un reporte guardado; null si no tiene la forma esperada. */
export function readCompetitorsReport(json: unknown): CompetitorsReport | null {
  const r = obj(json);
  const domain = str(r.domain);
  const loc = obj(r.location);
  if (!domain || !Array.isArray(r.competitors) || !r.you || typeof r.you !== "object") return null;
  const readTop = (v: unknown): RankedKeyword[] =>
    arr(v)
      .map((raw) => {
        const k = obj(raw);
        return { keyword: str(k.keyword), position: num(k.position) ?? 0, volume: num(k.volume), url: str(k.url) };
      })
      .filter((k) => k.keyword && k.position > 0);
  const readStats = (v: unknown): DomainStats => {
    const s = obj(v);
    return { domain: str(s.domain), keywords: num(s.keywords), traffic: num(s.traffic), overlap: num(s.overlap), top: readTop(s.top) };
  };
  const sources: CompetitorSource[] = ["labs", "serp", "owner"];
  const competitors: Competitor[] = arr(r.competitors)
    .map((raw) => {
      const c = obj(raw);
      const source = sources.includes(c.source as CompetitorSource) ? (c.source as CompetitorSource) : "labs";
      return { ...readStats(c), source, serpHits: num(c.serpHits), analyzed: c.analyzed === true };
    })
    .filter((c) => c.domain);
  const you = readStats(r.you);
  const gap: GapKeyword[] = arr(r.gap)
    .map((raw) => {
      const g = obj(raw);
      return { keyword: str(g.keyword), volume: num(g.volume), bestCompetitor: str(g.bestCompetitor), competitorPosition: num(g.competitorPosition) ?? 0, yourPosition: num(g.yourPosition) };
    })
    .filter((g) => g.keyword && g.bestCompetitor);
  const notes: BiText[] = arr(r.notes)
    .map((n) => obj(n))
    .filter((n) => typeof n.es === "string" && typeof n.en === "string")
    .map((n) => ({ es: n.es as string, en: n.en as string }));
  return {
    domain,
    location: {
      code: num(loc.code),
      name: str(loc.name),
      local: loc.local === true,
      countryCode: num(loc.countryCode) ?? 0,
      countryName: str(loc.countryName),
      countryIso: str(loc.countryIso),
      language: str(loc.language) || "es",
    },
    competitors,
    you: { ...you, domain: you.domain || domain },
    gap,
    ownerDomains: arr(r.ownerDomains).filter((d): d is string => typeof d === "string"),
    rankKeywords: num(r.rankKeywords) ?? 0,
    notes,
    cost: num(r.cost) ?? 0,
    createdAt: str(r.createdAt),
  };
}

// ---------- Llamadas a DataForSEO ----------

let labsCountries: { at: number; list: LabsCountry[] } | null = null;
const adsIsoCache = new Map<number, string>();

/** Países de DataForSEO Labs (gratis; se guarda un día en memoria). */
async function loadLabsCountries(): Promise<LabsCountry[]> {
  if (labsCountries && Date.now() - labsCountries.at < 24 * 3600_000) return labsCountries.list;
  const r = await dfsGet<{ location_code: number; location_name: string; country_iso_code: string; available_languages?: { language_code: string }[] }>("/dataforseo_labs/locations_and_languages");
  const list = r.result.map((l) => ({
    code: l.location_code,
    name: l.location_name,
    iso: (l.country_iso_code ?? "").toUpperCase(),
    languages: (l.available_languages ?? []).map((x) => x.language_code),
  }));
  labsCountries = { at: Date.now(), list };
  return list;
}

/** El país (ISO) de una zona de Google Ads (ciudad, condado, estado). Gratis, lista completa. */
async function adsCountryIso(code: number): Promise<string | null> {
  if (adsIsoCache.has(code)) return adsIsoCache.get(code) ?? null;
  const r = await dfsGet<{ location_code: number; country_iso_code: string }>("/keywords_data/google_ads/locations", 90_000);
  const hit = r.result.find((l) => l.location_code === code);
  const iso = hit?.country_iso_code?.toUpperCase() ?? null;
  if (iso) adsIsoCache.set(code, iso);
  return iso;
}

export async function resolveLocation(code: number | null, name: string, language: string): Promise<CompetitorsLocation> {
  const countries = await loadLabsCountries();
  let country = pickCountry(countries, code, name);
  if (!country && code !== null) {
    const iso = await adsCountryIso(code);
    country = countries.find((c) => c.iso === iso) ?? null;
  }
  if (!country)
    throw bi(
      "DataForSEO no tiene datos de competencia para el país de tu zona. Revisa la zona en la configuración de DataForSEO.",
      "DataForSEO has no competitor data for your area's country. Check the area in the DataForSEO settings.",
    );
  return {
    code,
    name: name || country.name,
    local: country.code !== code,
    countryCode: country.code,
    countryName: country.name,
    countryIso: country.iso,
    language: pickLanguage(country, language),
  };
}

type RunInput = {
  website: string;
  locationCode: number | null;
  locationName: string;
  language: string;
  ownerDomains: string[];
  /** El último reporte de posiciones (kind "rank") de cada zona, tal cual se guardaron. */
  rankJsons: unknown[];
  /** Si una búsqueda tiene que ver con el negocio (isRelevantKeyword de gap.ts); las demás no se cuentan como oportunidad. */
  relevant?: (keyword: string) => boolean;
};

/** Hace la búsqueda completa: ~5 llamadas a DataForSEO Labs (unos USD 0.05 a 0.10). */
export async function runCompetitorsReport(input: RunInput): Promise<CompetitorsReport> {
  const self = normalizeDomain(input.website);
  if (!self) throw bi("La dirección de tu página web no parece válida. Revísala en Ajustes del negocio.", "Your website address doesn't look valid. Check it in Business settings.");
  const location = await resolveLocation(input.locationCode, input.locationName, input.language);
  const base = { location_code: location.countryCode, language_code: location.language };
  const notes: BiText[] = [];
  let cost = 0;

  if (location.language !== input.language)
    notes.push({
      es: `DataForSEO no tiene datos en ${input.language === "en" ? "inglés" : "español"} para ${location.countryName}; se usó "${location.language}".`,
      en: `DataForSEO has no ${input.language === "en" ? "English" : "Spanish"} data for ${location.countryName}; used "${location.language}".`,
    });

  const rows = readRankRowsMany(input.rankJsons);

  // 1) Competidores según DataForSEO (todo el país).
  let labs: LabsCompetitor[] = [];
  try {
    const r = await dfsPost<unknown>("/dataforseo_labs/google/competitors_domain/live", {
      target: self,
      ...base,
      item_types: ["organic"],
      exclude_top_domains: true,
      max_rank_group: 20,
      limit: 15, // ordenados por búsquedas en común (metrics.organic.count, el orden por defecto)
    });
    cost += r.cost;
    labs = parseLabsCompetitors(r.result);
  } catch (e) {
    notes.push({ es: "DataForSEO no pudo buscar competidores de tu dominio esta vez.", en: "DataForSEO couldn't look up your domain's competitors this time." });
    if (!input.ownerDomains.length && !rows.length) throw e;
  }

  // 2) Los que salen arriba en tus búsquedas locales y los que escribió el dueño.
  const serp = serpCandidates(rows, self, 5);
  const candidates = mergeCandidates({ self, labs, serp, owner: input.ownerDomains, keep: 5 });

  // 3) Tus búsquedas y las de los 3 primeros.
  const ranked = (target: string, competitor: boolean) =>
    dfsPost<unknown>("/dataforseo_labs/google/ranked_keywords/live", {
      target,
      ...base,
      item_types: ["organic"],
      limit: competitor ? 50 : 100,
      order_by: ["keyword_data.keyword_info.search_volume,desc"],
      ...(competitor ? { filters: ["ranked_serp_element.serp_item.rank_group", "<=", 10] } : {}),
    });

  // Las 4 llamadas van a la vez; si fallan todas (sin saldo, clave mala…) se avisa el error.
  const analyzed = candidates.slice(0, 3);
  const [mine, ...settled] = await Promise.allSettled([ranked(self, false), ...analyzed.map((c) => ranked(c.domain, true))]);
  if (mine.status === "rejected" && settled.every((x) => x.status === "rejected")) throw mine.reason;
  let youData: ReturnType<typeof parseRankedKeywords> = { keywords: null, traffic: null, top: [] };
  if (mine.status === "fulfilled") {
    cost += mine.value.cost;
    youData = parseRankedKeywords(mine.value.result);
  } else notes.push({ es: `No se pudieron leer las búsquedas de ${self}.`, en: `Couldn't read ${self}'s keywords.` });

  const competitors: Competitor[] = candidates.map((c, i) => {
    const s = i < analyzed.length ? settled[i] : null;
    if (s?.status === "fulfilled") {
      cost += s.value.cost;
      const d = parseRankedKeywords(s.value.result);
      return { domain: c.domain, source: c.source, serpHits: c.serpHits, overlap: c.overlap, keywords: d.keywords ?? c.keywords, traffic: d.traffic ?? c.traffic, top: d.top, analyzed: true };
    }
    if (s?.status === "rejected") notes.push({ es: `No se pudieron leer las búsquedas de ${c.domain}.`, en: `Couldn't read ${c.domain}'s keywords.` });
    return { domain: c.domain, source: c.source, serpHits: c.serpHits, overlap: c.overlap, keywords: c.keywords, traffic: c.traffic, top: [], analyzed: false };
  });

  // Coincidencias contigo cuando DataForSEO no las dio (búsquedas en común entre las leídas).
  const myKeys = new Set(youData.top.map((k) => k.keyword));
  if (mine.status === "fulfilled") for (const c of competitors) if (c.overlap === null && c.analyzed) c.overlap = c.top.filter((k) => myKeys.has(k.keyword)).length;

  // Sin tus búsquedas no se puede saber dónde no sales: no se inventan oportunidades.
  const relevant = input.relevant ?? (() => true);
  const gap = mine.status === "fulfilled" ? computeGap(youData.top, competitors.filter((c) => c.analyzed), 500).filter((g) => relevant(g.keyword)).slice(0, 30) : [];

  return {
    domain: self,
    location,
    competitors,
    you: { domain: self, keywords: youData.keywords, traffic: youData.traffic, overlap: null, top: youData.top },
    gap,
    ownerDomains: input.ownerDomains,
    rankKeywords: distinctKeywords(rows),
    notes,
    cost: Math.round(cost * 10000) / 10000,
    createdAt: new Date().toISOString(),
  };
}
