// Lo que necesita el Tablero (Inicio): los números de cada herramienta, su historia corta (para las mini gráficas) y lo
// que hay que hacer hoy. SOLO lee la base de datos (nada de APIs ni IA). Cada lectura va envuelta en cache() de React:
// las secciones del Tablero (cada una en su Suspense) piden lo mismo y se lee una sola vez por visita.
import { Prisma } from "@prisma/client";
import { cache } from "react";
import { CHANNEL_IDS } from "@/lib/channels";
import { connectionsNeedingReconnect, type ReconnectInfo } from "@/lib/connection-health";
import { loadContentIdeas } from "@/lib/content-ideas";
import { db } from "@/lib/db";
import type { UiLang } from "@/lib/i18n";
import { readBacklinksReport } from "@/lib/seo/backlinks";
import { readCompetitorsReport, type CompetitorsReport } from "@/lib/seo/competitors";
import { dataForSeoEnabled, readTrackedKeywords, readZones, type Zone } from "@/lib/seo/dataforseo";
import { readGbpReport, readReviewsReport } from "@/lib/seo/gbp";
import { readKeywordsReport, type KeywordsReport } from "@/lib/seo/keywords";
import { readMapReport } from "@/lib/seo/maprank";
import { loadPlainSummary } from "@/lib/seo/plain-load";
import { readRankReport, siteDomain, type RankReport } from "@/lib/seo/rank";
import { readTrafficReport } from "@/lib/seo/traffic";

/** Cuántas revisiones viejas se leen para la mini gráfica. */
export const HISTORY = 8;
/** Semanas de publicaciones en la mini gráfica. */
export const WEEKS = 8;
const DAY = 86_400_000;

/** Un número con su valor anterior y su historia (del más viejo al más nuevo). */
export type Series = { now: number | null; prev: number | null; history: number[]; at: Date | null };
const emptySeries: Series = { now: null, prev: null, history: [], at: null };

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Lista del más nuevo al más viejo → Series (la historia queda del más viejo al más nuevo). */
export function toSeries(newestFirst: { value: number | null; at: Date }[]): Series {
  const ok = newestFirst.filter((x): x is { value: number; at: Date } => x.value !== null);
  if (!ok.length) return emptySeries;
  return { now: ok[0].value, prev: ok[1]?.value ?? null, history: ok.map((x) => x.value).reverse(), at: ok[0].at };
}

/** Cuántas fechas caen en cada una de las últimas `weeks` semanas (de 7 días contando hacia atrás desde `now`). */
export function weeklyCounts(dates: Date[], now: Date, weeks = WEEKS): number[] {
  const out = new Array<number>(weeks).fill(0);
  for (const d of dates) {
    const ago = Math.floor((now.getTime() - d.getTime()) / (7 * DAY));
    if (ago >= 0 && ago < weeks) out[weeks - 1 - ago] += 1;
  }
  return out;
}

