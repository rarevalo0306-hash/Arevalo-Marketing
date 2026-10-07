// Lee de la base de datos lo que necesita el resumen de SEO en palabras simples (plain.ts → plainSummary): solo los
// últimos reportes guardados, todo en paralelo, sin llamar a ninguna API ni a la IA. Lo usan la tarjeta "Tu SEO esta
// semana" de Inicio y (puede usarlo) el resumen de arriba de la página de SEO (SeoGuide), para que digan lo mismo.
import { db } from "@/lib/db";
import { readAuditReport } from "@/lib/seo/audit";
import { readBacklinksReport } from "@/lib/seo/backlinks";
import { buildCannibal } from "@/lib/seo/cannibal";
import { dataForSeoEnabled, readTrackedKeywords, readZones } from "@/lib/seo/dataforseo";
import { businessTopicVocab, gbpCategory, readGapReport, relevantGapRows } from "@/lib/seo/gap";
import { asGscReport } from "@/lib/seo/gsc";
import { readKeywordsReport } from "@/lib/seo/keywords";
import { readMapReport } from "@/lib/seo/maprank";
import { plainSummary, type PlainLine } from "@/lib/seo/plain";
import { readRankReport, type RankReport } from "@/lib/seo/rank";
import { latestReports, type SeoKind } from "@/lib/seo/reports";
import { mapGroups, marketSummary, type MarketSummary } from "@/lib/seo/sov";
import { readTrafficReport } from "@/lib/seo/traffic";
import { readVisibilityReport } from "@/lib/seo/visibility";
import { latestByZone } from "@/lib/seo/zones";

/** Mapas guardados que se leen para "tu parte del mapa" (el último de cada búsqueda). */
const MAPS_TAKE = 10;

export type PlainData = {
  /** Las frases del resumen, de la más importante a la menos (hasta `max`). */
  lines: PlainLine[];
  /** El último reporte de posiciones de la zona principal (para la posición promedio). */
  rank: RankReport | null;
  /** Tu parte de los clics de Google, del mapa y de las IAs. */
  market: MarketSummary;
  /** Las palabras clave que sigue el negocio. */
  tracked: string[];
  /** DataForSEO conectado (se pueden revisar posiciones y búsquedas). */
  canRank: boolean;
  /** Hay al menos un reporte guardado de los que usa el resumen. */
  hasData: boolean;
};

/** Todo lo del resumen en palabras simples de un negocio, con sus últimos reportes guardados. null si no existe. */
export async function loadPlainSummary(businessId: string, opts: { max?: number } = {}): Promise<PlainData | null> {
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, website: true, seoKeywords: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, study: true },
  });
  if (!b) return null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const canRank = dataForSeoEnabled();
  const per = Math.max(1, zones.length);
  // Todo en una sola tanda (consultas en paralelo, solo los datos guardados): nada llama a una API.
  const latest = (kind: SeoKind, take = 1) =>
    db.seoReport.findMany({ where: { businessId, kind }, orderBy: { createdAt: "desc" }, take, select: { data: true } }).catch(() => []);
  const [rankRows, kwRows, aiRows, gapRows, gbpRows, mapRows, gscRows, auditRows, linkRows, trafficRows] = await Promise.all([
    latestReports(businessId, "rank", 3 * per),
    latestReports(businessId, "keywords", 3 * per),
    latest("ai"),
    latest("gap"),
    latest("gbp"),
    latest("maprank", MAPS_TAKE),
    latest("gsc"),
    latest("audit"),
    latest("backlinks"),
    latest("traffic"),
  ]);
  const hasData = [rankRows, kwRows, aiRows, gapRows, gbpRows, mapRows, gscRows, auditRows, linkRows, trafficRows].some((r) => r.length > 0);

  // La zona principal (la primera), como en los paneles de posiciones y búsquedas.
  const main = zones[0]?.code;
  const rankByZone = latestByZone(rankRows.map((r) => readRankReport(r.data)), zones);
  const kwByZone = latestByZone(kwRows.map((r) => readKeywordsReport(r.data)), zones);
  const rank = main === undefined ? null : (rankByZone.get(main) ?? null);
  const keywords = main === undefined ? null : (kwByZone.get(main) ?? null);
  const ai = aiRows[0] ? readVisibilityReport(aiRows[0].data) : null;
  const gap = gapRows[0] ? readGapReport(gapRows[0].data) : null;
  const vocab = businessTopicVocab({ ...b, category: gbpRows[0] ? gbpCategory(gbpRows[0].data) : null });

  // Tu parte del mercado: el último reporte de cada zona (los sin código cuentan como de la principal), el último
  // mapa de cada búsqueda y la última revisión de las IAs.
  const market = marketSummary({
    website: b.website,
    rankByZone: [...rankByZone.entries()].map(([code, r]) => [{ ...r, locationCode: code }]),
    keywords: [...kwByZone.entries()].sort(([a], [c]) => Number(c === main) - Number(a === main)).map(([code, k]) => ({ ...k, locationCode: code })),
    maps: mapGroups(mapRows.flatMap((r) => readMapReport(r.data) ?? [])),
    ai: [ai],
  });

  // Páginas que compiten entre sí: solo Search Console puede marcar una búsqueda como urgente, así que basta con el
  // último reporte de Search Console y la revisión de la página (para los títulos), igual que el panel.
  const gsc = gscRows[0] ? asGscReport(gscRows[0].data) : null;
  const cannibal = gsc?.pageQueries.length
    ? buildCannibal({
        businessName: b.name,
        website: b.website,
        zones,
        gsc: { pageQueries: gsc.pageQueries, range: gsc.range },
        ranks: [],
        audit: auditRows[0] ? readAuditReport(auditRows[0].data) : null,
      })
    : null;

  const tracked = readTrackedKeywords(b.seoKeywords);
  const lines = plainSummary({
    businessId,
    rank: zones.length ? rank : null,
    keywords,
    tracked,
    ai,
    gap: gap ? relevantGapRows(gap.rows, vocab) : null,
    canRank: canRank && zones.length > 0,
    market,
    cannibal,
    backlinks: linkRows[0] ? readBacklinksReport(linkRows[0].data) : null,
    traffic: trafficRows[0] ? readTrafficReport(trafficRows[0].data) : null,
    ...(opts.max ? { max: opts.max } : {}),
  });

  return { lines, rank: zones.length ? rank : null, market, tracked, canRank, hasData };
}

/**
 * Los enlaces del resumen apuntan a secciones de la página de SEO (#posiciones…). Fuera de ella (ej. en Inicio) hay
 * que llevarlos a /b/<id>/seo#seccion; la página de SEO abre la pestaña correcta con el #. Los demás quedan igual.
 */
export function seoHref(businessId: string, href: string): string {
  return href.startsWith("#") ? `/b/${businessId}/seo${href}` : href;
}

/** Las frases más importantes primero: las urgentes (tono "bad") arriba, después el orden del resumen. */
export function topLines(lines: PlainLine[], n: number): PlainLine[] {
  const rank = (l: PlainLine) => (l.tone === "bad" ? 0 : 1);
  return lines
    .map((l, i) => ({ l, i }))
    .sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i)
    .slice(0, n)
    .map((x) => x.l);
}
