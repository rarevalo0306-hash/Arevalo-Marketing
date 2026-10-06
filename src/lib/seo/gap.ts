// Palabras que tu competencia tiene y tú no (estilo "Keyword Gap" de Semrush), con DataForSEO Labs.
// Por cada competidor analizado en el último reporte de competencia (hasta 3) se hacen 2 llamadas a
// POST /dataforseo_labs/google/domain_intersection/live (docs.dataforseo.com/v3/dataforseo_labs/google/domain_intersection/live):
//   - "Te faltan": intersections=false → búsquedas donde target1 (el competidor) sale y target2 (tú) no.
//     Solo las que el competidor tiene en el top 20.
//   - "Estás más abajo": intersections=true → búsquedas donde salen los dos (first_domain_serp_element es el
//     competidor y second_domain_serp_element eres tú). Se quedan las que él te gana y tú estás después del 3.
// Labs trabaja por PAÍS: se usa el de la zona principal del negocio (igual que el reporte de competencia).
import { bi } from "@/lib/i18n";
import { type BiText, type CompetitorsLocation, type CompetitorsReport, isBranded, isDirectory, normalizeDomain, resolveLocation, sameSite } from "@/lib/seo/competitors";
import { dfsPost, readTrackedKeywords, readZones } from "@/lib/seo/dataforseo";
import { norm, stem, STOPWORDS } from "@/lib/seo/writer";
import { readStudy } from "@/lib/study-shape";

export type GapIntent = "informational" | "navigational" | "commercial" | "transactional";
export type GapType = "missing" | "weak";

export type GapPosition = { domain: string; position: number };

export type GapRow = {
  keyword: string;
  /** Búsquedas al mes en el país. */
  volume: number | null;
  /** Lo que pagan los anunciantes por clic (USD). */
  cpc: number | null;
  /** Qué tan difícil es salir en la primera página (0 a 100). */
  difficulty: number | null;
  intent: GapIntent | null;
  /** Tu posición (null en "te faltan": no sales). */
  yourPosition: number | null;
  /** Dónde sale cada competidor, del mejor al peor. */
  competitors: GapPosition[];
  type: GapType;
  /** Qué tan buena es la oportunidad (ver opportunityScore). */
  opportunity: number;
};

export type GapReport = {
  domain: string;
  location: CompetitorsLocation;
  /** Los competidores comparados. */
  competitors: string[];
  rows: GapRow[];
  /**
   * Búsquedas que no tienen que ver con el negocio (no comparten ninguna palabra con lo que vende; ver topicVocab):
   * se guardan aparte para poder mostrarlas si el dueño quiere. Los reportes viejos no lo tienen.
   */
  offTopic?: GapRow[];
  notes: BiText[];
  cost: number;
  createdAt: string;
};

/** Una fila tal como viene de una llamada (un competidor). */
export type IntersectionItem = {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  difficulty: number | null;
  intent: GapIntent | null;
  competitorPosition: number;
  yourPosition: number | null;
};

export const GAP_MAX_COMPETITORS = 3;
/** Filas que se piden por llamada. */
export const GAP_LIMIT = 100;
/** Filas que se guardan en el reporte. */
export const GAP_KEEP = 150;
/** Filas que no tienen que ver con el negocio que se guardan aparte (para el botón "mostrarlas igual"). */
export const GAP_OFFTOPIC_KEEP = 60;
/** "Te faltan": solo si el competidor está en el top 20. */
export const GAP_MISSING_MAX_RANK = 20;
/** "Estás más abajo": solo si tú estás después del 3. */
export const GAP_WEAK_MIN_YOUR_RANK = 3;
/** Precio de DataForSEO Labs (dataforseo.com/pricing/dataforseo-labs): por llamada y por fila devuelta (USD). */
export const LABS_TASK_COST = 0.012;
export const LABS_ITEM_COST = 0.00012;

