// Posiciones en Google (DataForSEO SERP API, "live advanced"): en qué lugar sale el negocio para cada palabra clave que sigue.
// Docs: https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/
// Precio (desde sept. 2025, https://dataforseo.com/update/important-serp-api-remains-fully-operational-pricing-update):
// modo live = US$0.002 la primera página de 10 resultados + US$0.0015 cada página extra. Con depth 20 → US$0.0035 por palabra.
// Con varias zonas se revisa cada palabra en cada zona (palabras × zonas × US$0.0035) y se guarda un reporte por zona.
// Las preguntas de "La gente también pregunta" (people_also_ask) y las "Búsquedas relacionadas" (related_searches)
// vienen gratis en la misma respuesta: se guardan sin pedir clics extra (people_also_ask_click_depth cobra
// US$0.00015 por clic, no se usa).
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { BiError, bi } from "@/lib/i18n";
import { dataForSeoEnabled, dfsPost, readTrackedKeywords, readZones, type Zone } from "@/lib/seo/dataforseo";
import { saveReport } from "@/lib/seo/reports";

/** Cuántos resultados se piden por palabra clave (2 páginas de Google). */
export const RANK_DEPTH = 20;
/** Costo estimado por palabra clave en cada revisión (USD): primera página + 1 página extra. */
export const RANK_COST_PER_KEYWORD = 0.002 + 0.0015;
/** Los clientes locales buscan desde el celular: se revisa Google en celular. */
export const RANK_DEVICE = "mobile" as const;
/** Máximo de palabras clave por revisión (igual que en los ajustes). */
export const RANK_MAX_KEYWORDS = 25;

const CONCURRENCY = 8;
const CALL_TIMEOUT_MS = 60_000;

export type RankTop = { position: number; domain: string; title: string; url: string };
export type LocalPack = { position: number | null; names: string[] };
export type RankRow = {
  keyword: string;
  /** Lugar en los resultados orgánicos (rank_group). null = no sale en los primeros 20. */
  position: number | null;
  /** La página del negocio que sale. */
  url: string | null;
  /** El mapa con 3 negocios (local pack). null = Google no mostró mapa para esta búsqueda. */
  localPack: LocalPack | null;
  /** Los 5 primeros resultados orgánicos. */
  top: RankTop[];
  /** Qué más muestra Google en la página: local_pack, people_also_ask, featured_snippet, ads, ai_overview… */
  features: string[];
  /** Preguntas de "La gente también pregunta" (sin repetir, máx. 8). Las revisiones viejas no las tienen. */
  questions?: string[];
  /** "Búsquedas relacionadas" del pie de Google (sin repetir, máx. 8). Las revisiones viejas no las tienen. */
  related?: string[];
  error?: { es: string; en: string };
};

/** Máximo de preguntas y de búsquedas relacionadas que se guardan por palabra clave. */
export const RANK_MAX_QUESTIONS = 8;

export type RankReport = {
  location: string;
  locationCode: number;
  language: string;
  device: "mobile" | "desktop";
  rows: RankRow[];
  cost: number;
  createdAt: string;
  /** Posición promedio de las palabras donde sí sale (null si no sale en ninguna). */
  avgPosition: number | null;
  inTop3: number;
  inTop10: number;
  /** 0-100: ver visibilityScore. */
  visibility: number;
};

// ---------- Dominio y nombre ----------

