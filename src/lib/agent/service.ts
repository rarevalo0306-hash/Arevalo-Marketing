import { db } from "@/lib/db";
import { localDay } from "@/lib/business-tz";
import { runDailyReports } from "@/lib/daily-report";
import { publishPost } from "@/lib/publish";
import { AgentError } from "./access";
import { AGENTS } from "./agents";
import { modelConfig } from "./metered";
import { resolveModel } from "./models";
import { enqueue, json, stepsOf } from "./queue";
import { AgentKeyEnum, ModelChoice } from "./schema";
import { loadTeamRuns, objectOrNull } from "./team-load";
import type { TeamAgentView, TeamSnapshot } from "./team-view";
import { enqueueDailyPlans } from "./daily";
import { sendAgentAlerts } from "./alerts";
import { drain } from "./execution";
import { loadContext } from "./context";
import { industryFor, toolCatalog } from "./industry";
import { readSource, sourceUrl } from "./network";
import { plain } from "./news";

// The team's runs are read by `team-load.ts` (no import cycle with the alerts and the daily report); this file keeps the name.
export { loadTeamRuns };

/**
 * The team's view of a business: its runs (`loadTeamRuns`) and its seven agents with the model each works with, whether it can
 * work yet (and why not) and what it did today.
 */
export async function teamSnapshot(
  businessId: string,
  now = new Date(),
): Promise<TeamSnapshot> {
  const { today, tz, runs } = await loadTeamRuns(businessId, now);
  const [ws, spent] = await Promise.all([
    db.agentWorkspace.findUnique({
      where: { businessId },
      select: { agentModels: true, modelPrices: true },
    }),
    // `budgetDay` is the local day the step reserved on: the same key as the daily budget.
    db.agentStep.groupBy({
      by: ["agent"],
      where: { budgetDay: today, run: { businessId } },
      _count: { _all: true },
      _sum: { chargedCents: true },
    }),
  ]);
  const models = { agentModels: ws?.agentModels ?? {}, modelPrices: ws?.modelPrices ?? {} };
  const fallback = ModelChoice.safeParse({
    provider: process.env.MATYA_AGENT_PROVIDER,
    model: process.env.MATYA_AGENT_MODEL,
  }).data;
  const agents = AgentKeyEnum.options.map((key): TeamAgentView => {
    const { label, usesModel } = AGENTS[key];
    const chosen = ModelChoice.safeParse(objectOrNull(models.agentModels)?.[key]).data;
    const choice = chosen ?? fallback;
    let problem = "";
    // An agent that makes no AI call does not need a model.
    if (usesModel)
      try {
        resolveModel(key, models);
      } catch (error) {
        problem = error instanceof AgentError ? error.message : "No se pudo comprobar el modelo.";
      }
    const used = spent.find((s) => s.agent === key);
    return {
      key,
      label,
      usesModel,
      model: usesModel && choice ? `${choice.provider}:${choice.model}` : "",
      own: chosen !== undefined,
      ready: problem === "",
      problem,
      steps: used?._count._all ?? 0,
      cents: used?._sum.chargedCents ?? 0,
    };
  });
  return { today, tz, runs, agents };
}