/** Lo máximo que puede costar una corrida: 2 llamadas por competidor, cada una con hasta `limit` filas. */
export function gapCostEstimate(competitors: number, limit = GAP_LIMIT): number {
  const calls = 2 * Math.max(1, Math.min(GAP_MAX_COMPETITORS, competitors));
  return Math.round(calls * (LABS_TASK_COST + limit * LABS_ITEM_COST) * 1000) / 1000;
}

// ---------- Ayudantes puros ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const INTENTS: GapIntent[] = ["informational", "navigational", "commercial", "transactional"];
const asIntent = (v: unknown): GapIntent | null => (INTENTS.includes(v as GapIntent) ? (v as GapIntent) : null);

/** La mejor posición de un elemento del resultado (a veces viene como lista). */
function serpRank(v: unknown): number | null {
  const list = Array.isArray(v) ? v : [v];
  let best: number | null = null;
  for (const raw of list) {
    const e = obj(raw);
    const r = num(e.rank_group) ?? num(e.rank_absolute) ?? num(e.position);
    if (r !== null && r > 0 && (best === null || r < best)) best = r;
  }
  return best;
}

/**
 * Lee la respuesta de domain_intersection: items[] con keyword_data (keyword_info.search_volume y cpc,
 * keyword_properties.keyword_difficulty, search_intent_info.main_intent) y first/second_domain_serp_element.
 * target1 siempre es el competidor; target2 eres tú (en "missing" no viene second_domain_serp_element).
 */
export function parseIntersection(result: unknown[], type: GapType): IntersectionItem[] {
  const out: IntersectionItem[] = [];
  for (const raw of arr(obj(result[0]).items)) {
    const it = obj(raw);
    const kd = obj(it.keyword_data);
    const keyword = str(kd.keyword).replace(/\s+/g, " ").trim().toLowerCase();
    const competitorPosition = serpRank(it.first_domain_serp_element);
    if (!keyword || competitorPosition === null) continue;
    const info = obj(kd.keyword_info);
    const volume = num(info.search_volume);
    const cpc = num(info.cpc);
    const difficulty = num(obj(kd.keyword_properties).keyword_difficulty);
    out.push({
      keyword,
      volume: volume !== null && volume >= 0 ? volume : null,
      cpc: cpc !== null && cpc >= 0 ? cpc : null,
      difficulty: difficulty !== null ? Math.max(0, Math.min(100, difficulty)) : null,
      intent: asIntent(obj(kd.search_intent_info).main_intent),
      competitorPosition,
      yourPosition: type === "weak" ? serpRank(it.second_domain_serp_element) : null,
    });
  }
  return out;
}

/**
 * Qué tan buena es la oportunidad (más alto = mejor). Fórmula:
 *   puntos = 20 × log10(1 + búsquedas) × facilidad × intención × competidores × cercanía
 *   - facilidad = 0.3 + 0.7 × (1 − dificultad/100)  (sin dato de dificultad: 0.65)
 *   - intención: compra (transactional) 1.3, comparar (commercial) 1.2, informarse 1.0, sin dato 1.0,
 *     buscar una marca (navigational) 0.3
 *   - competidores: 1 + 0.15 por cada competidor extra que sale (si 3 competidores salen, ×1.3)
 *   - cercanía ("estás más abajo"): ×1.15 si ya estás en el top 20 (es más fácil subir que empezar de cero)
 * Ej.: 1,000 búsquedas, dificultad 20, de compra, 2 competidores → 20 × 3 × 0.86 × 1.3 × 1.15 ≈ 77.
 */
