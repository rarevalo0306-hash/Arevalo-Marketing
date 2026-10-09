// «Resumen de resultados» de un negocio entre dos fechas: lo usa la pantalla /b/<id>/resultados y lo pueden reusar los
// agentes DAILY (reporte diario / por fechas) y OPTIMIZE (propuestas). SOLO LEE la base de datos (y, para saber qué
// fotos son diseños, la nota pública de cada foto): nada de APIs de redes, nada de IA, no gasta ni escribe.
//
//   const s = await resultsSummary(businessId, from, to);
//
// Forma (ResultsSummary, todo JSON simple; fechas en ISO; dinero en centavos de dólar; null = no hay datos):
// {
//   version: 1, businessId, from, to, previous: { from, to }, tz,       // periodo pedido y el anterior del mismo largo
//   channels: { connected: string[], measured: string[], skipped: { channel, es, en }[] },
//   kpis: {
//     reach, interactions, clicks, posts: Kpi,                           // de las publicaciones hechas en el periodo
//     webVisits, keyEvents: Kpi & { range },                             // Google Analytics: sus últimos 28 días guardados
//     reviews: { new: Kpi, rating: number|null, total: number|null, at } | null,
//     adsSpentCents: number|null, adsCostPerResultCents: number|null,
//   },                                                                   // Kpi = { now, prev, change (en %) }
//   series: { unit: "day"|"week", items: { start ("AAAA-MM-DD", día del negocio), reach, interactions, posts }[] },
//   byChannel, byFormat, byCampaign: Group[],                            // { key, label, posts, measured, reach, interactions, clicks, rate }
//   best, worst: RankedPost[],                                           // top 5 / peores 5 por tasa de interacción
//   timing: { enough, measured, days[7], hours[24], bestDay, bestHour }, // ≥ 10 publicaciones medidas; si no, enough=false
//   ads: AdsSummary | null,
//   google: { rank: RankMovement | null, organic: { days: { date, sessions }[], total, at } | null },
//   notes: { insightsMissing: string[], errors: { channel, count }[], unmeasured: number },
// }
// Las publicaciones cuentan en el periodo en que se publicaron, con su última lectura (los números de cada publicación
// siguen subiendo unos días: las del final del periodo todavía están sumando).
import { db } from "@/lib/db";
import { readGa4Connection, latestGa4Report } from "@/lib/ga4";
import { publicMediaUrl, readSidecar } from "@/lib/media";
import { metricChannels, METRIC_KEYS, SKIPPED_CHANNELS, type MetricValues } from "@/lib/post-metrics-shape";
import { readPostMedia } from "@/lib/post-media";
import { readCampaignAds } from "@/lib/ads-shape";
import { readZones } from "@/lib/seo/dataforseo";
import { readReviewsReport } from "@/lib/seo/gbp";
import { readRankReport } from "@/lib/seo/rank";
import { businessTz } from "@/lib/business-tz";
import {
  adsSummary,
  buckets,
  byCampaign,
  byChannel,
  byFormat,
  formatOf,
  kpi,
  postCount,
  previousRange,
  rankMovement,
  rankPosts,
  reviewsBetween,
  timing,
  totals,
  type AdsSummary,
  type Bucket,
  type Group,
  type Kpi,
  type RankedPost,
  type RankMovement,
  type RankSnap,
  type TargetRow,
  type Timing,
} from "@/lib/results-shape";

export type ResultsSummary = {
  version: 1;
  businessId: string;
  from: string;
  to: string;
  previous: { from: string; to: string };
  tz: string;
  channels: { connected: string[]; measured: string[]; skipped: { channel: string; es: string; en: string }[] };
  kpis: {
    reach: Kpi;
    interactions: Kpi;
    clicks: Kpi;
    posts: Kpi;
    webVisits: (Kpi & { range: { start: string; end: string } }) | null;
    keyEvents: (Kpi & { range: { start: string; end: string } }) | null;
    reviews: { new: Kpi; rating: number | null; total: number | null; at: string } | null;
    adsSpentCents: number | null;
    adsCostPerResultCents: number | null;
  };
  series: { unit: "day" | "week"; items: Bucket[] };
  byChannel: Group[];
  byFormat: Group[];
  byCampaign: Group[];
  best: RankedPost[];
  worst: RankedPost[];
  timing: Timing;
  ads: AdsSummary | null;
  google: { rank: RankMovement | null; organic: { days: { date: string; sessions: number }[]; total: number; at: string } | null };
  notes: { insightsMissing: string[]; errors: { channel: string; count: number }[]; unmeasured: number };
};

/** Zona horaria del negocio ("" = la de la app). */
export const businessTzOf = businessTz;

type RawMetric = { fetchedAt: Date; raw: unknown } & MetricValues;

