import { db } from "@/lib/db";
import { localDay } from "@/lib/business-tz";
import { publishPost } from "@/lib/publish";
import { AgentError } from "./access";
import { modelConfig } from "./metered";
import { enqueue, json, stepsOf } from "./queue";
import { enqueueDailyPlans } from "./daily";
import { drain } from "./execution";
import { loadContext } from "./context";
import { industryFor, toolCatalog } from "./industry";
import { readSource, sourceUrl } from "./network";
import { plain } from "./news";

export async function snapshot(businessId: string) {
  const [context, settings, runs, messages, news] = await Promise.all([
    loadContext(businessId),
    db.agentWorkspace.findUnique({ where: { businessId } }),
    db.agentRun.findMany({
      where: { businessId },
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
    }),
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
  const day = localDay(new Date(), context.business.timezone);
  const budget = await db.agentBudget.findUnique({
    where: { businessId_day: { businessId, day } },
  });
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
  return { steps, published };
}
