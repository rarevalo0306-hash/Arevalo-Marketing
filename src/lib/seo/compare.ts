// «Comparar páginas»: hasta 5 páginas web lado a lado (como «Bulk Analysis» y «Compare domains» de Semrush), con
// datos de DataForSEO en el país de la zona principal:
// - Google (Labs domain_rank_overview, una llamada por página): visitas al mes, búsquedas, top 3, top 10 y lo que
//   costarían esas visitas en anuncios.
// - Enlaces (Backlinks API, bulk_ranks y bulk_referring_domains: una llamada cada una para todas las páginas): fuerza
//   (0 a 1000) y sitios que la enlazan. Si la cuenta no tiene Backlinks API, esas columnas quedan vacías con un aviso.
// Costo con 5 páginas: 5 × US$0.012 + 2 × US$0.024 ≈ US$0.11.
import { BACKLINKS_ROW_COST, BACKLINKS_TASK_COST, backlinksLive, isNoBacklinksAccess } from "@/lib/seo/backlinks";
import { type BiText, normalizeDomain, resolveLocation, sameSite } from "@/lib/seo/competitors";
import { dfsPost, type Zone } from "@/lib/seo/dataforseo";
import { LABS_ITEM_COST, LABS_TASK_COST } from "@/lib/seo/labs";
import { type DomainOverview, parseDomainOverview } from "@/lib/seo/lookup";

export const COMPARE_MAX = 5;

export type CompareRow = DomainOverview & {
  domain: string;
  /** Es la página del negocio. */
  own: boolean;
  /** Fuerza de la página según sus enlaces, 0 a 1000 (null = sin dato o sin acceso). */
  rank: number | null;
  /** Sitios distintos que la enlazan. */
  referringDomains: number | null;
};

export type CompareReport = {
  country: string;
  rows: CompareRow[];
  /** La cuenta no tiene Backlinks API: no hay datos de enlaces. */
  linksLocked?: boolean;
  notes: BiText[];
  cost: number;
  createdAt: string;
};

/** Las métricas que se comparan, en orden; todas: más es mejor. */
export const COMPARE_METRICS = ["traffic", "keywords", "top3", "top10", "trafficValue", "rank", "referringDomains"] as const;
export type CompareMetric = (typeof COMPARE_METRICS)[number];

// ---------- Ayudantes puros ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Las páginas a comparar: válidas, sin repetir (www y subdominios cuentan como la misma), la tuya primero, máximo 5. */
export function compareDomains(input: string[], self: string | null): string[] {
  const out: string[] = [];
  const own = self ? normalizeDomain(self) : null;
  for (const raw of own ? [own, ...input] : input) {
    const d = normalizeDomain(raw);
    if (!d || out.some((x) => sameSite(x, d))) continue;
    out.push(d);
    if (out.length >= COMPARE_MAX) break;
  }
  return out;
}

/** Lo máximo que cuesta comparar `n` páginas (con enlaces). */
export function compareCostEstimate(n: number): number {
  const k = Math.max(1, Math.min(COMPARE_MAX, n));
  const links = 2 * BACKLINKS_TASK_COST + 2 * k * BACKLINKS_ROW_COST;
  return Math.ceil(Math.round((k * (LABS_TASK_COST + LABS_ITEM_COST) + links) * 1e6) / 1e3) / 1000;
}

/** bulk_ranks / bulk_referring_domains: result[0].items[] con target y el número. Devuelve dominio → número. */
export function parseBulk(result: unknown[], field: "rank" | "referring_domains"): Map<string, number> {
  const out = new Map<string, number>();
  for (const raw of arr(obj(result[0]).items)) {
    const it = obj(raw);
    const d = normalizeDomain(str(it.target));
    const v = num(it[field]);
    if (d && v !== null) out.set(d, v);
  }
  return out;
}

/** La página con el mejor número de una métrica (null si nadie tiene dato o hay empate en el primero). */
export function bestIn(rows: CompareRow[], metric: CompareMetric): string | null {
  const known = rows.filter((r) => typeof r[metric] === "number").sort((a, b) => (b[metric] as number) - (a[metric] as number));
  if (!known.length || (known[1] && known[1][metric] === known[0][metric])) return null;
  return known[0].domain;
}

/** En palabras: dónde te gana la página más fuerte y por cuánto (para la línea de arriba de la tabla). */
export function compareSummary(report: CompareReport): BiText | null {
  const me = report.rows.find((r) => r.own);
  const others = report.rows.filter((r) => !r.own && r.traffic !== null);
  if (!me || !others.length) return null;
  const leader = [...others].sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0))[0];
  const mine = me.traffic ?? 0;
  const theirs = leader.traffic ?? 0;
  if (mine >= theirs) return { es: `Tienes más visitas de Google que las páginas que comparaste.`, en: `You get more Google visits than the websites you compared.` };
  const times = mine > 0 ? Math.round((theirs / mine) * 10) / 10 : null;
  return times && times >= 1.5
    ? { es: `${leader.domain} recibe unas ${times} veces tus visitas de Google.`, en: `${leader.domain} gets about ${times} times your Google visits.` }
    : { es: `${leader.domain} recibe más visitas de Google que tú.`, en: `${leader.domain} gets more Google visits than you.` };
}