/** El dominio de una dirección web, en minúsculas y sin "www." ("https://www.Ejemplo.com/x" → "ejemplo.com"). */
export function siteDomain(website: string | null | undefined): string {
  const raw = (website ?? "").trim();
  if (!raw) return "";
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** ¿Este resultado es del negocio? Acepta el mismo dominio o un subdominio (tienda.ejemplo.com). */
export function domainMatches(resultDomain: string | null | undefined, businessDomain: string): boolean {
  const own = siteDomain(businessDomain);
  const d = siteDomain(resultDomain);
  if (!own || !d) return false;
  return d === own || d.endsWith(`.${own}`);
}

const LEGAL = new Set(["llc", "inc", "corp", "corporation", "co", "ltd", "pllc", "pa", "sa", "srl", "sas", "lc", "company", "incorporated"]);

/** Nombre de negocio para comparar: sin acentos, minúsculas, sin signos ni "LLC/Inc/Corp". */
export function normalizeName(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(l)\.(l)\.(c)\.?/g, "llc")
    .replace(/\b(s)\.(a)\.?/g, "sa")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (words.length > 1 && LEGAL.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/** ¿El título del mapa es este negocio? Igual, o uno contiene al otro como palabras completas (mínimo 4 letras). */
export function nameMatches(title: string, businessName: string): boolean {
  const a = normalizeName(title);
  const b = normalizeName(businessName);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.replace(/ /g, "").length >= 4 && ` ${long} `.includes(` ${short} `);
}

// ---------- Lectura de la respuesta de Google ----------

export type SerpItem = {
  type?: string;
  rank_group?: number;
  rank_absolute?: number;
  domain?: string;
  url?: string;
  title?: string;
  /** Algunas versiones anidan los negocios del mapa. */
  items?: SerpItem[] | null;
};
export type SerpResult = { keyword?: string; item_types?: string[] | null; items?: SerpItem[] | null };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Textos sin repetir (sin importar mayúsculas, acentos ni signos), limpios y hasta `max`. */
export function uniqueTexts(list: unknown[], max = RANK_MAX_QUESTIONS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = str(raw).replace(/\s+/g, " ").trim().slice(0, 200);
    const k = s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Los elementos de adentro de un bloque (preguntas, búsquedas relacionadas), sin confiar en su forma. */
const inner = (i: SerpItem): unknown[] => {
  const v = (i as { items?: unknown }).items;
  return Array.isArray(v) ? v : [];
};

/**
 * Las preguntas de "La gente también pregunta": cada bloque people_also_ask trae people_also_ask_element con
 * la pregunta en `title` (sin clics extra Google muestra unas 4).
 */
export function serpQuestions(items: SerpItem[]): string[] {
  return uniqueTexts(
    items.filter((i) => i.type === "people_also_ask").flatMap((i) => inner(i).map((q) => (q && typeof q === "object" ? (q as { title?: unknown }).title : null))),
  );
}

/** Las "Búsquedas relacionadas": en related_searches `items` es una lista de textos. */
export function serpRelated(items: SerpItem[]): string[] {
  return uniqueTexts(
    items
      .filter((i) => i.type === "related_searches")
      .flatMap((i) => inner(i).map((q) => (typeof q === "string" ? q : q && typeof q === "object" ? (q as { title?: unknown }).title : null))),
  );
}

/** Convierte un resultado de la SERP API en una fila del reporte. */
export function parseSerp(keyword: string, result: SerpResult | null | undefined, domain: string, businessName: string): RankRow {
  const items = Array.isArray(result?.items) ? result.items.filter((i): i is SerpItem => !!i && typeof i === "object") : [];
  const organic = items
    .filter((i) => i.type === "organic" && num(i.rank_group) !== null)
    .sort((a, b) => (a.rank_group ?? 0) - (b.rank_group ?? 0));
  const mine = organic.find((i) => domainMatches(i.domain || i.url, domain));

  // Mapa: cada negocio viene como un elemento "local_pack" (o anidado dentro de uno).
  const packItems = items
    .filter((i) => i.type === "local_pack")
    .flatMap((i) => (Array.isArray(i.items) && i.items.length ? i.items : [i]))
    .filter((i) => str(i.title));
  let localPack: LocalPack | null = null;
  if (packItems.length) {
    const hit = packItems.findIndex((i) => domainMatches(i.domain || i.url, domain) || nameMatches(str(i.title), businessName));
    localPack = {
      position: hit < 0 ? null : (num(packItems[hit].rank_group) ?? hit + 1),
      names: packItems.slice(0, 3).map((i) => str(i.title)),
    };
  }

  const types = new Set<string>([...(Array.isArray(result?.item_types) ? result.item_types.filter((x): x is string => typeof x === "string") : []), ...items.map((i) => str(i.type))]);
  const features = [...types]
    .filter((x) => x && x !== "organic")
    .map((x) => (x === "paid" ? "ads" : x))
    .filter((x, i, all) => all.indexOf(x) === i);

  const questions = serpQuestions(items);
  const related = serpRelated(items);

  return {
    keyword,
    position: mine ? (num(mine.rank_group) as number) : null,
    url: mine ? str(mine.url) || null : null,
    localPack,
    top: organic.slice(0, 5).map((i) => ({ position: i.rank_group as number, domain: siteDomain(i.domain || i.url) || str(i.domain), title: str(i.title), url: str(i.url) })),
    features,
    // Siempre se guardan (aunque vengan vacías) para distinguir "Google no mostró preguntas" de una revisión vieja.
    questions,
    related,
  };
}

// ---------- Resumen ----------

/**
 * Probabilidad aproximada de clic según la posición orgánica (estudios públicos de CTR, redondeados).
 * Posición 1 ≈ 30 %, 2 ≈ 15 %, 3 ≈ 10 %, 4 ≈ 7 %, 5 ≈ 5 %, 6 ≈ 4 %, 7 ≈ 3 %, 8 ≈ 2.5 %, 9-10 ≈ 2 %, 11-20 ≈ 1 %, más abajo 0.
 */
export function ctrFor(position: number | null): number {
  if (position === null || position < 1) return 0;
  const table = [0.3, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.02];
  if (position <= 10) return table[Math.floor(position) - 1];
  return position <= 20 ? 0.01 : 0;
}

/**
 * Visibilidad 0-100: la suma del CTR de cada palabra dividida entre el CTR que tendrías si salieras
 * en el 1er lugar en todas. 100 = primero en todo; 0 = no sales en los primeros 20 en ninguna.
 * Las palabras que fallaron (error) no cuentan.
 */
export function visibilityScore(positions: (number | null)[]): number {
  if (!positions.length) return 0;
  const sum = positions.reduce<number>((s, p) => s + ctrFor(p), 0);
  return Math.round((sum / (positions.length * ctrFor(1))) * 100);
}

export function summarize(rows: RankRow[]): Pick<RankReport, "avgPosition" | "inTop3" | "inTop10" | "visibility"> {
  const ok = rows.filter((r) => !r.error);
  const ranked = ok.map((r) => r.position).filter((p): p is number => p !== null);
  return {
    avgPosition: ranked.length ? Math.round((ranked.reduce((s, p) => s + p, 0) / ranked.length) * 10) / 10 : null,
    inTop3: ranked.filter((p) => p <= 3).length,
    inTop10: ranked.filter((p) => p <= 10).length,
    visibility: visibilityScore(ok.map((r) => r.position)),
  };
}

export type Change = {
  /** up = subió, down = bajó, same = igual, new = antes no salía y ahora sí, lost = antes salía y ahora no, none = no hay con qué comparar. */
  kind: "up" | "down" | "same" | "new" | "lost" | "none";
  /** Lugares que subió (positivo) o bajó (negativo). */
  delta: number | null;
  previous: number | null;
};

/** Compara cada palabra clave con la revisión anterior. */
export function compareRuns(current: RankReport, previous: RankReport | null | undefined): Record<string, Change> {
  const before = new Map((previous?.rows ?? []).filter((r) => !r.error).map((r) => [r.keyword.toLowerCase(), r]));
  const out: Record<string, Change> = {};
  for (const r of current.rows) {
    const p = before.get(r.keyword.toLowerCase());
    if (!p || r.error) {
      out[r.keyword] = { kind: "none", delta: null, previous: p?.position ?? null };
      continue;
    }
    const was = p.position;
    const now = r.position;
    let kind: Change["kind"];
    if (was === null && now === null) kind = "none";
    else if (was === null) kind = "new";
    else if (now === null) kind = "lost";
    else kind = now < was ? "up" : now > was ? "down" : "same";
    out[r.keyword] = { kind, delta: was !== null && now !== null ? was - now : null, previous: was };
  }
  return out;
}

/** Lee un reporte guardado sin confiar en su forma. null si no es un reporte de posiciones válido. */
export function readRankReport(json: unknown): RankReport | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o.rows)) return null;
  const rows: RankRow[] = [];
  for (const raw of o.rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const keyword = str(r.keyword).trim();
    if (!keyword) continue;
    const position = num(r.position);
    const lp = r.localPack && typeof r.localPack === "object" ? (r.localPack as Record<string, unknown>) : null;
    const err = r.error;
    const error =
      typeof err === "string"
        ? { es: err, en: err }
        : err && typeof err === "object" && typeof (err as { es?: unknown }).es === "string"
          ? { es: (err as { es: string }).es, en: str((err as { en?: unknown }).en) || (err as { es: string }).es }
          : undefined;
    // Las revisiones viejas no traen preguntas ni búsquedas relacionadas.
    const questions = Array.isArray(r.questions) ? uniqueTexts(r.questions) : null;
    const related = Array.isArray(r.related) ? uniqueTexts(r.related) : null;
    rows.push({
      keyword,
      position: position !== null && position >= 1 ? position : null,
      url: str(r.url) || null,
      localPack: lp
        ? {
            position: num(lp.position),
            names: Array.isArray(lp.names) ? lp.names.filter((n): n is string => typeof n === "string").slice(0, 3) : [],
          }
        : null,
      top: Array.isArray(r.top)
        ? r.top
            .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
            .map((t) => ({ position: num(t.position) ?? 0, domain: str(t.domain), title: str(t.title), url: str(t.url) }))
            .filter((t) => t.position > 0)
            .slice(0, 5)
        : [],
      features: Array.isArray(r.features) ? r.features.filter((f): f is string => typeof f === "string") : [],
      ...(questions ? { questions } : {}),
      ...(related ? { related } : {}),
      ...(error ? { error } : {}),
    });
  }
  const s = summarize(rows);
  const created = str(o.createdAt);
  return {
    location: str(o.location),
    locationCode: num(o.locationCode) ?? 0,
    language: str(o.language) || "es",
    device: o.device === "desktop" ? "desktop" : "mobile",
    rows,
    cost: num(o.cost) ?? 0,
    createdAt: created && !Number.isNaN(Date.parse(created)) ? created : new Date(0).toISOString(),
    avgPosition: o.avgPosition === null ? null : (num(o.avgPosition) ?? s.avgPosition),
    inTop3: num(o.inTop3) ?? s.inTop3,
    inTop10: num(o.inTop10) ?? s.inTop10,
    visibility: num(o.visibility) ?? s.visibility,
  };
}