/** La última lectura buena (sin raw.error) de una lista del más nuevo al más viejo. */
export function latestGood(metrics: RawMetric[]): { values: MetricValues; raw: Record<string, unknown> } | null {
  for (const m of metrics) {
    const raw = m.raw && typeof m.raw === "object" ? (m.raw as Record<string, unknown>) : {};
    if (raw.error) continue;
    const values = Object.fromEntries(METRIC_KEYS.map((k) => [k, m[k] ?? 0])) as MetricValues;
    return { values, raw };
  }
  return null;
}

/** ¿Es un diseño hecho en la app? (la nota de la foto dice kind "design"). Espera como mucho 2 segundos. */
async function isDesign(mediaUrl: string): Promise<boolean> {
  if (!mediaUrl) return false;
  const note = await Promise.race([readSidecar(mediaUrl).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 2000))]);
  return !!note && typeof note === "object" && (note as { kind?: unknown }).kind === "design";
}

function thumbOf(channel: string, externalId: string, post: { mediaUrl: string; mediaType: string; media: unknown; altText: string }): string {
  const items = readPostMedia(post.media, post);
  const photo = items.find((i) => i.type === "photo");
  if (photo) return publicMediaUrl(photo.url);
  if (channel === "youtube" && /^[\w-]{6,20}$/.test(externalId)) return `https://i.ytimg.com/vi/${externalId}/mqdefault.jpg`;
  return "";
}

const snippet = (s: string) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > 90 ? `${one.slice(0, 89).replace(/\s+\S*$/, "")}…` : one;
};