export function opportunityScore(r: { volume: number | null; difficulty: number | null; intent: GapIntent | null; competitors: number; yourPosition?: number | null }): number {
  const volume = Math.log10(1 + Math.max(0, r.volume ?? 0));
  const ease = r.difficulty === null ? 0.65 : 0.3 + 0.7 * (1 - Math.max(0, Math.min(100, r.difficulty)) / 100);
  const intent = r.intent === "transactional" ? 1.3 : r.intent === "commercial" ? 1.2 : r.intent === "navigational" ? 0.3 : 1;
  const comps = 1 + 0.15 * Math.max(0, r.competitors - 1);
  const close = r.yourPosition != null && r.yourPosition <= 20 ? 1.15 : 1;
  return Math.round(20 * volume * ease * intent * comps * close * 10) / 10;
}

/**
 * Con quién compararte: los competidores analizados del último reporte de competencia (o los primeros, si ninguno
 * se pudo analizar). Sin directorios ni redes (Páginas Amarillas, Facebook…), salvo los que agregó el dueño.
 */
export function pickGapCompetitors(report: Pick<CompetitorsReport, "competitors"> | null): string[] {
  if (!report) return [];
  const real = report.competitors.filter((c) => c.source === "owner" || !isDirectory(c.domain));
  const analyzed = real.filter((c) => c.analyzed);
  return (analyzed.length ? analyzed : real).slice(0, GAP_MAX_COMPETITORS).map((c) => c.domain);
}

// ---------- ¿La búsqueda tiene que ver con el negocio? ----------

/**
 * Palabras que no dicen de qué trata un negocio: lugares, "cerca de mí", precio, y oficios genéricos
 * ("mantenimiento de aire acondicionado" no tiene que ver con unas cortinas metálicas aunque compartan "mantenimiento").
 */
export const GENERIC_WORDS = new Set(
  (
    "nicaragua managua masaya granada leon chinandega esteli rivas matagalpa jinotega carazo boaco chontales rivas " +
    "miami florida hialeah doral orlando tampa houston texas usa estados unidos mexico guatemala honduras salvador costa rica panama " +
    "colombia venezuela peru chile argentina espana ciudad centro norte sur este oeste carretera km kilometro barrio colonia " +
    "cerca near nearby aqui mi me my precio precios price prices costo costos cost cuanto cuesta barato barata baratos cheap " +
    "economico economica oferta ofertas venta ventas comprar compra buy sale tienda tiendas store empresa empresas company companies " +
    "servicio servicios service services negocio negocios local locales nacional mejor mejores best top numero telefono phone " +
    "direccion horario horarios contacto whatsapp tipo tipos clase marca modelo nuevo nueva nuevos usado usados gratis free " +
    "fabrica fabricas fabricante fabricacion taller talleres instalacion instalaciones instalar reparacion reparaciones reparar " +
    "mantenimiento mantenimientos repair repairs installation install maintenance proveedor proveedores " +
    "distribuidor distribuidores residencial comercial comercio industrial"
  ).split(" "),
);

const vocabWords = (s: string) =>
  norm(s)
    .split(" ")
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w));

/** Las raíces de lo que vende el negocio (sin lugares ni palabras genéricas). Ver topicVocab. */
function vocabStems(texts: string[], ignore: Set<string>): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const w of vocabWords(t)) if (!ignore.has(w) && !ignore.has(stem(w))) out.add(stem(w));
  return [...out].sort();
}

/**
 * El vocabulario del negocio para saber si una búsqueda tiene que ver con él: las raíces de las palabras que
 * sigue, las palabras clave y servicios del estudio y la categoría de Google (si la hay). Se ignoran los lugares
 * (zonas, ciudades del estudio) y las palabras genéricas (GENERIC_WORDS). Vacío = no se puede juzgar.
 */
export function topicVocab(input: { keywords?: string[]; study?: unknown; category?: string | null; places?: string[] }): string[] {
  const study = readStudy(input.study);
  const texts = [
    ...(input.keywords ?? []),
    ...(study ? [...study.keywords.map((k) => k.keyword), ...study.services.map((s) => s.name), ...study.ads.googleKeywords] : []),
    ...(input.category ? [input.category] : []),
  ];
  const ignore = new Set<string>(GENERIC_WORDS);
  for (const p of [...(input.places ?? []), ...(study?.market.places ?? [])]) for (const w of vocabWords(p)) ignore.add(w);
  for (const w of [...ignore]) ignore.add(stem(w));
  return vocabStems(texts, ignore);
}