// ---------- Revisión ----------

/** Corre tareas con un máximo de N a la vez, en el mismo orden. */
export async function pool<T, R>(list: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
  return out;
}

export const biOf = (e: unknown) =>
  e instanceof BiError ? { es: e.message, en: e.en } : { es: e instanceof Error ? e.message : String(e), en: e instanceof Error ? e.message : String(e) };

export type RankInput = {
  keywords: string[];
  /** Dominio o dirección web del negocio. */
  domain: string;
  businessName: string;
  /** Las zonas a revisar (la primera es la principal). */
  zones: Zone[];
  language: string;
};

/** Cada palabra en cada zona: una consulta a Google por par. */
export function rankJobs(zones: Zone[], keywords: string[]): { zone: Zone; keyword: string }[] {
  const list = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].slice(0, RANK_MAX_KEYWORDS);
  return zones.flatMap((zone) => list.map((keyword) => ({ zone, keyword })));
}

export type ZoneRunResult = { zoneCode: number; row: RankRow; cost: number };

/**
 * Arma un reporte por zona con las filas de cada una. Una zona donde fallaron todas las palabras
 * no se guarda (queda en `failed`) para no tapar su revisión anterior.
 */
export function buildZoneReports(
  zones: Zone[],
  language: string,
  results: ZoneRunResult[],
  createdAt = new Date().toISOString(),
): { reports: RankReport[]; failed: { zone: Zone; error: { es: string; en: string } }[] } {
  const reports: RankReport[] = [];
  const failed: { zone: Zone; error: { es: string; en: string } }[] = [];
  for (const zone of zones) {
    const mine = results.filter((r) => r.zoneCode === zone.code);
    if (!mine.length) continue;
    const rows = mine.map((r) => r.row);
    const firstError = rows.find((r) => r.error)?.error;
    if (rows.every((r) => r.error)) {
      failed.push({ zone, error: firstError ?? { es: "Falló", en: "Failed" } });
      continue;
    }
    const cost = mine.reduce((s, r) => s + r.cost, 0);
    reports.push({
      location: zone.name,
      locationCode: zone.code,
      language,
      device: RANK_DEVICE,
      rows,
      cost: Math.round(cost * 10000) / 10000,
      createdAt,
      ...summarize(rows),
    });
  }
  return { reports, failed };
}

