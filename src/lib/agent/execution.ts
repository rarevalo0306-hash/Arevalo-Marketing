import type { AgentRun } from "@prisma/client";
import { db } from "@/lib/db";
import { notesFor, type ChannelId } from "@/lib/channels";
import { localDay } from "@/lib/business-tz";
import { pauseCampaign } from "@/lib/campaign";
import { AgentError } from "./access";
import { Copy, Research, Reply, languageOf, type Context } from "./schema";
import { briefing } from "./context";
import { callCeiling, meteredAsk, modelConfig } from "./metered";
import {
  beginStep,
  claimRun,
  failRun,
  finishStep,
  json,
  locked,
  planStepMeta,
  recoverExpired,
  stepsOf,
  type StepResult,
} from "./queue";
import { collectNews, plain } from "./news";
import { z } from "zod";
import { readSource, sourceUrl } from "./network";
import {
  videoBusiness,
  planContext,
  createProject,
  startRender,
  advanceRender,
  videoBlocker,
  maxCentsPerVideo,
  projectCost,
} from "@/lib/video-jobs";
import { newsFresh } from "./freshness";
import { templateStoryboard, type VideoMedia } from "@/lib/video-plan";
import { optimizeEligible } from "./optimization";
import { SYSTEM, MEDIA_POLICY } from "./prompts";
import { boundedContext } from "./bounded-context";
import { libraryMedia } from "./library";
import {
  designAssets,
  designSummary,
  mediaSelection,
  writeCopy,
} from "./content-steps";
import { executeTeamStep } from "./team-execution";
// The team's plain-code steps register themselves when their module loads: this is what makes `dispatch` available.
import "./dispatch";

// The copy and design steps live in `content-steps` (the team's agents use them too); they are part of this module's API.
export { designAssets, writeCopy } from "./content-steps";