export async function resultsSummary(businessId: string, from: Date, to: Date): Promise<ResultsSummary> {
  const prev = previousRange(from, to);
  const b = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { id: true, timezone: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, connections: { select: { channel: true } } },
  });
  const tz = businessTzOf(b);
  const connected = b.connections.map((c) => c.channel);
  const measuredChannels = metricChannels();

  const [targets, campaigns, rankRows, reviewRows, ga4Conn] = await Promise.all([
    db.postTarget.findMany({
      where: { status: "sent", sentAt: { gte: prev.from, lte: to }, post: { businessId } },
      select: {
        id: true,
        channel: true,
        externalId: true,
        externalUrl: true,
        sentAt: true,
        post: { select: { id: true, text: true, mediaUrl: true, mediaType: true, kind: true, media: true, altText: true, campaignId: true, campaign: { select: { name: true } } } },
        metrics: { orderBy: { fetchedAt: "desc" }, take: 4 },
      },
      orderBy: { sentAt: "desc" },
      take: 2000,
    }),
    db.campaign.findMany({ where: { businessId }, select: { id: true, name: true, ads: true } }).catch(() => []),
    db.seoReport.findMany({ where: { businessId, kind: "rank" }, orderBy: { createdAt: "desc" }, take: 30, select: { data: true, createdAt: true } }).catch(() => []),
    db.seoReport.findMany({ where: { businessId, kind: "reviews" }, orderBy: { createdAt: "desc" }, take: 1, select: { data: true, createdAt: true } }).catch(() => []),
    readGa4Connection(businessId).catch(() => null),
  ]);

  // Diseños: solo las fotos sueltas (post) del periodo, como mucho 80.
  const photoPosts = [...new Map(targets.filter((t) => t.post.kind === "post" && t.post.mediaType === "photo").map((t) => [t.post.id, t.post.mediaUrl])).entries()].slice(0, 80);
  const designs = new Set<string>();
  await Promise.all(photoPosts.map(async ([id, url]) => (await isDesign(url)) && designs.add(id)));

  const insightsMissing = new Set<string>();
  const errorCount = new Map<string, number>();
  const rows: TargetRow[] = targets
    .filter((t) => t.sentAt)
    .map((t) => {
      const good = latestGood(t.metrics as RawMetric[]);
      if (good?.raw.insightsError) insightsMissing.add(t.channel);
      const lastRaw = t.metrics[0]?.raw as Record<string, unknown> | undefined;
      if (lastRaw?.error && t.sentAt! >= from) errorCount.set(t.channel, (errorCount.get(t.channel) ?? 0) + 1);
      return {
        targetId: t.id,
        postId: t.post.id,
        channel: t.channel,
        sentAt: t.sentAt!,
        url: t.externalUrl,
        text: snippet(t.post.text),
        thumb: thumbOf(t.channel, t.externalId, t.post),
        format: formatOf(t.post.kind, t.post.mediaType, designs.has(t.post.id)),
        campaignId: t.post.campaignId,
        campaignName: t.post.campaign?.name ?? "",
        metric: good?.values ?? null,
      };
    });
  const cur = rows.filter((r) => r.sentAt >= from && r.sentAt <= to);
  const old = rows.filter((r) => r.sentAt >= prev.from && r.sentAt < prev.to);
  const tc = totals(cur.filter((r) => measuredChannels.includes(r.channel)));
  const tp = totals(old.filter((r) => measuredChannels.includes(r.channel)));
  const anyMetrics = tc.measured + tp.measured > 0;
  const metricKpi = (a: number, b: number) => (anyMetrics ? kpi(a, tp.measured ? b : null) : kpi(null, null));

  // Google Analytics: el último reporte guardado (28 días) contra los 28 anteriores.
  let webVisits: ResultsSummary["kpis"]["webVisits"] = null;
  let keyEvents: ResultsSummary["kpis"]["keyEvents"] = null;
  let organic: ResultsSummary["google"]["organic"] = null;
  const propertyId = ga4Conn?.secret.propertyId;
  if (propertyId) {
    const g = await latestGa4Report(businessId, propertyId).catch(() => null);
    if (g) {
      webVisits = { ...kpi(g.report.totals.sessions, g.report.previous.sessions), range: g.report.range };
      keyEvents = { ...kpi(g.report.totals.keyEvents, g.report.previous.keyEvents), range: g.report.range };
      organic = { days: g.report.organicTrend, total: g.report.organicTrend.reduce((s, d) => s + d.sessions, 0), at: g.at.toISOString() };
    }
  }

  // Reseñas (de la última revisión de Google Maps).
  let reviews: ResultsSummary["kpis"]["reviews"] = null;
  const rv = reviewRows[0] ? readReviewsReport(reviewRows[0].data) : null;
  if (rv) {
    const n = reviewsBetween(rv.reviews, from, to);
    const p = reviewsBetween(rv.reviews, prev.from, prev.to);
    reviews = { new: kpi(n.count, p.count), rating: rv.rating, total: rv.total, at: reviewRows[0].createdAt.toISOString() };
  }

  // Anuncios.
  const adCampaigns = campaigns.map((c) => ({ id: c.id, name: c.name, items: readCampaignAds(c.ads).items }));
  const ads = adCampaigns.some((c) => c.items.length) ? adsSummary(adCampaigns, from, to) : null;

  // Posiciones en Google (solo la zona principal, como el panel de posiciones).
  const main = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName)[0]?.code;
  const snaps: RankSnap[] = rankRows
    .map((r) => ({ rep: readRankReport(r.data), at: r.createdAt }))
    .filter((x) => x.rep && (main === undefined || x.rep.locationCode === main || !(x.rep.locationCode > 0)))
    .map((x) => ({
      at: x.at.toISOString(),
      avgPosition: x.rep!.avgPosition,
      inTop3: x.rep!.inTop3,
      inTop10: x.rep!.inTop10,
      rows: x.rep!.rows.filter((r) => !r.error).map((r) => ({ keyword: r.keyword, position: r.position })),
    }));

  // Campañas: lo gastado en anuncios va junto a sus publicaciones.
  const campaignGroups = byCampaign(cur);
  const ranked = rankPosts(cur.filter((r) => measuredChannels.includes(r.channel)));

  return {
    version: 1,
    businessId,
    from: from.toISOString(),
    to: to.toISOString(),
    previous: { from: prev.from.toISOString(), to: prev.to.toISOString() },
    tz,
    channels: {
      connected,
      measured: measuredChannels.filter((c) => connected.includes(c)),
      skipped: connected.filter((c) => !measuredChannels.includes(c) && SKIPPED_CHANNELS[c]).map((c) => ({ channel: c, ...SKIPPED_CHANNELS[c] })),
    },
    kpis: {
      reach: metricKpi(tc.reach, tp.reach),
      interactions: metricKpi(tc.interactions, tp.interactions),
      clicks: metricKpi(tc.clicks, tp.clicks),
      posts: kpi(postCount(cur), postCount(old)),
      webVisits,
      keyEvents,
      reviews,
      adsSpentCents: ads ? ads.spentCents : null,
      adsCostPerResultCents: ads ? ads.costPerResultCents : null,
    },
    series: buckets(cur, from, to, tz),
    byChannel: byChannel(cur),
    byFormat: byFormat(cur.filter((r) => measuredChannels.includes(r.channel))),
    byCampaign: campaignGroups,
    best: ranked.best,
    worst: ranked.worst,
    timing: timing(cur.filter((r) => measuredChannels.includes(r.channel)), tz),
    ads,
    google: { rank: rankMovement(snaps, from, to), organic },
    notes: {
      insightsMissing: [...insightsMissing],
      errors: [...errorCount.entries()].map(([channel, count]) => ({ channel, count })),
      unmeasured: cur.filter((r) => measuredChannels.includes(r.channel) && !r.metric).length,
    },
  };
}