/**
 * Revisa en Google (celular, primeros 20) cada palabra clave en cada zona, con máximo 8 consultas a la vez
 * en total. Devuelve un reporte por zona. Si todo falla, lanza el error.
 */
export async function checkRankings(input: RankInput): Promise<ReturnType<typeof buildZoneReports>> {
  const domain = siteDomain(input.domain);
  const jobs = rankJobs(input.zones, input.keywords);
  const results = await pool(jobs, CONCURRENCY, async ({ zone, keyword }): Promise<ZoneRunResult> => {
    try {
      const r = await dfsPost<SerpResult>(
        "/serp/google/organic/live/advanced",
        { keyword, location_code: zone.code, language_code: input.language, device: RANK_DEVICE, depth: RANK_DEPTH },
        CALL_TIMEOUT_MS,
      );
      return { zoneCode: zone.code, row: parseSerp(keyword, r.result[0], domain, input.businessName), cost: r.cost };
    } catch (e) {
      return { zoneCode: zone.code, row: { keyword, position: null, url: null, localPack: null, top: [], features: [], error: biOf(e) }, cost: 0 };
    }
  });
  const out = buildZoneReports(input.zones, input.language, results);
  if (!out.reports.length && out.failed.length) {
    const e = out.failed[0].error;
    throw bi(e.es, e.en);
  }
  return out;
}

