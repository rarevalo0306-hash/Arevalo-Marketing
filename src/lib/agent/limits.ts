// Los límites de un reparto de piezas: cuántas caben hoy, a qué canales se puede publicar y qué temas ya se usaron.
// Los leen el agente de estrategia (para proponer dentro de ellos) y el paso `dispatch` (para validar lo que propuso).
import type { AgentWorkspace } from "@prisma/client";
import { businessTz, dayRange, localDay } from "@/lib/business-tz";
import { db } from "@/lib/db";
import { AgentError } from "./access";
import { brakedChannels } from "./guard";
import type { PieceLimits } from "./plan";
import { OPEN_RUN_CAP, OPEN_STATUSES } from "./queue";

const DAY = 86400000;
/** How far back a topic still counts as recent. */
const RECENT_DAYS = 30;
/** Most rows read for each list of recent topics (a busy month has far fewer). */
const TOPIC_ROWS = 200;
/** Longest a topic is kept: a title is short, and this bounds what reaches a prompt. */
const TOPIC_MAX = 200;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The topic of a stored piece plan (`plan.piece.topic`), or null when the plan has none we can read. */
function topicOf(plan: unknown): string | null {
  const piece = isObject(plan) && isObject(plan.piece) ? plan.piece : null;
  return typeof piece?.topic === "string" ? piece.topic : null;
}

/**
 * The topics already used: titles of the agent's campaigns and topics of its pieces from the last 30 days, newest first and
 * without repeats. Read for `businessId` only. `exceptRunId` is a piece run whose own topic and own `agent-<runId>` campaign
 * do not count (the editorial review asks about the piece it is reviewing).
 */
export async function recentTopicsOf(
  businessId: string,
  now: Date,
  exceptRunId?: string,
): Promise<string[]> {
  const since = new Date(now.getTime() - RECENT_DAYS * DAY);
  const [campaigns, pieces] = await Promise.all([
    db.campaign.findMany({
      where: {
        businessId,
        id: { startsWith: "agent-", ...(exceptRunId ? { not: `agent-${exceptRunId}` } : {}) },
        createdAt: { gte: since },
      },
      select: { name: true },
      orderBy: { createdAt: "desc" },
      take: TOPIC_ROWS,
    }),
    db.agentRun.findMany({
      where: {
        businessId,
        kind: "piece",
        createdAt: { gte: since },
        ...(exceptRunId ? { id: { not: exceptRunId } } : {}),
      },
      select: { plan: true },
      orderBy: { createdAt: "desc" },
      take: TOPIC_ROWS,
    }),
  ]);
  return [
    ...new Set(
      [...campaigns.map((c) => c.name), ...pieces.map((p) => topicOf(p.plan))]
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().slice(0, TOPIC_MAX))
        .filter(Boolean),
    ),
  ];
}

/**
 * What a team may create today for this business.
 * - `remainingPosts`: the least of the places left in the day (`maxPostsPerDay` minus what the agent already scheduled
 *   today minus the open pieces made today) and the places left in the open-work cap (8 minus every open run, the team's
 *   own run included). Never below 0.
 * - `channels`: those the owner allows and the business has connected, without the ones braked by repeated failures
 *   (counting only deliveries after the owner last saved the connection) and never youtube; plus `seo` (the website)
 *   when web articles are allowed and the website is connected.
 * - `today`: the business's local day, the same key `AgentBudget` uses.
 * - `recentTopics`: titles of the agent's campaigns and topics of its pieces from the last 30 days.
 * Everything is read for `businessId` only.
 */
export async function pieceLimits(
  businessId: string,
  ws: AgentWorkspace,
  now: Date,
): Promise<PieceLimits> {
  if (ws.businessId !== businessId)
    throw new AgentError("El espacio de trabajo no corresponde a este negocio.");
  const business = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { timezone: true },
  });
  const tz = businessTz(business);
  const today = localDay(now, tz);
  const { from, to } = dayRange(tz, today);
  const open = { businessId, status: { in: [...OPEN_STATUSES] } };

  const [budget, openToday, openAll, connections, recentTopics] = await Promise.all([
    db.agentBudget.findUnique({ where: { businessId_day: { businessId, day: today } } }),
    db.agentRun.count({
      where: { ...open, kind: "piece", createdAt: { gte: from, lt: to } },
    }),
    db.agentRun.count({ where: open }),
    db.connection.findMany({ where: { businessId }, select: { channel: true, updatedAt: true } }),
    recentTopicsOf(businessId, now),
  ]);

  const remainingPosts = Math.max(
    0,
    Math.min(
      ws.maxPostsPerDay - (budget?.posts ?? 0) - openToday,
      OPEN_RUN_CAP - openAll,
    ),
  );

  // The owner's channels that are connected. The website is handled apart: it is a channel for articles only.
  const connected = new Set(connections.map((c) => c.channel));
  const candidates = [...new Set(ws.channels)].filter(
    (c) => c !== "youtube" && c !== "seo" && connected.has(c),
  );
  // The agent's last two settled deliveries of each channel (a post still waiting to go out is not one yet).
  const deliveries = (
    await Promise.all(
      candidates.map((channel) =>
        db.postTarget.findMany({
          where: {
            channel,
            status: { in: ["sent", "failed"] },
            post: { businessId, id: { startsWith: "agent-" } },
          },
          select: { channel: true, status: true, post: { select: { scheduledAt: true } } },
          orderBy: { post: { scheduledAt: "desc" } },
          take: 2,
        }),
      ),
    )
  )
    .flat()
    // `PostTarget` has no date of its own: a delivery happens when its post goes out, so its time is the post's
    // `scheduledAt` (never null). Not `createdAt`: the agent makes the post as a draft and schedules it later, possibly
    // days later after an approval wait.
    .map((t) => ({ channel: t.channel, status: t.status, createdAt: t.post.scheduledAt }));
  // Saving a channel's connection again (the owner reconnected it) restarts its brake count: `updatedAt` is that moment.
  // This relies on one invariant: only an owner's save moves `Connection.updatedAt`. The background writers that rewrite a
  // connection (`writeConnection` in google-data.ts) keep `updatedAt` on purpose; any new writer must do the same.
  const reconnectedAt = Object.fromEntries(connections.map((c) => [c.channel, c.updatedAt]));
  const braked = new Set(brakedChannels(deliveries, reconnectedAt));
  const channels = candidates.filter((c) => !braked.has(c));
  if (ws.allowWebArticles && connected.has("seo")) channels.push("seo");

  return {
    remainingPosts,
    channels,
    allowSocial: ws.allowSocial,
    allowWebArticles: ws.allowWebArticles,
    today,
    recentTopics,
  };
}