async function output(runId: string, name: string) {
  const step = await db.agentStep.findUniqueOrThrow({
    where: { runId_name: { runId, name } },
  });
  if (step.status !== "succeeded")
    throw new AgentError("Falta completar el paso anterior.");
  return step.output;
}
/** `run` is for the per-run costs of later steps (team agents, quoted renders); unused for now. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function stepCost(name: string, run?: AgentRun) {
  if (name === "video" && videoBlocker())
    throw new AgentError(
      "Falta configurar el render de video y su almacenamiento. Los diseños y el guion están guardados.",
    );
  return ["research", "copy", "conversation", "verify_news"].includes(name)
    ? callCeiling(modelConfig())
    : name === "video"
      ? maxCentsPerVideo()
      : 0;
}
export async function executeStep(
  run: AgentRun,
  name: string,
): Promise<StepResult> {
  const c = run.context as unknown as Context;
  if (c.business.id !== run.businessId)
    throw new AgentError("El contexto no corresponde a este negocio.");
  // The team's runs (and their pieces) are done by agents and MATYA steps.
  if (run.kind === "team" || run.kind === "piece")
    return executeTeamStep(run, name);
  const language = languageOf(run.prompt);
  if (name === "briefing")
    return {
      data: { text: briefing(c, language === "en"), links: c.tools },
      text: briefing(c, language === "en"),
    };
  if (name === "conversation") {
    const r = await meteredAsk(Reply, SYSTEM + "\n" + MEDIA_POLICY, {
      context: boundedContext(c),
      request: run.prompt,
    });
    return {
      data: { ...r.value, usage: r.usage },
      cents: r.usage.cents,
      text: r.value.text,
    };
  }
  if (name === "research") {
    const r = await meteredAsk(
      Research,
      SYSTEM + "\n" + MEDIA_POLICY +
        " You are the research/SEO specialist. Produce a source-grounded brief. No live search is available in this step. Clearly mark missing evidence and do not portray stale studies as current research.",
      { context: boundedContext(c), request: run.prompt },
    );
    const allowed = new Set([
      ...c.knowledge
        .filter((k) => Date.parse(k.expiresAt) > Date.now())
        .map((k) => k.url),
      ...(c.news ? [c.news.source] : []),
    ]);
    // A generated URL is not evidence. Strip unsupported facts before copy sees them.
    const value = {
      ...r.value,
      facts: r.value.facts.filter((f) => allowed.has(f.source)),
      uncertainties: [
        ...r.value.uncertainties,
        ...(r.value.facts.some((f) => !allowed.has(f.source))
          ? ["Se descartaron afirmaciones sin una fuente registrada."]
          : []),
      ],
    };
    return { data: { ...value, usage: r.usage }, cents: r.usage.cents };
  }
  if (name === "copy") {
    const research = await output(run.id, "research");
    const r = await writeCopy({
      context: c,
      research,
      request: run.prompt,
      model: modelConfig(),
    });
    return { data: { ...r.value, usage: r.usage }, cents: r.usage.cents };
  }
  if (name === "design") {
    const copy = Copy.parse(await output(run.id, "copy"));
    const { assets, mediaSelection: selection } = await designAssets({
      run,
      copy,
      language,
    });
    return {
      data: {
        assets,
        mediaSelection: selection,
        summary: designSummary(selection.libraryItems.length > 0, language),
        script: copy.script,
        videoStatus:
          run.kind === "video"
            ? "Guion y diseños listos para el render autorizado."
            : "Guion preparado. Puedes encargar un video con el presupuesto del agente.",
      },
    };
  }
  if (name === "verify_news") return verifyNewsAutomatically(run);
  if (name === "video") {
    if (videoBlocker())
      throw new AgentError(
        "Falta configurar el render de video y su almacenamiento. Los diseños y el guion están guardados.",
      );
    const copy = Copy.parse(await output(run.id, "copy"));
    const design = (await output(run.id, "design")) as {
      assets: { shape: string; url: string }[];
      mediaSelection?: { libraryItems?: { id: string }[] };
    };
    const business = await videoBusiness(run.businessId);
    // The design step of this same run just marked its photo as used today; the video may still use it.
    const ownMedia = await libraryMedia(
      run.businessId,
      `${run.prompt}\n${copy.title}\n${copy.headline}\n${copy.summary}`,
      language,
      undefined,
      (design.mediaSelection?.libraryItems ?? []).map((item) => item.id),
    );
    const media: VideoMedia[] = ownMedia.length ? ownMedia : design.assets.map((a, i) => ({
      id: `design-${i}`,
      kind: "photo",
      url: a.url,
      thumb: a.url,
      focus: null,
      width: a.shape === "wide" ? 1600 : 1080,
      height: a.shape === "story" ? 1920 : a.shape === "wide" ? 900 : 1080,
      durationSec: 0,
      about: copy.headline,
    }));
    const context = planContext(business, {
      idea: copy.script,
      format: "vertical",
      media,
      lang: language,
    });
    context.music = null;
    const sb = templateStoryboard(context);
    sb.music.on = false;
    sb.source = "ai";
    const cost = projectCost(sb);
    if (cost > maxCentsPerVideo())
      throw new AgentError(
        "El video supera el máximo autorizado. El guion y los diseños están guardados.",
      );
    const row = await createProject(run.businessId, sb);
    const project = await startRender(run.businessId, row.id, cost, "auto");
    if (ownMedia.length)
      await db.libraryItem.updateMany({
        where: { businessId: run.businessId, id: { in: ownMedia.map((m) => m.id) } },
        data: { usedCount: { increment: 1 }, lastUsedAt: new Date() },
      });
    return {
      data: {
        projectId: row.id,
        status: project.status,
        mediaSelection: mediaSelection(ownMedia),
        summary: ownMedia.length
          ? language === "en"
            ? "The video uses suitable photos and clips from this company's library. Only editing and rendering are requested, not AI-generated scenes."
            : "El video usa fotos y clips adecuados de la biblioteca de esta compañía. Solo se solicita montaje y render, sin generar escenas con IA."
          : language === "en"
            ? "No suitable library media was available. The video uses the prepared brand designs, without generating new AI scenes."
            : "No encontré material adecuado en la biblioteca. El video usa los diseños de marca preparados, sin generar escenas nuevas con IA.",
        script: copy.script,
        rights: ownMedia.length
          ? "Recursos habilitados de la biblioteca del negocio; sin búsqueda de clips externos"
          : "Diseños originales del negocio; sin clips de terceros",
        costBasis: "Reserva conservadora del máximo por video",
      },
      cents: maxCentsPerVideo(),
    };
  }
  if (name.startsWith("video_wait")) {
    const start = (await output(run.id, "video")) as { projectId: string };
    const project = await advanceRender(run.businessId, start.projectId);
    if (project.status === "failed")
      throw new AgentError(
        "El render de video falló. Revisa el proyecto en Videos antes de repetirlo.",
      );
    return {
      data: {
        projectId: start.projectId,
        status: project.status,
        videoUrl: project.videoUrl,
        texts: project.storyboard.texts,
      },
      ...(project.status === "ready"
        ? {}
        : { state: "waiting_provider" as const, advance: false }),
    };
  }
  if (name === "prepare") return prepareCampaign(run);
  if (name === "schedule") return scheduleCampaign(run);
  if (name === "verify") {
    const p = await db.post.findFirstOrThrow({
      where: { id: `agent-${run.id}`, businessId: run.businessId },
      include: { targets: true },
    });
    const channels = p.targets.map((t) => ({
      channel: t.channel,
      status: t.status,
      url: t.externalUrl,
      externalId: t.externalId,
      detail: t.detail,
    }));
    const sent = channels.filter((t) => t.status === "sent").length;
    return {
      data: {
        postId: p.id,
        campaignId: p.campaignId,
        channels,
        text: `${sent} de ${channels.length} canales confirmaron el envío. Consulta Historial para ver cada resultado.`,
        verification:
          "Respuesta del publicador; no equivale a verificar la página final de un despliegue web.",
      },
      text: `La campaña terminó su distribución: ${sent} de ${channels.length} canales confirmaron el envío. ${sent < channels.length ? "Quedaron canales que requieren atención." : ""} Puedes ver el detalle en Historial.`,
    };
  }
  if (name === "radar") {
    const news = await collectNews(run.businessId, c);
    return {
      data: news,
      text: news.text + (news.errors.length ? " " + news.errors.join(" ") : ""),
    };
  }
  if (name === "pause") {
    if (!c.campaignId) throw new AgentError("Falta la campaña.");
    const ok = await pauseCampaign(run.businessId, c.campaignId, {
      actor: "owner",
    });
    return {
      data: { campaignId: c.campaignId, paused: ok },
      text: ok
        ? "La campaña quedó pausada. Los envíos ya iniciados pueden terminar."
        : "La campaña no se pudo pausar; revisa su estado.",
    };
  }
  if (name === "optimize") return analyzeResults(run.businessId, c.revision);
  throw new AgentError("Paso desconocido.");
}
async function prepareCampaign(run: AgentRun): Promise<StepResult> {
  const copy = Copy.parse(await output(run.id, "copy"));
  const design = (await output(run.id, "design")) as {
    assets: { shape: string; url: string }[];
  };
  const research = Research.parse(await output(run.id, "research"));
  const s = await db.agentWorkspace.findUniqueOrThrow({
    where: { businessId: run.businessId },
  });
  const connected = await db.connection.findMany({
    where: { businessId: run.businessId },
    select: { channel: true },
  });
  const video =
    run.kind === "video"
      ? await db.agentStep.findFirst({
          where: {
            runId: run.id,
            name: { startsWith: "video_wait" },
            status: "succeeded",
          },
          orderBy: { createdAt: "desc" },
        })
      : null;
  const videoData = video?.output as {
    videoUrl?: string;
    texts?: {
      title: string;
      description: string;
      instagram: string;
      tiktok: string;
      facebook: string;
    };
  } | null;
  const variants = videoData?.texts
    ? {
        ...copy.variants,
        youtube: videoData.texts.description,
        instagram: videoData.texts.instagram,
        tiktok: videoData.texts.tiktok,
        facebook: videoData.texts.facebook,
      }
    : copy.variants;
  // Sin YouTube: el agente nunca sube videos a YouTube; esa subida siempre la aprueba una persona (Videos o Campañas).
  const supported =
    run.kind === "video"
      ? ["facebook", "instagram", "tiktok"]
      : Object.keys(copy.variants);
  const channels = s.channels.filter(
    (x) => supported.includes(x) && connected.some((c) => c.channel === x),
  );
  const blocked = s.channels.filter((x) => !channels.includes(x));
  if (!channels.length)
    throw new AgentError(
      "No hay canales compatibles conectados y autorizados para esta publicación con imagen. Revisa Conexiones y los permisos de MATYA.",
    );
  const image =
    run.kind === "video"
      ? videoData?.videoUrl
      : design.assets.find((x) => x.shape === "square")?.url;
  if (!image) throw new AgentError("El diseño no está listo.");
  for (const channel of channels) {
    const text = variants[channel as keyof typeof variants];
    const notes = notesFor(channel as ChannelId, {
      text,
      subject: copy.title,
      seoTitle: copy.title,
      mediaType: run.kind === "video" ? "video" : "photo",
    }).filter((n) => n.blocking);
    if (notes.length)
      throw new AgentError(
        `Revisa el texto de ${channel}: ${notes.map((n) => n.text).join(" ")}`,
      );
  }
  const campaignId = `agent-${run.id}`;
  const postId = `agent-${run.id}`;
  await locked(run.businessId, async (tx) => {
    const r = await tx.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    if (r.cancelRequested) throw new AgentError("Trabajo cancelado.");
    await tx.campaign.upsert({
      where: { id: campaignId },
      create: {
        id: campaignId,
        businessId: run.businessId,
        agentRunId: run.id,
        name: copy.title,
        goal: run.prompt,
        mode: s.mode,
        status: "draft",
        channels,
        keywords: research.keywords,
        perWeek: 1,
      },
      update: {},
    });
    await tx.post.upsert({
      where: { id: postId },
      create: {
        id: postId,
        businessId: run.businessId,
        campaignId,
        text: copy.variants.facebook,
        subject: copy.title,
        seoTitle: copy.title,
        variants: json(variants),
        mediaType: run.kind === "video" ? "video" : "photo",
        kind: run.kind === "video" ? "video" : "post",
        mediaUrl: image,
        altText: copy.alt,
        status: "draft",
        source: "ai",
        targets: { create: channels.map((channel) => ({ channel })) },
      },
      update: {},
    });
  });
  return {
    data: {
      campaignId,
      postId,
      channels,
      blockedChannels: blocked,
      assets: design.assets,
    },
    text: `Preparé «${copy.title}»: investigación, textos por canal, tres diseños y guion. ${blocked.length ? `No se programaron ${blocked.join(", ")} porque requieren otra conexión o formato.` : ""}`,
  };
}
async function scheduleCampaign(run: AgentRun): Promise<StepResult> {
  return locked(run.businessId, async (tx) => {
    const current = await tx.agentRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    const s = await tx.agentWorkspace.findUniqueOrThrow({
      where: { businessId: run.businessId },
    });
    const c = run.context as unknown as Context;
    if (
      current.cancelRequested ||
      !s.enabled ||
      !s.allowPublish ||
      s.revision !== c.revision ||
      (s.mode === "approval" && !current.approvedAt)
    )
      throw new AgentError(
        "La publicación no está autorizada con los permisos actuales.",
      );
    if (c.news) {
      const news = await tx.agentNews.findFirst({
        where: { id: c.news.id, businessId: run.businessId },
      });
      if (!news || !newsFresh(news) || news.revision !== c.news.revision)
        throw new AgentError(
          "La noticia cambió o requiere una nueva verificación.",
        );
    }
    const day = localDay(new Date(), c.business.timezone);
    const budget = await tx.agentBudget.upsert({
      where: { businessId_day: { businessId: run.businessId, day } },
      create: { businessId: run.businessId, day },
      update: {},
    });
    if (budget.posts >= s.maxPostsPerDay)
      throw new AgentError(
        "Se alcanzó el límite diario de publicaciones de MATYA.",
      );
    const post = await tx.post.findFirstOrThrow({
      where: { id: `agent-${run.id}`, businessId: run.businessId },
      include: { targets: true },
    });
    const connected = await tx.connection.findMany({
      where: { businessId: run.businessId },
      select: { channel: true },
    });
    if (
      post.targets.some(
        (t) =>
          !s.channels.includes(t.channel) ||
          !connected.some((c) => c.channel === t.channel),
      )
    )
      throw new AgentError("Una conexión o un canal autorizado cambió.");
    const changed = await tx.post.updateMany({
      where: { id: post.id, businessId: run.businessId, status: "draft" },
      data: { status: "scheduled", scheduledAt: new Date(Date.now() + 60000) },
    });
    if (changed.count)
      await tx.agentBudget.update({
        where: { id: budget.id },
        data: { posts: { increment: 1 } },
      });
    await tx.campaign.updateMany({
      where: {
        id: post.campaignId!,
        businessId: run.businessId,
        status: "draft",
      },
      data: { status: "active" },
    });
    return {
      data: {
        postId: post.id,
        campaignId: post.campaignId,
        status: "scheduled",
      },
      text: "La publicación quedó programada. MATYA espera la confirmación de cada canal; puedes seguirla en Historial.",
    };
  });
}
export async function analyzeResults(
  businessId: string,
  revision?: number,
): Promise<StepResult> {
  const now = new Date();
  const from = new Date(now.getTime() - 28 * 86400000);
  const campaigns = await db.campaign.findMany({
    where: { businessId },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      posts: {
        where: { createdAt: { gte: from } },
        select: {
          id: true,
          status: true,
          targets: {
            select: {
              channel: true,
              status: true,
              metrics: {
                orderBy: { fetchedAt: "desc" },
                take: 1,
                select: {
                  clicks: true,
                  impressions: true,
                  reach: true,
                  fetchedAt: true,
                },
              },
            },
          },
        },
      },
    },
  });
  const decisions = campaigns.map((c) => {
    const measuredPosts = c.posts.filter((p) =>
      p.targets.some((t) => t.status === "sent" && t.metrics.length),
    );
    const metrics = measuredPosts.flatMap((p) =>
      p.targets.filter((t) => t.status === "sent").flatMap((t) => t.metrics),
    );
    const impressions = metrics.reduce((s, m) => s + m.impressions, 0);
    const clicks = metrics.reduce((s, m) => s + m.clicks, 0);
    const age = (now.getTime() - c.createdAt.getTime()) / 86400000;
    const fresh =
      metrics.length > 0 &&
      metrics.every(
        (m) => now.getTime() - m.fetchedAt.getTime() < 3 * 86400000,
      );
    const enough =
      age >= 7 && measuredPosts.length >= 3 && impressions >= 1000 && fresh;
    return {
      campaignId: c.id,
      name: c.name,
      observedFrom: from.toISOString(),
      observedTo: now.toISOString(),
      measuredPosts: measuredPosts.length,
      impressions,
      clicks,
      decision: enough
        ? "Evaluar horarios y formatos sin aumentar presupuesto; comprobar el efecto durante siete días."
        : "Conservar la configuración: faltan volumen, antigüedad o mediciones recientes.",
      confidence: enough ? "hipotesis" : "insuficiente",
      conversions: null,
      costPerConversion: null,
      reason:
        "Las interacciones no demuestran conversiones ni causalidad. No se aumentó el gasto.",
    };
  });
  const changes =
    revision === undefined
      ? []
      : await optimizeEligible(
          businessId,
          decisions
            .filter((d) => d.confidence === "hipotesis")
            .map((d) => d.campaignId),
          revision,
        );
  return {
    data: { decisions, changes },
    text: decisions.length
      ? `Revisé ${decisions.length} campañas. ${decisions.filter((d) => d.confidence === "insuficiente").length} no tienen evidencia suficiente para ajustar su rendimiento. Registré ${changes.length} propuestas de horarios o formatos; ${changes.filter((c) => c.applied).length} se aplicaron con los permisos de la campaña. Puedes revisarlas y deshacer los cambios desde Propuestas.`
      : "Todavía no hay campañas que medir. La optimización comienza con publicaciones y resultados comprobables.",
  };
}
export type Executor = (run: AgentRun, name: string) => Promise<StepResult>;
export async function workOne(
  businessId?: string,
  execute: Executor = executeStep,
  costOf: (name: string, run: AgentRun) => number = stepCost,
) {
  const run = await claimRun(businessId);
  if (!run) return false;
  try {
    let name = stepsOf(run)[run.stage];
    if (!name)
      throw new AgentError("El trabajo no tiene un siguiente paso válido.");
    if (name === "schedule") {
      const s = await db.agentWorkspace.findUniqueOrThrow({
        where: { businessId: run.businessId },
      });
      if (!s.allowPublish || (s.mode === "approval" && !run.approvedAt)) {
        await db.agentRun.updateMany({
          where: { id: run.id, leaseToken: run.leaseToken, status: "running" },
          data: {
            status: "waiting_approval",
            leaseToken: "",
            leaseUntil: null,
          },
        });
        return true;
      }
    }
    if (name === "verify") {
      const p = await db.post.findFirst({
        where: { id: `agent-${run.id}`, businessId: run.businessId },
        select: { status: true },
      });
      if (p && ["scheduled", "publishing"].includes(p.status)) {
        await db.agentRun.updateMany({
          where: { id: run.id, leaseToken: run.leaseToken },
          data: {
            status: "waiting_provider",
            leaseToken: "",
            leaseUntil: null,
          },
        });
        return true;
      }
    }
    const cost = costOf(name, run);
    if (name === "video_wait") {
      const attempts = await db.agentStep.count({
        where: { runId: run.id, name: { startsWith: "video_wait:" } },
      });
      if (attempts >= 30)
        throw new AgentError(
          "El proveedor aún no confirmó el video. Consulta el proyecto en Videos; no se inició otro render.",
        );
      name = `video_wait:${attempts}`;
    }
    await beginStep(run.id, run.leaseToken, name, cost, planStepMeta(run));
    const result = await execute(run, name);
    await finishStep(run.id, run.leaseToken, name, result);
  } catch (error) {
    const message =
      error instanceof AgentError
        ? error.message
        : "No pude completar este paso. Conservé el resultado anterior y detuve los reintentos automáticos; revisa el detalle del trabajo.";
    await failRun(run.id, run.leaseToken, message);
    // No raw provider bodies, secrets, prompts or customer records in logs.
    console.error("MATYA step failed", {
      runId: run.id,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
  return true;
}
export async function drain(businessId?: string, budgetMs = 90000) {
  const until = Date.now() + budgetMs;
  await recoverExpired();
  let count = 0;
  while (Date.now() < until - 15000 && count < 6 && (await workOne(businessId)))
    count++;
  return count;
}

const Verification = z.object({
  relevant: z.boolean(),
  eventDate: z.string(),
  status: z.enum(["proposed", "approved", "effective", "not_legal", "unknown"]),
  effectiveDate: z.string(),
  summary: z.string().max(1800),
  quotes: z.array(z.string().min(20).max(300)).max(4),
  contradiction: z.boolean(),
});
async function verifyNewsAutomatically(run: AgentRun): Promise<StepResult> {
  const c = run.context as unknown as Context;
  if (!c.news) throw new AgentError("Selecciona una noticia para contrastar.");
  const n = await db.agentNews.findFirstOrThrow({
    where: { id: c.news.id, businessId: run.businessId },
  });
  if (!["source_ready", "detected", "changed"].includes(n.status))
    throw new AgentError(
      "La fecha o la fuente de esta noticia necesita revisión.",
    );
  const evidence = Array.isArray(n.evidence) ? n.evidence : [];
  const primary = evidence.some(
    (e) =>
      e &&
      typeof e === "object" &&
      !Array.isArray(e) &&
      e.primary === true &&
      e.geography === c.industry.geography,
  );
  if (!primary)
    throw new AgentError(
      "Falta una fuente primaria del territorio del negocio.",
    );
  const u = sourceUrl(n.canonicalUrl);
  const article = plain(await readSource(u.href, [u.origin])).slice(0, 14000);
  const result = await meteredAsk(
    Verification,
    SYSTEM +
      " Verify the event against this primary source. All quotes must be exact contiguous text from the article. Use ISO YYYY-MM-DD for dates, or empty if unknown. Distinguish the event date and the effective date of a law. Do not approve an unconfirmed, contradictory or geographically irrelevant story.",
    {
      industry: c.industry,
      article,
      url: u.href,
      publishedAt: n.publishedAt,
      now: new Date().toISOString(),
    },
  );
  const v = result.value;
  const date = Date.parse(v.eventDate);
  const effective = Date.parse(v.effectiveDate);
  const fresh =
    Number.isFinite(date) &&
    Date.now() - date >= 0 &&
    Date.now() - date <= 14 * 86400000;
  const quoted =
    v.quotes.length > 0 && v.quotes.every((q) => article.includes(q));
  const verified =
    v.relevant &&
    fresh &&
    quoted &&
    !v.contradiction &&
    v.status !== "unknown" &&
    (v.status !== "effective" ||
      (Number.isFinite(effective) && effective <= Date.now()));
  const changed = await db.agentNews.updateMany({
    where: { id: n.id, businessId: run.businessId, revision: n.revision },
    data: {
      status: verified ? "verified" : "needs_review",
      retrievedAt: new Date(),
      eventDate: Number.isFinite(date) ? new Date(date) : null,
      summary: v.summary,
      evidence: json([
        ...evidence,
        {
          url: u.href,
          checkedAt: new Date().toISOString(),
          verifiedBy: "matya",
          factStatus: v.status,
          effectiveDate: v.effectiveDate,
          quotes: v.quotes,
          verified,
        },
      ]),
      revision: { increment: 1 },
    },
  });
  return {
    data: {
      newsId: n.id,
      verified: verified && changed.count === 1,
      summary: v.summary,
      source: u.href,
      usage: result.usage,
    },
    cents: result.usage.cents,
    text:
      verified && changed.count === 1
        ? "Contrasté la noticia con su fuente primaria, fecha y territorio. Ya puedes crear contenido original."
        : "La noticia necesita revisión: no se creó ni publicó contenido con hechos sin confirmar.",
  };
}