export async function snapshot(businessId: string) {
  const now = new Date();
  // One read of the workspace (a plain promise, awaited twice): the recent runs depend on its team mode.
  const workspace = db.agentWorkspace.findUnique({ where: { businessId } }).then((w) => w);
  const [context, settings, runs, messages, news] = await Promise.all([
    loadContext(businessId),
    workspace,
    workspace.then((w) => db.agentRun.findMany({
      // With team mode on, the pieces of a team request are its own cards (`team`) and the recent list keeps the requests. With it
      // off there is no board: a piece left from team mode is listed here, as before team mode, so it can still be approved or cancelled.
      where: { businessId, ...(w?.teamMode ? { parentRunId: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        kind: true,
        prompt: true,
        status: true,
        stage: true,
        error: true,
        result: true,
        chargedCents: true,
        reservedCents: true,
        createdAt: true,
        steps: {
          orderBy: { createdAt: "asc" },
          select: {
            name: true,
            specialist: true,
            status: true,
            output: true,
            error: true,
            chargedCents: true,
          },
        },
      },
    })),
    db.agentMessage.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        role: true,
        text: true,
        runId: true,
        createdAt: true,
      },
    }),
    db.agentNews.findMany({
      where: { businessId },
      orderBy: { retrievedAt: "desc" },
      take: 30,
    }),
  ]);
  let aiReady = false;
  try {
    modelConfig();
    aiReady = true;
  } catch {
    /* visible setup state */
  }
  const day = localDay(now, context.business.timezone);
  // The team's view comes with the workspace, team mode on or off: the settings show each agent's readiness before it is turned on.
  const [budget, team] = await Promise.all([
    db.agentBudget.findUnique({
      where: { businessId_day: { businessId, day } },
    }),
    // A failure of the team's view must not take the whole Centro MATYA down with it (the settings show it for every workspace).
    settings
      ? teamSnapshot(businessId, now).catch((error: unknown) => {
          console.error("MATYA team view did not load", error instanceof Error ? error.name : "unknown");
          return null;
        })
      : null,
  ]);
  return JSON.parse(
    JSON.stringify({
      business: context.business,
      industry: context.industry,
      settings,
      runs,
      messages: messages.reverse(),
      news,
      budget,
      aiReady,
      team,
      tools: toolCatalog(businessId),
      connections: context.connections,
      posts: context.posts,
      campaigns: context.campaigns,
      capturedAt: new Date().toISOString(),
    }),
  );
}
/** Explicit owner verification records the original article and legal-event status, never just a feed headline. */
export async function verifyNews(
  businessId: string,
  id: string,
  eventDate: string,
  factStatus: string,
  summary: string,
) {
  if (
    !["proposed", "approved", "effective", "not_legal"].includes(factStatus) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
    !Number.isFinite(Date.parse(eventDate)) ||
    summary.trim().length < 30 ||
    summary.length > 2000
  )
    throw new AgentError(
      "Indica la fecha del hecho, su estado y los hechos contrastados.",
    );
  const item = await db.agentNews.findFirst({ where: { id, businessId } });
  const w = await db.agentWorkspace.findUniqueOrThrow({
    where: { businessId },
  });
  if (!item || item.status === "stale")
    throw new AgentError(
      "La noticia necesita una nueva revisión de fecha o de contenido.",
    );
  const age = Date.now() - Date.parse(eventDate);
  if (age < -3600000 || age > 14 * 86400000)
    throw new AgentError("El hecho no es una novedad vigente.");
  const evidence = Array.isArray(item.evidence) ? item.evidence : [];
  const primary = evidence.some(
    (e) =>
      e &&
      typeof e === "object" &&
      !Array.isArray(e) &&
      e.primary === true &&
      e.geography === industryFor(w.industry).geography,
  );
  if (!primary)
    throw new AgentError(
      "Añade una fuente primaria de la misma industria y zona antes de validar el hecho.",
    );
  const u = sourceUrl(item.canonicalUrl);
  const article = plain(await readSource(u.href, [u.origin]));
  if (article.length < 100)
    throw new AgentError("No se pudo leer la fuente original.");
  return db.agentNews.updateMany({
    where: { id, businessId, revision: item.revision },
    data: {
      status: "verified",
      retrievedAt: new Date(),
      eventDate: new Date(eventDate),
      summary: summary.trim(),
      evidence: json([
        ...evidence,
        {
          verifiedBy: "owner",
          checkedAt: new Date().toISOString(),
          factStatus,
          eventDate,
          originalRetrieved: true,
          excerpt: article.slice(0, 800),
        },
      ]),
      revision: { increment: 1 },
    },
  });
}
/** The cap or rate limit (429) and a pause that landed mid-tick (409): not an error of the cycle, only of that business now. */
const notNow = (error: unknown) =>
  error instanceof AgentError && (error.status === 429 || error.status === 409);
