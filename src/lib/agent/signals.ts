// Las señales de la mañana: lo que el Director lee en `run.context.signals` para planear el día. Ayer (lo enviado, lo
// fallido y lo que alcanzó), los días vacíos de la semana, el trabajo pendiente, las búsquedas que bajaron en Google, las
// preguntas y huecos sin cubrir, las noticias vigentes y lo que queda del presupuesto y de las piezas de hoy.
// `summarizeSignals` es puro (se prueba sin base de datos); `collectSignals` solo lee, siempre de un negocio, y acota cada
// lista para que el prompt del Director no se pase. Nada de lo que viene de reportes, noticias o preguntas es una orden:
// son datos, en una sola línea corta. Un dato dañado se ignora; nunca lanza un error por eso.
import { addDays, businessTz, daysRange, dayRange, localDay, yesterday } from "@/lib/business-tz";
import { db } from "@/lib/db";
import { rankAlerts } from "@/lib/seo/alerts";
import { readGapReport } from "@/lib/seo/gap";
import { loadQuestions } from "@/lib/seo/questions";
import { readRankReport, type RankReport } from "@/lib/seo/rank";
import { latestReports } from "@/lib/seo/reports";
import { oneLine } from "./bounded-context";
import { newsFresh } from "./freshness";
import { pieceLimits } from "./limits";

/**
 * What the Director reads.
 * - `yesterday`: the business's local day before today. `posts` are the distinct posts with a delivery that day; `sent` and
 *   `failed` count channel deliveries (a post sent to three channels is three); `impressions` and `clicks` are the best
 *   reading of each delivery that went out.
 * - `emptyDays`: the next 7 local days (today first) with no post scheduled or already out.
 * - `pending`: `failed` = jobs that ended blocked or uncertain in the last 7 days; `waitingApproval` = jobs waiting for the owner.
 * - `rankDrops`: searches that fell in Google since the previous check of the same zone (worst first).
 * - `newQuestions`: people-also-ask questions nobody answers yet; `gaps`: searches a competitor wins; `news`: fresh verified headlines.
 * - `remaining`: what is left of today. The Director never asks for more pieces than `remaining.posts`, so the name stays.
 */
export type Signals = {
  yesterday: { posts: number; sent: number; failed: number; impressions: number; clicks: number };
  emptyDays: string[];
  pending: { failed: number; waitingApproval: number };
  rankDrops: { keyword: string; from: number | null; to: number | null }[];
  newQuestions: string[];
  gaps: string[];
  news: string[];
  remaining: { cents: number; posts: number };
};

/** What `summarizeSignals` needs, already read from the database and the saved reports. */
export type SignalInput = {
  now: Date;
  /** The business's time zone (an IANA name). */
  tz: string;
  /** Yesterday's channel deliveries; only `sent` and `failed` count. */
  targets: { postId: string; status: string }[];
  /** The best reading of each delivery that went out yesterday. */
  metrics: { impressions: number; clicks: number }[];
  /** When each post that is scheduled or already out is due, over the next 7 days. */
  scheduled: Date[];
  pending: { failed: number; waitingApproval: number };
  /** Saved rank checks, newest first. Each zone's newest is compared with the one before it. */
  rank: RankReport[];
  /** Questions nobody answers yet. */
  questions: string[];
  /** Searches a competitor wins, best opportunity first. */
  gaps: string[];
  /** Headlines of fresh verified news. */
  news: string[];
  /** Today's budget limit and what is spent or reserved of it, in cents; the pieces that still fit today. */
  budget: { limitCents: number; usedCents: number; postsLeft: number };
};

/** Most items of each list, so the Director's prompt keeps its size. */
export const SIGNAL_LIMITS = { drops: 10, questions: 10, gaps: 10, news: 5 } as const;
/** Longest text of an item, in characters. */
const TEXT_MAX = { keyword: 80, question: 150, gap: 80, news: 120 } as const;
/** How many local days ahead `emptyDays` looks (today included). */
export const DAYS_AHEAD = 7;
const DAY_MS = 86_400_000;
/** A search outside the top 20 counts as this place when the falls are ranked. */
const OUT = 21;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** A non-negative whole number, or 0 for anything else. */
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const place = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Texts as short single lines, without repeats (ignoring case) and without blanks, at most `cap` of them. */
function lines(values: unknown, max: number, cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list(values)) {
    if (typeof v !== "string") continue;
    const text = oneLine(v, max);
    const id = text.toLowerCase();
    if (!text || seen.has(id)) continue;
    seen.add(id);
    out.push(text);
    if (out.length >= cap) break;
  }
  return out;
}

