// Lee de la base de datos lo que necesita el reporte de un periodo (report-period.ts). Solo lee lo guardado:
// nunca llama a Meta, Google ni a la IA.
import { db } from "@/lib/db";
import { latestGood } from "@/lib/results";
import { readZones } from "@/lib/seo/dataforseo";
import type { AdSnapshot, InputTarget, RangePeriod, ReportInputs } from "@/lib/report-period";

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

const bi = (v: unknown): { es: string; en: string } => {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const es = typeof o.es === "string" ? o.es : typeof v === "string" ? v : "";
  const en = typeof o.en === "string" ? o.en : es;
  return { es: es || en, en };
};

const firstLine = (s: string, n = 80) => {
  const line = s.replace(/\r/g, "").split("\n").map((x) => x.trim()).find(Boolean) ?? "";
  return line.length > n ? `${line.slice(0, n - 1).trimEnd()}…` : line;
};

type TargetRow = {
  id: string;
  postId: string;
  channel: string;
  status: string;
  externalUrl: string;
  detail: string;
  sentAt: Date | null;
  post: { subject: string; seoTitle: string; text: string; scheduledAt: Date; campaignId: string | null; kind: string };
};

const toTarget = (t: TargetRow): InputTarget => ({
  id: t.id,
  postId: t.postId,
  channel: t.channel,
  status: t.status,
  externalUrl: t.externalUrl,
  detail: t.detail,
  at: t.sentAt ?? t.post.scheduledAt,
  title: firstLine(t.post.subject || t.post.seoTitle || t.post.text),
  campaignId: t.post.campaignId,
  kind: t.post.kind,
});

const targetSelect = {
  id: true,
  postId: true,
  channel: true,
  status: true,
  externalUrl: true,
  detail: true,
  sentAt: true,
  post: { select: { subject: true, seoTitle: true, text: true, scheduledAt: true, campaignId: true, kind: true } },
} as const;

/** Canales enviados en [from, to) por su hora de envío; los que fallaron o se saltaron, por la hora del intento. */
function targetsIn(businessId: string, from: Date, to: Date, statuses: string[], take: number) {
  return db.postTarget.findMany({
    where: {
      status: { in: statuses },
      post: { businessId, status: { in: ["done", "partial", "failed"] } },
      OR: [{ sentAt: { gte: from, lt: to } }, { sentAt: null, post: { scheduledAt: { gte: from, lt: to } } }],
    },
    select: targetSelect,
    take,
  });
}

/** Fotos de los anuncios guardadas en los reportes diarios (para restar y saber lo gastado en un periodo). */
export function readAdSnapshot(data: unknown): AdSnapshot | null {
  const o = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const ads = o?.ads && typeof o.ads === "object" ? (o.ads as Record<string, unknown>) : null;
  if (!ads || typeof ads.at !== "string" || !Array.isArray(ads.items)) return null;
  const at = new Date(ads.at);
  if (Number.isNaN(at.getTime())) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  const items = ads.items
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : null))
    .filter((x): x is Record<string, unknown> => Boolean(x && typeof x.id === "string"))
    .map((x) => ({ id: String(x.id), campaignId: String(x.campaignId ?? ""), spentCents: n(x.spentCents), impressions: n(x.impressions), reach: n(x.reach), clicks: n(x.clicks), results: n(x.results) }));
  return { at, items };
}