/** Lo que necesita un negocio para revisar posiciones; devuelve lo que falta o los datos listos. */
export function rankSetup(b: { website: string; seoLocations?: unknown; seoLocationCode: number | null; seoLocationName?: string; seoKeywords: unknown }):
  | { ok: true; domain: string; zones: Zone[]; keywords: string[] }
  | { ok: false; missing: "website" | "location" | "keywords" } {
  const domain = siteDomain(b.website);
  if (!domain) return { ok: false, missing: "website" };
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  if (!zones.length) return { ok: false, missing: "location" };
  const keywords = readTrackedKeywords(b.seoKeywords).slice(0, RANK_MAX_KEYWORDS);
  if (!keywords.length) return { ok: false, missing: "keywords" };
  return { ok: true, domain, zones, keywords };
}

const DAY_MS = 20 * 3600_000;
const RETRY_MS = 2 * 3600_000;
/** Marca de "revisión en curso" (fila en SeoReport) para que el cron, que puede llamarse cada minuto, no repita. */
const RUN_MARK = "rank-run";

/**
 * Revisión diaria automática: busca UN negocio con la revisión diaria encendida cuya última revisión tenga
 * más de 20 horas y lo revisa en todas sus zonas. Si un intento falla, se vuelve a probar en 2 horas.
 * "Última revisión" = el reporte "rank" más nuevo de cualquier zona: todas las zonas de una corrida se guardan
 * juntas, así que una zona que falló esa vez espera a la corrida del día siguiente (o a una revisión a mano).
 */