/** La categoría del Perfil de Google guardada en el último reporte "gbp" (o ""). */
export function gbpCategory(json: unknown): string {
  const c = obj(obj(json).profile).category;
  return typeof c === "string" ? c.slice(0, 120) : "";
}

/** El vocabulario de un negocio tal como está en la base de datos (palabras que sigue, estudio y zonas). */
export function businessTopicVocab(b: { seoKeywords?: unknown; study?: unknown; seoLocations?: unknown; seoLocationCode?: number | null; seoLocationName?: string | null; category?: string | null }): string[] {
  const zones = readZones(b.seoLocations, b.seoLocationCode ?? null, b.seoLocationName ?? "");
  return topicVocab({ keywords: readTrackedKeywords(b.seoKeywords), study: b.study, category: b.category, places: zones.flatMap((z) => z.name.split(",")) });
}

/** Dos raíces "se parecen": iguales, o una empieza con la otra y las dos tienen 5 letras o más ("metal" ≈ "metalic"). */
const stemsMatch = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)));

/** ¿La búsqueda comparte al menos una palabra con significado con lo que vende el negocio? Sin vocabulario: sí. */
export function isRelevantKeyword(keyword: string, vocab: string[]): boolean {
  if (!vocab.length) return true;
  const words = vocabWords(keyword).filter((w) => !GENERIC_WORDS.has(w)).map(stem);
  return words.some((w) => vocab.some((v) => stemsMatch(w, v)));
}

/**
 * Solo las búsquedas que tienen que ver con el negocio (comparten una palabra con su vocabulario).
 * Sirve para cualquier lista con `keyword`: las filas del gap, el adelanto del reporte de competencia o el
 * correo semanal. Sin vocabulario devuelve todo.
 */
export function relevantGapRows<T extends { keyword: string }>(rows: T[], vocab: string[]): T[] {
  return rows.filter((r) => isRelevantKeyword(r.keyword, vocab));
}

/** Las que tienen que ver con el negocio y las que se ocultan. */
export function splitGapRows<T extends { keyword: string }>(rows: T[], vocab: string[]): { relevant: T[]; hidden: T[] } {
  const relevant: T[] = [];
  const hidden: T[] = [];
  for (const r of rows) (isRelevantKeyword(r.keyword, vocab) ? relevant : hidden).push(r);
  return { relevant, hidden };
}

type MergeInput = {
  self: string;
  competitors: string[];
  missing: { domain: string; items: IntersectionItem[] }[];
  weak: { domain: string; items: IntersectionItem[] }[];
  keep?: number;
};

/**
 * Junta las filas de todos los competidores por búsqueda (minúsculas). Quita las búsquedas con el nombre de
 * un competidor o el tuyo y las de intención "navegar" (buscan una empresa). Aplica los filtros:
 * "te faltan" con el competidor en el top 20; "estás más abajo" con el competidor arriba de ti y tú después del 3.
 * Si una búsqueda sale en las dos listas (datos de distinto día), gana "estás más abajo" (sí sales).
 */