export async function runAgentCycle(businessId?: string) {
  if (process.env.MATYA_AGENT_ENABLED !== "true")
    return { steps: 0, published: 0 };
  // Only the worker's per-minute tick leaves its mark: an owner's cycle (`businessId`) is not the heartbeat. The revision stays
  // where it is, because a tick is not a settings change.
  if (businessId === undefined)
    await db.agentWorkspace.updateMany({ data: { tickAt: new Date() } });
  const workspaces = await db.agentWorkspace.findMany({
    // A paused workspace asks for nothing (`enqueue` refuses): no radar, no news checks.
    where: {
      ...(businessId ? { businessId } : {}),
      enabled: true,
      pausedAt: null,
    },
    take: 20,
  });
  for (const w of workspaces) {
    if (
      w.radarEnabled &&
      (!w.radarAt || Date.now() - w.radarAt.getTime() >= w.radarHours * 3600000)
    ) {
      const period = Math.floor(Date.now() / (w.radarHours * 3600000));
      try {
        await enqueue(w.businessId, {
          text: "Revisa las noticias de mi industria",
          kind: "radar",
          requestKey: `radar-${w.businessId}-${period}`,
        });
        await db.agentWorkspace.update({
          where: { businessId: w.businessId },
          data: { radarAt: new Date() },
        });
      } catch (error) {
        // This business is skipped (its radar is tried again on the next tick); the others and the drain go on.
        if (!notNow(error)) throw error;
      }
    }
  }
  for (const w of workspaces.filter((w) => w.radarEnabled)) {
    // A fixed request key per source revision prevents paid duplicate verification.
    const candidates = await db.agentNews.findMany({
      where: { businessId: w.businessId, status: "source_ready" },
      orderBy: { publishedAt: "desc" },
      take: 2,
    });
    for (const n of candidates) {
      try {
        await enqueue(w.businessId, {
          text: `Contrasta la fuente original: ${n.title}`,
          kind: "verify_news",
          newsId: n.id,
          requestKey: `verify-${n.id}-${n.revision}`,
        });
      } catch (error) {
        if (!notNow(error)) throw error;
      }
    }
  }
  // The morning plan goes in the queue before the cycle drains it. If it cannot be made, the queue is still worked.
  try {
    await enqueueDailyPlans(new Date(), businessId);
  } catch {
    console.error("MATYA daily plans did not complete");
  }
  const steps = await drain(businessId, 80000);
  // Only agent-owned posts; the legacy scheduler continues to own every other post.
  const posts = await db.post.findMany({
    where: {
      ...(businessId ? { businessId } : {}),
      status: "scheduled",
      scheduledAt: { lte: new Date() },
      campaign: { agentRunId: { not: null } },
    },
    take: 3,
    select: {
      id: true,
      businessId: true,
      campaign: { select: { agentRunId: true } },
    },
  });
  let published = 0;
  for (const post of posts) {
    const s = await db.agentWorkspace.findUnique({
      where: { businessId: post.businessId },
    });
    const run = post.campaign?.agentRunId
      ? await db.agentRun.findUnique({
          where: { id: post.campaign.agentRunId },
        })
      : null;
    if (
      !s?.enabled ||
      !s.allowPublish ||
      !run ||
      run.cancelRequested ||
      ["cancelled", "blocked", "uncertain"].includes(run.status)
    )
      continue;
    await publishPost(post.id);
    published++;
  }
  const waiting = await db.agentRun.findMany({
    where: {
      ...(businessId ? { businessId } : {}),
      status: "waiting_provider",
    },
    take: 30,
  });
  for (const run of waiting) {
    const p = await db.post.findFirst({
      where: { id: `agent-${run.id}`, businessId: run.businessId },
      select: { status: true },
    });
    // A render in progress (a campaign's video or a video piece's, whose wait is at another stage) is checked again every cycle.
    if (stepsOf(run)[run.stage] === "video_wait") {
      await db.agentRun.updateMany({
        where: { id: run.id, status: "waiting_provider" },
        data: { status: "queued" },
      });
      continue;
    }
    if (p && !["scheduled", "publishing"].includes(p.status))
      await db.agentRun.updateMany({
        where: { id: run.id, status: "waiting_provider" },
        data: { status: "queued" },
      });
    else if (
      p?.status === "publishing" &&
      Date.now() - run.updatedAt.getTime() > 15 * 60000
    )
      await db.agentRun.updateMany({
        where: { id: run.id, status: "waiting_provider" },
        data: {
          status: "uncertain",
          error:
            "El canal no confirmó el resultado dentro del plazo. Revisa Historial antes de reintentar; no se repitió el envío.",
        },
      });
  }
  // The team's email alerts go out from the worker's tick only (an owner's cycle is not it), after the queue was worked, the agent's
  // posts went out and the channel waits were swept, so they tell what is true now. They can never take the cycle down.
  if (businessId === undefined)
    try {
      await sendAgentAlerts(new Date());
    } catch (error) {
      console.error("MATYA alerts did not complete", error instanceof Error ? error.name : "unknown");
    }
  // The daily report of the businesses with team mode goes out from here too, once their morning plan is done (the cron of the
  // platform may run only once a day). It has its own try/catch: neither it nor the alerts can take the cycle down.
  if (businessId === undefined)
    try {
      await runDailyReports(new Date(), { max: 2, budgetMs: 15000, teamOnly: true });
    } catch (error) {
      console.error("MATYA daily reports did not complete", error instanceof Error ? error.name : "unknown");
    }
  return { steps, published };
}
