// «Ver quién sale ahora»: busca en vivo cualquier palabra o cualquier página web desde el buscador del Tablero, sin
// tener que seguirla antes (como «Keyword Overview» y «Domain Overview» de Semrush). Se guarda (kind "lookup") para no
// pagar dos veces lo mismo: la misma búsqueda se muestra guardada por LOOKUP_FRESH_DAYS días.
// - Palabra: Google en vivo en la zona principal (SERP live advanced, celular, 10 resultados, US$0.002) + los datos de
//   la palabra en el país (Labs keyword_overview, ~US$0.012): búsquedas al mes, dificultad e intención.
// - Página web: sus números en Google en el país (Labs domain_rank_overview), sus 10 búsquedas más buscadas donde sale
//   en la primera página (ranked_keywords) y quién compite con ella (competitors_domain): 3 llamadas de Labs, ~US$0.04.
import { bi } from "@/lib/i18n";
import { type BiText, isDirectory, normalizeDomain, parseLabsCompetitors, parseRankedKeywords, resolveLocation } from "@/lib/seo/competitors";
import { dfsPost, type Zone } from "@/lib/seo/dataforseo";
import { type KeywordOverview, keywordOverview, labsCost } from "@/lib/seo/labs";
import { domainMatches, nameMatches, RANK_MAX_ADS, type SerpAd, serpAds, type SerpItem, type SerpResult, serpQuestions, siteDomain } from "@/lib/seo/rank";

export const LOOKUP_KIND = "lookup";
/** Cuántos días se muestra una búsqueda guardada antes de sugerir revisarla otra vez. */
export const LOOKUP_FRESH_DAYS = 7;
/** Resultados de Google que se piden (1 página = el precio más bajo). */
export const LOOKUP_DEPTH = 10;
/** Precio de la primera página de la SERP API en vivo (US$). */
export const SERP_PAGE_COST = 0.002;
export const LOOKUP_TOP_KEYWORDS = 10;
export const LOOKUP_COMPETITORS = 5;

/** Lo que cuesta buscar una palabra: Google en vivo + sus datos en Labs. */
export const keywordLookupCost = () => Math.round((SERP_PAGE_COST + labsCost(1)) * 1000) / 1000;
/** Lo que cuesta buscar una página: 3 llamadas de Labs con hasta 1 + 10 + 6 filas. */
export const domainLookupCost = () => labsCost(1 + LOOKUP_TOP_KEYWORDS + LOOKUP_COMPETITORS + 1, 3);

// ---------- Tipos ----------

export type LookupResultItem = { position: number; domain: string; title: string; url: string; mine: boolean; directory: boolean };

export type KeywordLookup = {
  type: "keyword";
  /** La búsqueda normalizada (para encontrarla guardada). */
  key: string;
  keyword: string;
  zone: { code: number; name: string };
  device: "mobile";
  /** Los 10 primeros resultados normales de Google. */
  top: LookupResultItem[];
  /** Tu lugar entre los 10 primeros (null = no sales en la primera página). */
  yourPosition: number | null;
  /** Los negocios del mapa (null = Google no mostró mapa). */
  localPack: { names: string[]; you: number | null } | null;
  /** Lo que muestra Google además de los resultados: mapa, preguntas, resumen con IA… */
  features: string[];
  questions: string[];
  /** Los anuncios de Google en esa búsqueda (las búsquedas viejas no los tienen). */
  ads?: SerpAd[];
  /** Los datos de la palabra en el país (null si Labs no la tiene o falló). */
  facts: (Omit<KeywordOverview, "keyword"> & { country: string }) | null;
  notes: BiText[];
  cost: number;
  createdAt: string;
};

export type DomainOverview = {
  /** Visitas al mes estimadas desde Google. */
  traffic: number | null;
  /** Búsquedas por las que sale. */
  keywords: number | null;
  top3: number | null;
  top10: number | null;
  /** Lo que costarían esas visitas en anuncios (US$ al mes). */
  trafficValue: number | null;
  newKeywords: number | null;
  lostKeywords: number | null;
  /** Anuncios de Google: búsquedas donde paga y visitas estimadas. */
  paidKeywords: number | null;
  paidTraffic: number | null;
};

export type DomainLookup = {
  type: "domain";
  key: string;
  domain: string;
  country: string;
  overview: DomainOverview | null;
  /** Sus búsquedas que más visitas le traen. */
  top: { keyword: string; position: number; volume: number | null; url: string }[];
  /** Quién compite con esa página en Google (sin directorios). */
  competitors: { domain: string; overlap: number | null; keywords: number | null; traffic: number | null }[];
  notes: BiText[];
  cost: number;
  createdAt: string;
};

export type Lookup = KeywordLookup | DomainLookup;