export function mergeGap(input: MergeInput): GapRow[] {
  const { self, keep = GAP_KEEP } = input;
  const brands = [self, ...input.competitors];
  const rows = new Map<string, GapRow>();

  const add = (domain: string, it: IntersectionItem, type: GapType) => {
    const key = it.keyword.trim().toLowerCase();
    if (!key || it.intent === "navigational" || brands.some((d) => isBranded(key, d))) return;
    if (type === "missing" && it.competitorPosition > GAP_MISSING_MAX_RANK) return;
    if (type === "weak" && (it.yourPosition === null || it.yourPosition <= GAP_WEAK_MIN_YOUR_RANK || it.competitorPosition >= it.yourPosition)) return;
    const cur = rows.get(key);
    if (!cur) {
      rows.set(key, {
        keyword: key,
        volume: it.volume,
        cpc: it.cpc,
        difficulty: it.difficulty,
        intent: it.intent,
        yourPosition: type === "weak" ? it.yourPosition : null,
        competitors: [{ domain, position: it.competitorPosition }],
        type,
        opportunity: 0,
      });
      return;
    }
    cur.volume = cur.volume === null ? it.volume : it.volume === null ? cur.volume : Math.max(cur.volume, it.volume);
    cur.cpc ??= it.cpc;
    cur.difficulty ??= it.difficulty;
    cur.intent ??= it.intent;
    if (type === "weak") {
      cur.type = "weak";
      if (it.yourPosition !== null && (cur.yourPosition === null || it.yourPosition < cur.yourPosition)) cur.yourPosition = it.yourPosition;
    }
    const same = cur.competitors.find((c) => sameSite(c.domain, domain));
    if (!same) cur.competitors.push({ domain, position: it.competitorPosition });
    else if (it.competitorPosition < same.position) same.position = it.competitorPosition;
  };

  for (const m of input.missing) for (const it of m.items) add(m.domain, it, "missing");
  for (const w of input.weak) for (const it of w.items) add(w.domain, it, "weak");

  const out = [...rows.values()];
  for (const r of out) {
    r.competitors.sort((a, b) => a.position - b.position || a.domain.localeCompare(b.domain));
    r.opportunity = opportunityScore({ volume: r.volume, difficulty: r.difficulty, intent: r.intent, competitors: r.competitors.length, yourPosition: r.yourPosition });
  }
  return out.sort((a, b) => b.opportunity - a.opportunity || (b.volume ?? -1) - (a.volume ?? -1) || a.keyword.localeCompare(b.keyword)).slice(0, keep);
}

/** Lee un reporte guardado (kind "gap"); null si no tiene la forma esperada. Ignora filas rotas. */
export function readGapReport(json: unknown): GapReport | null {
  const r = obj(json);
  const domain = str(r.domain);
  if (!domain || !Array.isArray(r.rows)) return null;
  const loc = obj(r.location);
  const readRows = (list: unknown): GapRow[] =>
    arr(list)
      .map((raw) => {
        const g = obj(raw);
        const competitors = arr(g.competitors)
          .map((c) => ({ domain: str(obj(c).domain), position: num(obj(c).position) ?? 0 }))
          .filter((c) => c.domain && c.position > 0);
        const type: GapType = g.type === "weak" ? "weak" : "missing";
        const row: GapRow = {
          keyword: str(g.keyword).trim(),
          volume: num(g.volume),
          cpc: num(g.cpc),
          difficulty: num(g.difficulty),
          intent: asIntent(g.intent),
          yourPosition: type === "weak" ? num(g.yourPosition) : null,
          competitors,
          type,
          opportunity: 0,
        };
        row.opportunity = num(g.opportunity) ?? opportunityScore({ ...row, competitors: competitors.length });
        return row;
      })
      .filter((g) => g.keyword && g.competitors.length > 0);
  const rows = readRows(r.rows);
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
    competitors: arr(r.competitors).filter((d): d is string => typeof d === "string" && d.length > 0),
    rows,
    offTopic: readRows(r.offTopic),
    notes,
    cost: num(r.cost) ?? 0,
    createdAt: str(r.createdAt),
  };
}

// ---------- Llamada a DataForSEO ----------

type RunInput = {
  website: string;
  locationCode: number | null;
  locationName: string;
  language: string;
  /** Los competidores a comparar (se usan hasta 3). */
  competitors: string[];
  /** Lo que vende el negocio (businessTopicVocab): las búsquedas que no tienen que ver van aparte, en offTopic. */
  vocab?: string[];
};