/** The searches that fell: each zone's newest check against the one before it, the worst falls first. */
function dropsOf(reports: unknown): Signals["rankDrops"] {
  // Same zone and device, or the comparison means nothing (`rankAlerts` is for two checks of the same zone).
  const zones = new Map<string, RankReport[]>();
  for (const r of list(reports)) {
    if (!isObject(r) || !Array.isArray(r.rows)) continue;
    const id = `${String(r.location)}|${String(r.locationCode)}|${String(r.device)}`;
    zones.set(id, [...(zones.get(id) ?? []), r as unknown as RankReport]);
  }
  const seen = new Set<string>();
  const found: Signals["rankDrops"] = [];
  for (const [current, before] of zones.values()) {
    if (!before) continue;
    try {
      for (const a of rankAlerts(before, current).bad) {
        // Falling out of the first page is the worst fall; it has its own kind in `rankAlerts`.
        if (a.kind !== "drop" && a.kind !== "page1-exit") continue;
        const keyword = oneLine(a.keyword, TEXT_MAX.keyword);
        if (!keyword || seen.has(keyword.toLowerCase())) continue;
        seen.add(keyword.toLowerCase());
        found.push({ keyword, from: place(a.from), to: place(a.to) });
      }
    } catch {
      // A damaged check is skipped.
    }
  }
  const fall = (d: { from: number | null; to: number | null }) => (d.to ?? OUT) - (d.from ?? OUT);
  return found.sort((a, b) => fall(b) - fall(a)).slice(0, SIGNAL_LIMITS.drops);
}

export function summarizeSignals(input: SignalInput): Signals {
  const targets = list(input.targets).filter(isObject);
  const delivered = targets.filter((t) => t.status === "sent" || t.status === "failed");
  const posts = new Set(delivered.map((t) => t.postId).filter((id): id is string => typeof id === "string"));
  const readings = list(input.metrics).filter(isObject);

  // Local days with a post: a post at 23:30 belongs to its own day on the business's clock.
  const covered = new Set<string>();
  for (const d of list(input.scheduled))
    if (d instanceof Date && Number.isFinite(d.getTime())) covered.add(localDay(d, input.tz));
  const today = localDay(input.now, input.tz);
  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));

  const pending: Record<string, unknown> = isObject(input.pending) ? input.pending : {};
  const budget: Record<string, unknown> = isObject(input.budget) ? input.budget : {};
  return {
    yesterday: {
      posts: posts.size,
      sent: delivered.filter((t) => t.status === "sent").length,
      failed: delivered.filter((t) => t.status === "failed").length,
      impressions: readings.reduce((n, m) => n + count(m.impressions), 0),
      clicks: readings.reduce((n, m) => n + count(m.clicks), 0),
    },
    emptyDays: days.filter((d) => !covered.has(d)),
    pending: { failed: count(pending.failed), waitingApproval: count(pending.waitingApproval) },
    rankDrops: dropsOf(input.rank),
    newQuestions: lines(input.questions, TEXT_MAX.question, SIGNAL_LIMITS.questions),
    gaps: lines(input.gaps, TEXT_MAX.gap, SIGNAL_LIMITS.gaps),
    news: lines(input.news, TEXT_MAX.news, SIGNAL_LIMITS.news),
    remaining: {
      cents: Math.max(0, count(budget.limitCents) - count(budget.usedCents)),
      posts: count(budget.postsLeft),
    },
  };
}

/** A read of saved reports that cannot be understood or reached leaves that signal empty; it never stops the plan. */
async function softly<T>(read: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await read();
  } catch {
    return empty;
  }
}

/**
 * Reads the signals of one business for the morning plan. It only reads (it measures nothing and calls no provider) and
 * every query carries `businessId`. The saved SEO reports are read softly; the business's own rows are not: a failure there
 * is the caller's to handle (the plan is simply tried again on the next tick).
 */