export async function runDueRankChecks(now = new Date()): Promise<{ businessId: string; ok: boolean; cost?: number; error?: string } | null> {
  if (!dataForSeoEnabled()) return null;
  const candidates = await db.business.findMany({
    // Las zonas se revisan con rankSetup (readZones), no con este filtro.
    where: { seoDaily: true, website: { not: "" } },
    select: {
      id: true,
      name: true,
      website: true,
      seoLocations: true,
      seoLocationCode: true,
      seoLocationName: true,
      seoLanguage: true,
      seoKeywords: true,
      seoReports: { where: { kind: { in: ["rank", RUN_MARK] } }, orderBy: { createdAt: "desc" }, take: 20, select: { kind: true, createdAt: true } },
    },
  });
  const due = candidates
    .map((b) => {
      const last = b.seoReports.find((r) => r.kind === "rank")?.createdAt.getTime() ?? 0;
      const tried = b.seoReports.find((r) => r.kind === RUN_MARK)?.createdAt.getTime() ?? 0;
      return { b, last, tried, setup: rankSetup(b) };
    })
    .filter((x) => x.setup.ok && now.getTime() - x.last > DAY_MS && now.getTime() - x.tried > RETRY_MS)
    .sort((a, b) => a.last - b.last)[0];
  if (!due || !due.setup.ok) return null;
  const { b, setup } = due;

  // Reservar el turno: si otra llamada del cron reservó primero, no hacer nada.
  const mark = await db.seoReport.create({ data: { businessId: b.id, kind: RUN_MARK, data: { startedAt: now.toISOString() } } });
  const first = await db.seoReport.findFirst({
    where: { businessId: b.id, kind: RUN_MARK, createdAt: { gte: new Date(now.getTime() - RETRY_MS) } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (first && first.id !== mark.id) return null;
  await db.seoReport.deleteMany({ where: { businessId: b.id, kind: RUN_MARK, createdAt: { lt: new Date(now.getTime() - 7 * 24 * 3600_000) } } });

  try {
    const { reports, failed } = await checkRankings({
      keywords: setup.keywords,
      domain: setup.domain,
      businessName: b.name,
      zones: setup.zones,
      language: b.seoLanguage === "en" ? "en" : "es",
    });
    const saved: string[] = [];
    for (const report of reports) saved.push((await saveReport(b.id, "rank", report as unknown as Prisma.InputJsonValue)).id);
    // Aviso por email si bajó algo (solo en esta revisión automática). Un fallo del email nunca rompe la revisión.
    try {
      const { notifyRankAlerts } = await import("@/lib/seo/alerts");
      const alert = await notifyRankAlerts(b.id, saved);
      if (alert.sent) console.log(`[alertas] ${b.id}: aviso enviado (${alert.bad} cambios)`);
    } catch (e) {
      console.error(`[alertas] ${b.id}: no se pudo enviar el aviso:`, e instanceof Error ? e.message : e);
    }
    const cost = Math.round(reports.reduce((s, r) => s + r.cost, 0) * 10000) / 10000;
    return { businessId: b.id, ok: true, cost, ...(failed.length ? { error: `zonas sin revisar: ${failed.map((f) => f.zone.code).join(", ")}` } : {}) };
  } catch (e) {
    return { businessId: b.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