/** Corre la comparación completa: 2 llamadas por competidor, todas a la vez (hasta unos USD 0.15 con 3). */
export async function runGapReport(input: RunInput): Promise<GapReport> {
  const self = normalizeDomain(input.website);
  if (!self) throw bi("La dirección de tu página web no parece válida. Revísala en Ajustes del negocio.", "Your website address doesn't look valid. Check it in Business settings.");
  const competitors: string[] = [];
  for (const c of input.competitors) {
    const d = normalizeDomain(c);
    if (d && !sameSite(d, self) && !competitors.some((o) => sameSite(o, d))) competitors.push(d);
    if (competitors.length >= GAP_MAX_COMPETITORS) break;
  }
  if (!competitors.length)
    throw bi(
      'Primero busca a tu competencia ("Buscar mi competencia", arriba) para saber con quién compararte.',
      'First find your competition ("Find my competition", above) so we know who to compare you with.',
    );

  const location = await resolveLocation(input.locationCode, input.locationName, input.language);
  const notes: BiText[] = [];
  if (location.language !== input.language)
    notes.push({
      es: `DataForSEO no tiene datos en ${input.language === "en" ? "inglés" : "español"} para ${location.countryName}; se usó "${location.language}".`,
      en: `DataForSEO has no ${input.language === "en" ? "English" : "Spanish"} data for ${location.countryName}; used "${location.language}".`,
    });

  const base = {
    location_code: location.countryCode,
    language_code: location.language,
    item_types: ["organic"],
    limit: GAP_LIMIT,
    order_by: ["keyword_data.keyword_info.search_volume,desc"],
  };
  const call = (competitor: string, type: GapType) =>
    dfsPost<unknown>("/dataforseo_labs/google/domain_intersection/live", {
      target1: competitor,
      target2: self,
      ...base,
      intersections: type === "weak",
      filters:
        type === "missing"
          ? ["first_domain_serp_element.rank_group", "<=", GAP_MISSING_MAX_RANK]
          : [["first_domain_serp_element.rank_group", "<=", GAP_MISSING_MAX_RANK], "and", ["second_domain_serp_element.rank_group", ">", GAP_WEAK_MIN_YOUR_RANK]],
    });

  const jobs = competitors.flatMap((domain) => (["missing", "weak"] as const).map((type) => ({ domain, type })));
  const settled = await Promise.allSettled(jobs.map((j) => call(j.domain, j.type)));
  if (settled.every((s) => s.status === "rejected")) throw (settled[0] as PromiseRejectedResult).reason;

  let cost = 0;
  const missing: { domain: string; items: IntersectionItem[] }[] = [];
  const weak: { domain: string; items: IntersectionItem[] }[] = [];
  settled.forEach((s, i) => {
    const { domain, type } = jobs[i];
    if (s.status === "fulfilled") {
      cost += s.value.cost;
      (type === "missing" ? missing : weak).push({ domain, items: parseIntersection(s.value.result, type) });
    } else
      notes.push(
        type === "missing"
          ? { es: `No se pudieron leer las búsquedas que ${domain} tiene y tú no.`, en: `Couldn't read the searches ${domain} has and you don't.` }
          : { es: `No se pudieron leer las búsquedas donde ${domain} sale más arriba que tú.`, en: `Couldn't read the searches where ${domain} ranks above you.` },
      );
  });

  // Primero se separan las que no tienen que ver con el negocio, para que no le quiten lugar a las que sí.
  const { relevant, hidden } = splitGapRows(mergeGap({ self, competitors, missing, weak, keep: Number.POSITIVE_INFINITY }), input.vocab ?? []);

  return {
    domain: self,
    location,
    competitors,
    rows: relevant.slice(0, GAP_KEEP),
    offTopic: hidden.slice(0, GAP_OFFTOPIC_KEEP),
    notes,
    cost: Math.round(cost * 10000) / 10000,
    createdAt: new Date().toISOString(),
  };
}