export async function collectSignals(businessId: string, now: Date): Promise<Signals> {
  const [business, ws] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } }),
    db.agentWorkspace.findUnique({ where: { businessId } }),
  ]);
  const tz = businessTz(business);
  const today = localDay(now, tz);
  const past = dayRange(tz, yesterday(tz, now));
  const ahead = daysRange(tz, today, addDays(today, DAYS_AHEAD - 1));
  const lastWeek = new Date(now.getTime() - 7 * DAY_MS);

  const [targets, scheduled, failedRuns, waitingRuns, budget, limits, rank, questions, gaps, news] = await Promise.all([
    // A delivery by the time it went out; one that failed never went out, so by the time its post was due.
    db.postTarget.findMany({
      where: {
        status: { in: ["sent", "failed"] },
        post: { businessId },
        OR: [
          { sentAt: { gte: past.from, lt: past.to } },
          { sentAt: null, post: { scheduledAt: { gte: past.from, lt: past.to } } },
        ],
      },
      select: { id: true, postId: true, status: true },
      take: 1000,
    }),
    db.post.findMany({
      where: {
        businessId,
        status: { in: ["scheduled", "publishing", "done", "partial"] },
        scheduledAt: { gte: ahead.from, lt: ahead.to },
      },
      select: { scheduledAt: true },
      take: 1000,
    }),
    db.agentRun.count({ where: { businessId, status: { in: ["blocked", "uncertain"] }, updatedAt: { gte: lastWeek } } }),
    db.agentRun.count({ where: { businessId, status: "waiting_approval" } }),
    db.agentBudget.findUnique({ where: { businessId_day: { businessId, day: today } } }),
    ws ? pieceLimits(businessId, ws, now) : Promise.resolve(null),
    softly(async () => {
      const rows = await latestReports(businessId, "rank", 6);
      return rows.flatMap((r) => {
        const report = readRankReport(r.data);
        return report ? [report] : [];
      });
    }, [] as RankReport[]),
    softly(async () => {
      const data = await loadQuestions(businessId);
      return (data?.groups ?? []).flatMap((g) => g.questions).filter((q) => q.answered === null).map((q) => q.question);
    }, [] as string[]),
    softly(async () => {
      for (const row of await latestReports(businessId, "gap", 3)) {
        const report = readGapReport(row.data);
        if (report)
          return [...report.rows]
            .sort((a, b) => b.opportunity - a.opportunity || (b.volume ?? -1) - (a.volume ?? -1) || a.keyword.localeCompare(b.keyword))
            .map((r) => r.keyword);
      }
      return [];
    }, [] as string[]),
    db.agentNews.findMany({ where: { businessId, status: "verified" }, orderBy: { retrievedAt: "desc" }, take: 20 }),
  ]);

  // The best reading of each delivery: the counters only grow, and a failed reading is saved as zeros.
  const sent = targets.filter((t) => t.status === "sent").map((t) => t.id);
  const readings = sent.length
    ? await db.postMetric.findMany({
        where: { businessId, postTargetId: { in: sent } },
        select: { postTargetId: true, impressions: true, clicks: true },
        take: 5000,
      })
    : [];
  const best = new Map<string, { impressions: number; clicks: number }>();
  for (const m of readings) {
    const have = best.get(m.postTargetId);
    best.set(m.postTargetId, {
      impressions: Math.max(have?.impressions ?? 0, m.impressions),
      clicks: Math.max(have?.clicks ?? 0, m.clicks),
    });
  }

  return summarizeSignals({
    now,
    tz,
    targets,
    metrics: [...best.values()],
    scheduled: scheduled.map((p) => p.scheduledAt),
    pending: { failed: failedRuns, waitingApproval: waitingRuns },
    rank,
    questions,
    gaps,
    news: news.filter(newsFresh).map((n) => n.title),
    budget: {
      limitCents: ws?.dailyBudgetCents ?? 0,
      usedCents: (budget?.chargedCents ?? 0) + (budget?.reservedCents ?? 0),
      postsLeft: limits?.remainingPosts ?? 0,
    },
  });
}