/** Lee una comparación guardada sin confiar en su forma; null si no es válida. */
export function readCompareReport(json: unknown): CompareReport | null {
  const r = obj(json);
  if (!Array.isArray(r.rows) || !str(r.createdAt)) return null;
  const rows: CompareRow[] = arr(r.rows)
    .map(obj)
    .map((x) => ({
      domain: str(x.domain),
      own: x.own === true,
      traffic: num(x.traffic),
      keywords: num(x.keywords),
      top3: num(x.top3),
      top10: num(x.top10),
      trafficValue: num(x.trafficValue),
      newKeywords: num(x.newKeywords),
      lostKeywords: num(x.lostKeywords),
      paidKeywords: num(x.paidKeywords),
      paidTraffic: num(x.paidTraffic),
      rank: num(x.rank),
      referringDomains: num(x.referringDomains),
    }))
    .filter((x) => x.domain)
    .slice(0, COMPARE_MAX);
  if (!rows.length) return null;
  return {
    country: str(r.country),
    rows,
    ...(r.linksLocked === true ? { linksLocked: true } : {}),
    notes: arr(r.notes)
      .map(obj)
      .filter((n) => typeof n.es === "string" && typeof n.en === "string")
      .map((n) => ({ es: n.es as string, en: n.en as string })),
    cost: num(r.cost) ?? 0,
    createdAt: str(r.createdAt),
  };
}

const EMPTY: DomainOverview = { traffic: null, keywords: null, top3: null, top10: null, trafficValue: null, newKeywords: null, lostKeywords: null, paidKeywords: null, paidTraffic: null };

// ---------- Llamadas ----------

/** Compara las páginas (la del negocio primero). Falla solo si no se pudo leer ninguna. */
export async function runCompare(input: { domains: string[]; self: string | null; zone: Zone; language: string }): Promise<CompareReport> {
  const domains = compareDomains(input.domains, input.self);
  const own = input.self ? normalizeDomain(input.self) : null;
  const loc = await resolveLocation(input.zone.code, input.zone.name, input.language);
  const notes: BiText[] = [];
  let cost = 0;
  const [overviews, ranks, referring] = await Promise.all([
    Promise.allSettled(domains.map((d) => dfsPost<unknown>("/dataforseo_labs/google/domain_rank_overview/live", { target: d, location_code: loc.countryCode, language_code: loc.language }))),
    backlinksLive<unknown>("/backlinks/bulk_ranks/live", { targets: domains }).then(
      (r) => ({ ok: true as const, ...r }),
      (e: unknown) => ({ ok: false as const, error: e }),
    ),
    backlinksLive<unknown>("/backlinks/bulk_referring_domains/live", { targets: domains }).then(
      (r) => ({ ok: true as const, ...r }),
      (e: unknown) => ({ ok: false as const, error: e }),
    ),
  ]);
  if (overviews.every((o) => o.status === "rejected") && !ranks.ok && !referring.ok) {
    const first = overviews[0];
    throw first?.status === "rejected" ? first.reason : new Error("compare failed");
  }
  const rankMap = ranks.ok ? parseBulk(ranks.result, "rank") : new Map<string, number>();
  const refMap = referring.ok ? parseBulk(referring.result, "referring_domains") : new Map<string, number>();
  if (ranks.ok) cost += ranks.cost;
  if (referring.ok) cost += referring.cost;
  const locked = (!ranks.ok && isNoBacklinksAccess(ranks.error)) || (!referring.ok && isNoBacklinksAccess(referring.error));
  if (!locked && (!ranks.ok || !referring.ok)) notes.push({ es: "Los datos de enlaces no se pudieron traer completos esta vez.", en: "The link data couldn't be fully fetched this time." });
  const rows: CompareRow[] = domains.map((domain, i) => {
    const o = overviews[i];
    let ov: DomainOverview | null = null;
    if (o.status === "fulfilled") {
      cost += o.value.cost;
      ov = parseDomainOverview(o.value.result);
    } else notes.push({ es: `No se pudieron leer los números de Google de ${domain}.`, en: `Couldn't read ${domain}'s Google numbers.` });
    return { domain, own: domain === own, ...(ov ?? EMPTY), rank: rankMap.get(domain) ?? null, referringDomains: refMap.get(domain) ?? null };
  });
  return { country: loc.countryName, rows, ...(locked ? { linksLocked: true } : {}), notes, cost: Math.round(cost * 10000) / 10000, createdAt: new Date().toISOString() };
}