/** Lee todo lo del periodo. `now` sirve para las pruebas y para saber si el periodo terminó hace poco. */
export async function loadPeriodInputs(businessId: string, period: RangePeriod, now = new Date()): Promise<ReportInputs> {
  const { from, to, prevFrom, prevTo } = period;
  const b = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      color: true,
      color2: true,
      color3: true,
      website: true,
      logoUrl: true,
      fontHeading: true,
      aiText: true,
      seoLocations: true,
      seoLocationCode: true,
      seoLocationName: true,
    },
  });
  const recentFrom = new Date(to.getTime() - 7 * DAY_MS);
  const endedRecently = to.getTime() > now.getTime() - 2 * DAY_MS;
  const [targets, prevSent, recent, actions, prevAuto, prevCost, campaigns, dailyRows, reviews, gbp, ga4, rank, tasksDone, tasksOpen, proposals, upcoming] = await Promise.all([
    targetsIn(businessId, from, to, ["sent", "failed", "skipped"], 3000),
    db.postTarget.count({ where: { status: "sent", post: { businessId }, sentAt: { gte: prevFrom, lt: prevTo } } }),
    period.days <= 2 ? targetsIn(businessId, recentFrom, to, ["sent"], 500) : Promise.resolve([] as TargetRow[]),
    db.aiAction.findMany({
      where: { businessId, createdAt: { gte: from, lt: to } },
      select: { id: true, kind: true, actor: true, summary: true, costCents: true, createdAt: true, campaignId: true },
      orderBy: { createdAt: "desc" },
      take: 2000,
    }),
    db.aiAction.count({ where: { businessId, actor: "auto", createdAt: { gte: prevFrom, lt: prevTo } } }),
    db.aiAction.aggregate({ where: { businessId, createdAt: { gte: prevFrom, lt: prevTo } }, _sum: { costCents: true } }),
    db.campaign.findMany({
      where: { businessId },
      select: { id: true, name: true, status: true, mode: true, startsAt: true, endsAt: true, ads: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    // Las fotos de los anuncios están en los reportes diarios cercanos al inicio y al final del periodo.
    db.seoReport.findMany({
      where: {
        businessId,
        kind: "daily",
        OR: [
          { createdAt: { gte: new Date(from.getTime() - 3 * HOUR_MS), lte: new Date(from.getTime() + 14 * HOUR_MS) } },
          { createdAt: { gte: new Date(to.getTime() - 3 * HOUR_MS), lte: new Date(to.getTime() + 14 * HOUR_MS) } },
        ],
      },
      select: { data: true, createdAt: true },
      take: 20,
    }),
    db.seoReport.findFirst({ where: { businessId, kind: "reviews" }, orderBy: { createdAt: "desc" }, select: { data: true, createdAt: true } }),
    db.seoReport.findFirst({ where: { businessId, kind: "gbp" }, orderBy: { createdAt: "desc" }, select: { data: true, createdAt: true } }),
    db.seoReport.findFirst({ where: { businessId, kind: "ga4" }, orderBy: { createdAt: "desc" }, select: { data: true, createdAt: true } }),
    db.seoReport.findMany({
      where: { businessId, kind: "rank", createdAt: { gte: new Date(from.getTime() - 60 * DAY_MS), lt: to } },
      orderBy: { createdAt: "desc" },
      select: { data: true, createdAt: true },
      take: 120,
    }),
    db.actionTask.findMany({
      where: { businessId, status: "done", doneAt: { gte: from, lt: to } },
      select: { title: true, area: true, href: true, impact: true, effort: true, doneAt: true },
      orderBy: { doneAt: "desc" },
      take: 30,
    }),
    db.actionTask.findMany({
      where: { businessId, status: "todo" },
      select: { title: true, area: true, href: true, impact: true, effort: true, doneAt: true },
      orderBy: [{ impact: "desc" }, { effort: "asc" }, { firstSeen: "asc" }],
      take: 3,
    }),
    db.aiProposal.findMany({
      where: { businessId, createdAt: { gte: from, lt: to } },
      select: { id: true, kind: true, title: true, impact: true, status: true, createdAt: true },
      orderBy: [{ impact: "desc" }, { createdAt: "desc" }],
      take: 20,
    }),
    endedRecently
      ? db.post.findMany({
          where: { businessId, status: "scheduled", scheduledAt: { gte: to, lt: new Date(to.getTime() + DAY_MS) } },
          select: { scheduledAt: true },
          orderBy: { scheduledAt: "asc" },
          take: 50,
        })
      : Promise.resolve(null),
  ]);

  // Último resultado de cada publicación del periodo (o de los últimos 7 días si el periodo es corto).
  const targetIds = [...new Set([...targets, ...recent].filter((t) => t.status === "sent").map((t) => t.id))];
  // Como en /resultados: la última lectura BUENA de cada una (las lecturas con error en raw no cuentan).
  const metricRows = targetIds.length
    ? await db.postMetric.findMany({
        where: { postTargetId: { in: targetIds.slice(0, 1000) }, fetchedAt: { lte: now } },
        orderBy: [{ postTargetId: "asc" }, { fetchedAt: "desc" }],
        select: { postTargetId: true, channel: true, fetchedAt: true, impressions: true, reach: true, likes: true, comments: true, shares: true, saves: true, clicks: true, videoViews: true, raw: true },
        take: 5000,
      })
    : [];
  const byTarget = new Map<string, typeof metricRows>();
  for (const m of metricRows) byTarget.set(m.postTargetId, [...(byTarget.get(m.postTargetId) ?? []), m]);
  const metrics: ReportInputs["metrics"] = [];
  for (const [postTargetId, list] of byTarget) {
    const good = latestGood(list);
    const at = list.find((m) => !(m.raw && typeof m.raw === "object" && (m.raw as Record<string, unknown>).error));
    if (good && at) metrics.push({ postTargetId, channel: at.channel, fetchedAt: at.fetchedAt, ...good.values });
  }

  return {
    business: { id: b.id, name: b.name, color: b.color, color2: b.color2, color3: b.color3, website: b.website, logoUrl: b.logoUrl, fontHeading: b.fontHeading, aiText: b.aiText },
    period,
    now,
    zones: readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName),
    targets: targets.map(toTarget),
    prevSent,
    recentTargets: recent.map(toTarget),
    actions: actions.map((a) => ({ ...a, summary: bi(a.summary) })),
    prevActions: { auto: prevAuto, costCents: prevCost._sum.costCents ?? 0 },
    campaigns,
    adSnapshots: dailyRows.map((r) => readAdSnapshot(r.data)).filter((x): x is AdSnapshot => x !== null),
    metrics,
    reviews,
    gbp,
    ga4,
    rank,
    tasksDone: tasksDone.map((t) => ({ ...t, title: bi(t.title) })),
    tasksOpen: tasksOpen.map((t) => ({ ...t, title: bi(t.title) })),
    proposals: proposals.map((p) => ({ ...p, title: bi(p.title) })),
    upcoming: upcoming ? { count: upcoming.length, next: upcoming[0]?.scheduledAt ?? null } : null,
  };
}