/** ¿Lo que escribió en el buscador es una página web (tiene un punto y no tiene espacios, o empieza con http)? */
export function looksLikeDomain(q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return false;
  if (/^https?:\/\//.test(s)) return true;
  return !/\s/.test(s) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(s);
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// ---------- SEO ----------

type RawScore = { score: unknown; extra: unknown; createdAt: Date };

/** Solo la nota de cada reporte (sin traer las páginas ni las respuestas completas, que pesan mucho). */
async function scores(businessId: string, kind: "audit" | "ai", extra: Prisma.Sql): Promise<RawScore[]> {
  return db
    .$queryRaw<RawScore[]>(
      Prisma.sql`select data->'score' as score, ${extra} as extra, "createdAt" from "SeoReport" where "businessId" = ${businessId} and kind = ${kind} order by "createdAt" desc limit ${HISTORY}`,
    )
    .catch(() => []);
}

export type SeoBits = Awaited<ReturnType<typeof readSeo>>;

async function readSeo(businessId: string) {
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: {
      name: true,
      website: true,
      seoKeywords: true,
      seoLocations: true,
      seoLocationCode: true,
      seoLocationName: true,
      seoMapPlace: true,
      seoMonthly: true,
      seoMonthlyAt: true,
      seoWeekly: true,
      seoWeeklyAt: true,
      seoAlerts: true,
      studyAt: true,
    },
  });
  if (!b) return null;
  const zones: Zone[] = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const main = zones[0]?.code;
  const last = (kind: string, take = 1) =>
    db.seoReport.findMany({ where: { businessId, kind }, orderBy: { createdAt: "desc" }, take, select: { data: true, createdAt: true } }).catch(() => []);
  const [plain, rankRows, kwRows, auditRaw, aiRaw, mapRows, linkRows, reviewRows, gbpRows, compRows, trafficRows, articles] = await Promise.all([
    loadPlainSummary(businessId).catch(() => null),
    last("rank", HISTORY * Math.max(1, zones.length)),
    last("keywords", Math.max(1, zones.length) * 2),
    scores(businessId, "audit", Prisma.sql`(select count(*) from jsonb_array_elements(case when jsonb_typeof(data->'issues') = 'array' then data->'issues' else '[]'::jsonb end) i where i->>'severity' = 'error')::int`),
    scores(businessId, "ai", Prisma.sql`data->'byProvider'`),
    last("maprank", 10),
    last("backlinks"),
    last("reviews"),
    last("gbp"),
    last("competitors"),
    last("traffic"),
    db.seoReport.findMany({ where: { businessId, kind: "article" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }).catch(() => []),
  ]);

  // Posiciones: solo la zona principal (los reportes sin código cuentan como de la principal), como el panel.
  const ranks = rankRows
    .map((r) => ({ r: readRankReport(r.data), at: r.createdAt }))
    .filter((x): x is { r: RankReport; at: Date } => !!x.r && (main === undefined || x.r.locationCode === main || !(x.r.locationCode > 0)));
  const rank = toSeries(ranks.map((x) => ({ value: x.r.avgPosition === null ? null : Math.round(x.r.avgPosition * 10) / 10, at: x.at })));
  const latestRank = ranks[0] ?? null;
  const rankRowsOk = latestRank ? latestRank.r.rows.filter((r) => !r.error) : [];

  const keywords: KeywordsReport[] = kwRows.map((r) => readKeywordsReport(r.data)).filter((x): x is KeywordsReport => !!x);

  const audit = toSeries(auditRaw.map((r) => ({ value: num(r.score), at: r.createdAt })));
  const auditErrors = auditRaw[0] ? num(auditRaw[0].extra) : null;

  const ai = toSeries(aiRaw.map((r) => ({ value: num(r.score), at: r.createdAt })));
  let aiMentioned = 0;
  let aiTotal = 0;
  const by = aiRaw[0]?.extra;
  if (by && typeof by === "object") {
    for (const v of Object.values(by as Record<string, unknown>)) {
      const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
      aiMentioned += num(o.mentioned) ?? 0;
      aiTotal += num(o.total) ?? 0;
    }
  }

  // Mapa: tu parte del top 3 (la misma cuenta del resumen) y el mejor lugar promedio de tus mapas.
  const maps = mapRows.map((r) => ({ m: readMapReport(r.data), at: r.createdAt })).filter((x) => !!x.m);
  const bestMapRank = maps.reduce<number | null>((best, x) => (x.m!.avgRank !== null && (best === null || x.m!.avgRank < best) ? x.m!.avgRank : best), null);
  const mapPlace = b.seoMapPlace && typeof b.seoMapPlace === "object" ? true : false;

  const links = linkRows[0] ? readBacklinksReport(linkRows[0].data) : null;
  const linkHistory = (links?.summary.trend ?? []).map((p) => p.referringDomains).filter((x): x is number => x !== null);
  const linksNow = links ? (links.summary.referringDomains ?? links.referringTotal) : null;
  const linksDelta =
    links && links.summary.newDomains1m !== null && links.summary.lostDomains1m !== null ? links.summary.newDomains1m - links.summary.lostDomains1m : null;

  const reviews = reviewRows[0] ? readReviewsReport(reviewRows[0].data) : null;
  const unanswered = reviews ? reviews.reviews.filter((r) => !r.ownerAnswer.trim() && !r.postedAt) : [];
  const gbp = gbpRows[0] ? readGbpReport(gbpRows[0].data) : null;

  const competitors: CompetitorsReport | null = compRows[0] ? readCompetitorsReport(compRows[0].data) : null;
  const traffic = trafficRows[0] ? readTrafficReport(trafficRows[0].data) : null;

  return {
    name: b.name,
    website: b.website,
    zones,
    tracked: readTrackedKeywords(b.seoKeywords),
    canRank: dataForSeoEnabled(),
    studyAt: b.studyAt,
    plain,
    rank,
    rankLatest: latestRank ? { report: latestRank.r, at: latestRank.at, ok: rankRowsOk.length } : null,
    keywords,
    audit,
    auditErrors,
    ai: { ...ai, mentioned: aiMentioned, total: aiTotal },
    map: {
      share: plain?.market.map?.you ?? null,
      delta: plain?.market.mapDelta ?? null,
      bestRank: bestMapRank,
      count: new Set(maps.map((x) => x.m!.keyword)).size,
      at: maps[0]?.at ?? null,
      hasPlace: mapPlace,
    },
    links: { now: linksNow, delta: linksDelta, history: linkHistory, at: linkRows[0]?.createdAt ?? null, rank: links?.summary.rank ?? null },
    reviews: reviews
      ? { total: reviews.total, rating: reviews.rating, unanswered: unanswered.length, unansweredLow: unanswered.filter((r) => r.rating !== null && r.rating <= 3).length, at: reviewRows[0].createdAt }
      : null,
    gbp: gbp ? { score: gbp.score, at: gbpRows[0].createdAt } : null,
    competitors: competitors ? { report: competitors, at: compRows[0].createdAt } : null,
    traffic: traffic ? { report: traffic, at: trafficRows[0].createdAt } : null,
    articles: { count: articles.length, at: articles[0]?.createdAt ?? null },
    report: { monthly: b.seoMonthly, monthlyAt: b.seoMonthlyAt, weekly: b.seoWeekly, weeklyAt: b.seoWeeklyAt, alerts: b.seoAlerts },
  };
}

/** Todo lo de SEO del Tablero (una sola lectura por visita). */
export const loadSeoBits = cache(readSeo);

// ---------- Redes sociales ----------

export type SocialBits = Awaited<ReturnType<typeof readSocial>>;

async function readSocial(businessId: string) {
  const now = new Date();
  const since = new Date(now.getTime() - WEEKS * 7 * DAY);
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const [connections, reconnect, sent, failed, drafts, next, recent] = await Promise.all([
    db.connection.findMany({ where: { businessId, channel: { in: CHANNEL_IDS } }, select: { channel: true } }),
    connectionsNeedingReconnect(businessId).catch((): Record<string, ReconnectInfo> => ({})),
    db.post.findMany({ where: { businessId, status: { in: ["done", "partial"] }, scheduledAt: { gte: since, lte: now } }, select: { scheduledAt: true } }),
    db.post.findMany({
      where: { businessId, scheduledAt: { gte: weekAgo }, OR: [{ status: "failed" }, { status: "partial" }] },
      select: { id: true, status: true },
    }),
    db.post.count({ where: { businessId, status: "draft" } }),
    db.post.findFirst({ where: { businessId, status: "scheduled", scheduledAt: { gte: now } }, orderBy: { scheduledAt: "asc" }, select: { scheduledAt: true } }),
    db.post.findMany({ where: { businessId }, include: { targets: { select: { channel: true } } }, orderBy: { createdAt: "desc" }, take: 4 }),
  ]);
  const weeks = weeklyCounts(
    sent.map((p) => p.scheduledAt),
    now,
  );
  return {
    connected: connections.length,
    reconnect,
    weeks,
    thisWeek: weeks[weeks.length - 1],
    lastWeek: weeks[weeks.length - 2] ?? 0,
    failed: failed.filter((p) => p.status === "failed").length,
    partial: failed.filter((p) => p.status === "partial").length,
    drafts,
    next: next?.scheduledAt ?? null,
    recent,
    hasPosts: recent.length > 0,
  };
}

export const loadSocialBits = cache(readSocial);

/** Ideas de hoy (de lo guardado, sin IA). */
export const loadIdeas = cache((businessId: string, lang: UiLang) => loadContentIdeas(businessId, lang).catch(() => ({ ideas: [], basis: "season" as const })));

// ---------- Buscador ----------

export type KeywordFacts = {
  keyword: string;
  volume: number | null;
  /** Lugar en Google según tu última revisión (undefined = no se revisa esa palabra). */
  position: number | null | undefined;
  leader: string | null;
  tracked: boolean;
  /** En qué reporte apareció (para el enlace "Ver"). */
  seen: "keywords" | "gap" | "rank" | null;
};

/** Lo que ya sabemos de una búsqueda con los reportes guardados. */
export function keywordFacts(seo: NonNullable<SeoBits>, raw: string): KeywordFacts {
  const k = norm(raw);
  let volume: number | null = null;
  let seen: KeywordFacts["seen"] = null;
  for (const rep of seo.keywords) {
    const row = [...rep.keywords, ...rep.ideas].find((r) => norm(r.keyword) === k);
    if (row) {
      volume = row.volume;
      seen = "keywords";
      break;
    }
  }
  if (seen === null && seo.competitors) {
    const g = seo.competitors.report.gap.find((r) => norm(r.keyword) === k);
    if (g) {
      volume = g.volume;
      seen = "gap";
    }
  }
  const row = seo.rankLatest?.report.rows.find((r) => norm(r.keyword) === k && !r.error);
  if (row && seen === null) seen = "rank";
  const own = siteDomain(seo.website);
  const leader = row?.top.find((x) => x.domain && x.domain !== own)?.domain ?? null;
  return {
    keyword: raw.trim(),
    volume,
    position: row ? row.position : undefined,
    leader,
    tracked: seo.tracked.some((x) => norm(x) === k),
    seen,
  };
}

export type DomainFacts = {
  domain: string;
  own: boolean;
  /** Búsquedas por las que sale y visitas al mes (del reporte de competencia). */
  keywords: number | null;
  traffic: number | null;
  /** En cuántas de tus palabras clave sale entre los 5 primeros (tu última revisión). */
  beatsYouIn: number;
  checked: number;
  /** Ya está en tu lista de competencia. */
  known: boolean;
};

/** Lo que ya sabemos de la página web de un competidor. */
export function domainFacts(seo: NonNullable<SeoBits>, raw: string): DomainFacts {
  const domain = siteDomain(raw.trim()) || raw.trim().toLowerCase();
  const own = !!seo.website && siteDomain(seo.website) === domain;
  const comp = seo.competitors?.report.competitors.find((c) => siteDomain(c.domain) === domain) ?? null;
  const trafficDomain = seo.traffic?.report.domains.find((d) => siteDomain(d.domain) === domain) ?? null;
  const rows = seo.rankLatest?.report.rows.filter((r) => !r.error) ?? [];
  const beatsYouIn = rows.filter((r) => r.top.some((x) => siteDomain(x.domain) === domain)).length;
  return {
    domain,
    own,
    keywords: comp?.keywords ?? null,
    traffic: comp?.traffic ?? trafficDomain?.now?.etv ?? null,
    beatsYouIn,
    checked: rows.length,
    known: !!comp || !!trafficDomain,
  };
}