// ---------- Ayudantes puros ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const notes = (v: unknown): BiText[] =>
  arr(v)
    .map(obj)
    .filter((n) => typeof n.es === "string" && typeof n.en === "string")
    .map((n) => ({ es: n.es as string, en: n.en as string }));

/** La clave de una búsqueda: minúsculas, sin acentos ni espacios de más (palabras) o el dominio (páginas). */
export function lookupKey(type: "keyword" | "domain", q: string): string {
  if (type === "domain") return normalizeDomain(q) ?? "";
  return q
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'&.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** La palabra como la acepta Google: sin símbolos raros, máximo 10 palabras y 80 letras (con acentos). */
export function lookupKeyword(q: string): string {
  return q
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'&.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 10)
    .join(" ")
    .slice(0, 80)
    .trim();
}

/** Lee la respuesta de Google (SERP live advanced): los 10 primeros, el mapa, lo que muestra y las preguntas. */
export function parseLookupSerp(
  result: SerpResult | null | undefined,
  domain: string,
  businessName: string,
): Pick<KeywordLookup, "top" | "yourPosition" | "localPack" | "features" | "questions" | "ads"> {
  const items = Array.isArray(result?.items) ? result.items.filter((i): i is SerpItem => !!i && typeof i === "object") : [];
  const organic = items
    .filter((i) => i.type === "organic" && num(i.rank_group) !== null)
    .sort((a, b) => (a.rank_group ?? 0) - (b.rank_group ?? 0))
    .slice(0, LOOKUP_DEPTH);
  const top = organic.map((i) => {
    const d = siteDomain(i.domain || i.url) || str(i.domain);
    return { position: i.rank_group as number, domain: d, title: str(i.title), url: str(i.url), mine: !!domain && domainMatches(d, domain), directory: isDirectory(d) };
  });
  const packItems = items
    .filter((i) => i.type === "local_pack")
    .flatMap((i) => (Array.isArray(i.items) && i.items.length ? i.items : [i]))
    .filter((i) => str(i.title));
  let localPack: KeywordLookup["localPack"] = null;
  if (packItems.length) {
    const hit = packItems.findIndex((i) => (domain && domainMatches(i.domain || i.url, domain)) || nameMatches(str(i.title), businessName));
    localPack = { names: packItems.slice(0, 3).map((i) => str(i.title)), you: hit < 0 ? null : (num(packItems[hit].rank_group) ?? hit + 1) };
  }
  const types = new Set<string>([...(Array.isArray(result?.item_types) ? result.item_types.filter((x): x is string => typeof x === "string") : []), ...items.map((i) => str(i.type))]);
  const features = [...types].filter((x) => x && x !== "organic").map((x) => (x === "paid" ? "ads" : x)).filter((x, i, all) => all.indexOf(x) === i);
  return { top, yourPosition: top.find((x) => x.mine)?.position ?? null, localPack, features, questions: serpQuestions(items), ads: serpAds(items) };
}

/**
 * Lee domain_rank_overview: result[0].items[0].metrics.organic (pos_1, pos_2_3, pos_4_10, etv, count,
 * estimated_paid_traffic_cost, is_new, is_lost) y metrics.paid (etv, count).
 * Docs: docs.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live
 */
export function parseDomainOverview(result: unknown[]): DomainOverview | null {
  const item = obj(arr(obj(result[0]).items)[0]);
  const metrics = obj(item.metrics);
  if (!Object.keys(metrics).length) return null;
  const o = obj(metrics.organic);
  const p = obj(metrics.paid);
  const top3 = (num(o.pos_1) ?? 0) + (num(o.pos_2_3) ?? 0);
  const has = (k: string) => num(o[k]) !== null;
  return {
    traffic: num(o.etv),
    keywords: num(o.count),
    top3: has("pos_1") || has("pos_2_3") ? top3 : null,
    top10: has("pos_1") || has("pos_2_3") || has("pos_4_10") ? top3 + (num(o.pos_4_10) ?? 0) : null,
    trafficValue: num(o.estimated_paid_traffic_cost),
    newKeywords: num(o.is_new),
    lostKeywords: num(o.is_lost),
    paidKeywords: num(p.count),
    paidTraffic: num(p.etv),
  };
}

const readOverview = (v: unknown): DomainOverview | null => {
  const o = obj(v);
  if (!Object.keys(o).length) return null;
  return {
    traffic: num(o.traffic),
    keywords: num(o.keywords),
    top3: num(o.top3),
    top10: num(o.top10),
    trafficValue: num(o.trafficValue),
    newKeywords: num(o.newKeywords),
    lostKeywords: num(o.lostKeywords),
    paidKeywords: num(o.paidKeywords),
    paidTraffic: num(o.paidTraffic),
  };
};

/** Lee una búsqueda guardada sin confiar en su forma; null si no es válida. */
export function readLookup(json: unknown): Lookup | null {
  const r = obj(json);
  const key = str(r.key);
  const createdAt = str(r.createdAt);
  if (!key || !createdAt) return null;
  if (r.type === "keyword") {
    const zone = obj(r.zone);
    const lp = r.localPack ? obj(r.localPack) : null;
    const f = r.facts ? obj(r.facts) : null;
    return {
      type: "keyword",
      key,
      keyword: str(r.keyword) || key,
      zone: { code: num(zone.code) ?? 0, name: str(zone.name) },
      device: "mobile",
      top: arr(r.top)
        .map(obj)
        .map((x) => ({ position: num(x.position) ?? 0, domain: str(x.domain), title: str(x.title), url: str(x.url), mine: x.mine === true, directory: x.directory === true }))
        .filter((x) => x.position > 0)
        .slice(0, LOOKUP_DEPTH),
      yourPosition: num(r.yourPosition),
      localPack: lp ? { names: arr(lp.names).filter((n): n is string => typeof n === "string").slice(0, 3), you: num(lp.you) } : null,
      features: arr(r.features).filter((x): x is string => typeof x === "string"),
      questions: arr(r.questions).filter((x): x is string => typeof x === "string").slice(0, 8),
      ...(Array.isArray(r.ads)
        ? {
            ads: arr(r.ads)
              .map(obj)
              .map((a) => ({ position: num(a.position) ?? 0, domain: str(a.domain), title: str(a.title).slice(0, 200), description: str(a.description).slice(0, 400), url: str(a.url).slice(0, 500) }))
              .filter((a) => a.domain && a.position > 0)
              .slice(0, RANK_MAX_ADS),
          }
        : {}),
      facts: f
        ? {
            volume: num(f.volume),
            cpc: num(f.cpc),
            difficulty: num(f.difficulty),
            intent: (["informational", "navigational", "commercial", "transactional"] as const).find((i) => i === f.intent) ?? null,
            trend: arr(f.trend).map((x) => num(x) ?? 0).slice(-12),
            country: str(f.country),
          }
        : null,
      notes: notes(r.notes),
      cost: num(r.cost) ?? 0,
      createdAt,
    };
  }
  if (r.type === "domain") {
    return {
      type: "domain",
      key,
      domain: str(r.domain) || key,
      country: str(r.country),
      overview: readOverview(r.overview),
      top: arr(r.top)
        .map(obj)
        .map((x) => ({ keyword: str(x.keyword), position: num(x.position) ?? 0, volume: num(x.volume), url: str(x.url) }))
        .filter((x) => x.keyword && x.position > 0)
        .slice(0, LOOKUP_TOP_KEYWORDS),
      competitors: arr(r.competitors)
        .map(obj)
        .map((x) => ({ domain: str(x.domain), overlap: num(x.overlap), keywords: num(x.keywords), traffic: num(x.traffic) }))
        .filter((x) => x.domain)
        .slice(0, LOOKUP_COMPETITORS),
      notes: notes(r.notes),
      cost: num(r.cost) ?? 0,
      createdAt,
    };
  }
  return null;
}

/** La búsqueda guardada más nueva de esa misma palabra o página (de una lista del más nuevo al más viejo). */
export function findLookup(saved: unknown[], type: "keyword" | "domain", q: string): Lookup | null {
  const key = lookupKey(type, q);
  if (!key) return null;
  for (const json of saved) {
    const l = readLookup(json);
    if (l && l.type === type && l.key === key) return l;
  }
  return null;
}

/** ¿Todavía sirve la búsqueda guardada (menos de LOOKUP_FRESH_DAYS días)? */
export const lookupFresh = (l: Pick<Lookup, "createdAt">, now = Date.now()) => now - Date.parse(l.createdAt) < LOOKUP_FRESH_DAYS * 86_400_000;

// ---------- Llamadas a DataForSEO ----------

const round = (n: number) => Math.round(n * 10000) / 10000;

/** Busca una palabra en vivo: Google en la zona principal y sus datos en el país. Falla solo si fallan las dos cosas. */
export async function runKeywordLookup(input: { q: string; zone: Zone; language: string; website: string; businessName: string }): Promise<KeywordLookup> {
  const keyword = lookupKeyword(input.q);
  if (!keyword) throw bi("Escribe una búsqueda.", "Type a search.");
  const domain = siteDomain(input.website);
  const [serp, facts] = await Promise.allSettled([
    dfsPost<SerpResult>("/serp/google/organic/live/advanced", { keyword, location_code: input.zone.code, language_code: input.language, device: "mobile", depth: LOOKUP_DEPTH }, 60_000),
    (async () => {
      const loc = await resolveLocation(input.zone.code, input.zone.name, input.language);
      const r = await keywordOverview([keyword], { countryCode: loc.countryCode, language: loc.language });
      return { ...r, country: loc.countryName };
    })(),
  ]);
  if (serp.status === "rejected" && facts.status === "rejected") throw serp.reason;
  const noteList: BiText[] = [];
  let cost = 0;
  let parsed: ReturnType<typeof parseLookupSerp> = { top: [], yourPosition: null, localPack: null, features: [], questions: [], ads: [] };
  if (serp.status === "fulfilled") {
    cost += serp.value.cost;
    parsed = parseLookupSerp(serp.value.result[0], domain, input.businessName);
  } else noteList.push({ es: "Google no respondió esta vez: solo se muestran los datos de la palabra.", en: "Google didn't answer this time: only the keyword data is shown." });
  let factsOut: KeywordLookup["facts"] = null;
  if (facts.status === "fulfilled") {
    cost += facts.value.cost;
    const row = facts.value.rows.find((r) => r.keyword === keyword.toLowerCase()) ?? facts.value.rows[0];
    if (row) {
      const { keyword: _k, ...rest } = row;
      void _k;
      factsOut = { ...rest, country: facts.value.country };
    } else noteList.push({ es: "DataForSEO no tiene datos de esta búsqueda (casi nadie la hace).", en: "DataForSEO has no data for this search (almost nobody makes it)." });
  } else noteList.push({ es: "No se pudieron traer las búsquedas al mes y la dificultad esta vez.", en: "Couldn't fetch monthly searches and difficulty this time." });
  return {
    type: "keyword",
    key: lookupKey("keyword", keyword),
    keyword,
    zone: { code: input.zone.code, name: input.zone.name },
    device: "mobile",
    ...parsed,
    facts: factsOut,
    notes: noteList,
    cost: round(cost),
    createdAt: new Date().toISOString(),
  };
}

/** Busca una página web en vivo: sus números en Google, sus mejores búsquedas y su competencia (en el país). */
export async function runDomainLookup(input: { q: string; zone: Zone; language: string }): Promise<DomainLookup> {
  const domain = normalizeDomain(input.q);
  if (!domain) throw bi("Esa dirección no parece una página web (ej.: competencia.com).", "That doesn't look like a website (e.g. competitor.com).");
  const loc = await resolveLocation(input.zone.code, input.zone.name, input.language);
  const base = { target: domain, location_code: loc.countryCode, language_code: loc.language };
  const [overview, ranked, comps] = await Promise.allSettled([
    dfsPost<unknown>("/dataforseo_labs/google/domain_rank_overview/live", base),
    dfsPost<unknown>("/dataforseo_labs/google/ranked_keywords/live", {
      ...base,
      item_types: ["organic"],
      limit: LOOKUP_TOP_KEYWORDS,
      // Las más buscadas donde sale en la primera página: las que de verdad le traen visitas.
      order_by: ["keyword_data.keyword_info.search_volume,desc"],
      filters: ["ranked_serp_element.serp_item.rank_group", "<=", 10],
    }),
    dfsPost<unknown>("/dataforseo_labs/google/competitors_domain/live", { ...base, item_types: ["organic"], exclude_top_domains: true, limit: LOOKUP_COMPETITORS + 1 }),
  ]);
  if (overview.status === "rejected" && ranked.status === "rejected" && comps.status === "rejected") throw overview.reason;
  const noteList: BiText[] = [];
  let cost = 0;
  let ov: DomainOverview | null = null;
  if (overview.status === "fulfilled") {
    cost += overview.value.cost;
    ov = parseDomainOverview(overview.value.result);
  }
  let top: DomainLookup["top"] = [];
  if (ranked.status === "fulfilled") {
    cost += ranked.value.cost;
    top = parseRankedKeywords(ranked.value.result).top.slice(0, LOOKUP_TOP_KEYWORDS);
  } else noteList.push({ es: "No se pudieron leer sus búsquedas esta vez.", en: "Couldn't read its keywords this time." });
  let competitors: DomainLookup["competitors"] = [];
  if (comps.status === "fulfilled") {
    cost += comps.value.cost;
    competitors = parseLabsCompetitors(comps.value.result)
      .filter((c) => c.domain !== domain && !isDirectory(c.domain))
      .slice(0, LOOKUP_COMPETITORS);
  } else noteList.push({ es: "No se pudo buscar su competencia esta vez.", en: "Couldn't look up its competitors this time." });
  if (!ov && !top.length) noteList.push({ es: `DataForSEO casi no tiene datos de ${domain} en ${loc.countryName}: puede ser nueva o recibir muy pocas visitas de Google.`, en: `DataForSEO has almost no data for ${domain} in ${loc.countryName}: it may be new or get very few Google visits.` });
  return { type: "domain", key: domain, domain, country: loc.countryName, overview: ov, top, competitors, notes: noteList, cost: round(cost), createdAt: new Date().toISOString() };
}
