// Los pasos de una pieza que mueven dinero: el render del video, el artículo para la web y su publicación. Son código de MATYA (sin
// IA), menos la redacción del artículo, que hace el agente de redacción. Cada uno cuesta algo que el dueño debe haber visto:
// - `render`: reserva exactamente lo que el paso `video` cotizó (y el dueño aprobó), y no empieza si pasa del máximo por video.
// - `article`: es de pago (Google y la IA del negocio) y esa IA no informa su consumo. Antes de llamar al escritor el dueño aprueba
//   un «hasta US$X» (el tope de lo que el código le pide al proveedor, ver `article-cost.ts`); se reserva eso y no más: si el
//   estimado sube después de aprobarlo, se le vuelve a preguntar. Una vuelta de corrección (`article-r<n>`) es otro borrador de pago
//   y pide su propia aprobación.
// - `article_publish`: prepara la vista previa (la traducción, unos centavos) y, si la foto no cuesta más, publica; al publicar, el
//   artículo cuenta como una publicación del día. Una foto que la IA tendría que crear espera la aprobación del dueño: sin ella no
//   se genera ninguna imagen. Cada pasada se liga al reporte actual del artículo: la aprobación de una foto no vale para otro borrador.
// Todo lo que se puede rechazar se rechaza antes de reservar (`pieceStepCost`), así un "no" no cuesta nada. `approvalNeeded` es la
// puerta de `workOne`: un paso de pago sin la aprobación del dueño deja el trabajo esperando, sin reservar ni llamar a nadie.
import type { AgentRun } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { pickText, aiEnabled } from "@/lib/ai";
import { usd } from "@/lib/rankfix-shape";
import { SITE_TEXT_CENTS } from "@/lib/seo/site-article";
import { sitePhotoApproval } from "@/lib/seo/site-article-run";
import { articleSetup } from "@/lib/seo/writer-run";
import {
  advanceRender,
  maxCentsPerVideo,
  maxVideosPerDay,
  projectCost,
  rendersToday,
  videoBlocker,
} from "@/lib/video-jobs";
import type { Storyboard } from "@/lib/video-plan";
import { AgentError } from "./access";
import { articleApprovalText, articleKeyword, articleReserve } from "./article-cost";
import {
  approvedAfterReview,
  articleRefusal,
  assertCanSchedule,
  refusalOf,
  Refusal,
  switchesRefusal,
  todayOf,
} from "./guard";
import { isArticleStep, Piece } from "./plan";
import { json, locked, type StepResult } from "./queue";
import { languageOf } from "./schema";
import { registerMatyaStep } from "./team-execution";
import { agentErrorOf, readStepOutput, toolsFor } from "./tools";

const NO_RENDER =
  "Falta configurar el render de video y su almacenamiento. Los diseños y el guion están guardados.";

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `v[key]` of whatever it is, or undefined; never throws (stored JSON). */
function field(v: unknown, key: string): unknown {
  try {
    return isObject(v) ? v[key] : undefined;
  } catch {
    return undefined;
  }
}

// ---------- The video ----------

/** What the `video` step left: the quoted storyboard and its price, and the library items it uses. */
const QuotedVideo = z.object({
  storyboard: z.record(z.string(), z.unknown()),
  cents: z.number().int().nonnegative(),
  mediaSelection: z
    .object({ libraryItems: z.array(z.object({ id: z.string() })).default([]) })
    .optional(),
});

/** The latest quote of the piece's `video` step, or null when it has none we can read. */
async function quotedVideo(run: AgentRun) {
  const quote = QuotedVideo.safeParse(await readStepOutput(run, "video"));
  return quote.success ? quote.data : null;
}

/**
 * What the `render` step reserves: exactly the cents the video was quoted at, nothing else. Every refusal here happens before
 * anything is reserved: MATYA paused or off, a render that is not configured, a quote over the maximum per video, a price that no
 * longer matches the storyboard (the quote is what the owner approved) and the day's limit of videos.
 */
async function renderCost(run: AgentRun): Promise<number> {
  const off = switchesRefusal(await db.agentWorkspace.findUniqueOrThrow({ where: { businessId: run.businessId } }));
  if (off) throw new Refusal(off);
  if (videoBlocker()) throw new AgentError(NO_RENDER);
  const quote = await quotedVideo(run);
  if (!quote) throw new AgentError("Falta completar el paso anterior.");
  if (quote.cents > maxCentsPerVideo())
    throw new AgentError("El video supera el máximo autorizado. El guion y los diseños están guardados.");
  if (projectCost(quote.storyboard as unknown as Storyboard) !== quote.cents)
    throw new AgentError("El precio del video cambió desde que se cotizó. Pide el video otra vez para cotizarlo de nuevo.");
  if ((await rendersToday(run.businessId)) >= maxVideosPerDay())
    throw new AgentError(
      `Ya se crearon ${maxVideosPerDay()} videos en las últimas 24 horas (es el tope). Intenta mañana.`,
    );
  return quote.cents;
}

/** The `render` step: starts the render the owner approved, with the quoted storyboard and exactly its quoted price. */
async function renderStep(run: AgentRun): Promise<StepResult> {
  const quote = await quotedVideo(run);
  if (!quote) throw new AgentError("Falta completar el paso anterior.");
  const tools = toolsFor({ key: "matya", tools: ["startVideo"] }, run);
  const started = await tools.use("startVideo")(quote.storyboard as unknown as Storyboard, quote.cents, "approved");
  // The library photos and clips the video uses count as used, as in the campaigns' video.
  const used = quote.mediaSelection?.libraryItems.map((item) => item.id) ?? [];
  if (used.length)
    await db.libraryItem.updateMany({
      where: { businessId: run.businessId, id: { in: used } },
      data: { usedCount: { increment: 1 }, lastUsedAt: new Date() },
    });
  return {
    data: { projectId: started.projectId, status: started.status, cents: quote.cents },
    cents: quote.cents,
    text:
      languageOf(run.prompt) === "en"
        ? `I started creating the video (${usd(quote.cents)}).`
        : `Empecé a crear el video (${usd(quote.cents)}).`,
  };
}

/**
 * Checks on a render in progress (`video_wait:<n>`), for a campaign's video and a piece's alike: still working waits for the
 * provider without advancing; ready moves on; failed stops the work. It starts nothing, so it never renders twice.
 */
export async function waitForVideo(businessId: string, projectId: string): Promise<StepResult> {
  const project = await advanceRender(businessId, projectId);
  if (project.status === "failed")
    throw new AgentError("El render de video falló. Revisa el proyecto en Videos antes de repetirlo.");
  return {
    data: {
      projectId,
      status: project.status,
      videoUrl: project.videoUrl,
      texts: project.storyboard.texts,
    },
    ...(project.status === "ready" ? {} : { state: "waiting_provider" as const, advance: false }),
  };
}

/** A piece's wait reads the project its `render` step started. */
async function pieceVideoWait(run: AgentRun): Promise<StepResult> {
  const projectId = field(await readStepOutput(run, "render"), "projectId");
  if (typeof projectId !== "string" || !projectId) throw new AgentError("Falta completar el paso anterior.");
  return waitForVideo(run.businessId, projectId);
}

// ---------- The article ----------

/** The saved report the piece's latest `article` step wrote. */
async function articleReportId(run: AgentRun): Promise<string> {
  const id = field(await readStepOutput(run, "article"), "reportId");
  if (typeof id !== "string" || !id) throw new AgentError("Falta completar el paso anterior.");
  return id;
}

/** The piece's plan, when it is an article's. */
function articlePiece(run: AgentRun): Piece {
  const piece = Piece.safeParse(field(run.context, "piece"));
  if (!piece.success || piece.data.format !== "articulo") throw new AgentError("La pieza no tiene un plan válido.");
  return piece.data;
}

/**
 * What the `article` steps reserve: the estimate the owner is asked to approve (Google and the AI that writes). Nothing is
 * reserved, and nobody is asked, for an article that could not be written or published afterwards: MATYA paused or off, web
 * articles not allowed, the website not connected, DataForSEO or the AI not connected, or no Google area.
 */
async function articleCost(run: AgentRun): Promise<number> {
  const piece = articlePiece(run);
  const [ws, connections, posts] = await Promise.all([
    db.agentWorkspace.findUniqueOrThrow({ where: { businessId: run.businessId } }),
    db.connection.findMany({ where: { businessId: run.businessId }, select: { channel: true } }),
    postsToday(run),
  ]);
  const refusal = articleRefusal(ws, connections.map((c) => c.channel), posts);
  if (refusal) throw new Refusal(refusal);
  try {
    const { business } = await articleSetup(run.businessId, articleKeyword(piece));
    return articleReserve(pickText(business.aiText));
  } catch (e) {
    throw agentErrorOf(e);
  }
}

/** The posts MATYA already scheduled or published today in the business's own day (`AgentBudget.posts`); an article counts as one. */
async function postsToday(run: AgentRun): Promise<number> {
  const { day } = await todayOf(db, run.businessId, new Date());
  const budget = await db.agentBudget.findUnique({
    where: { businessId_day: { businessId: run.businessId, day } },
    select: { posts: true },
  });
  return budget?.posts ?? 0;
}

/**
 * Why an article may not be published now (the guard's rules for a website article, the day's limit of posts included), as a
 * `Refusal`; nothing is spent. The approval after the review is not asked here: a piece without it waits for the owner instead
 * (`approvalNeeded`). The binding check is `claimPostSlot`, under the business lock.
 */
async function assertCanPublish(run: AgentRun): Promise<void> {
  const [ws, connections, posts] = await Promise.all([
    db.agentWorkspace.findUniqueOrThrow({ where: { businessId: run.businessId } }),
    db.connection.findMany({ where: { businessId: run.businessId }, select: { channel: true } }),
    postsToday(run),
  ]);
  const refusal = refusalOf({
    ws,
    format: "articulo",
    approved: true,
    channels: ["seo"],
    connected: connections.map((c) => c.channel),
    braked: [],
    posts,
  });
  if (refusal) throw new Refusal(refusal);
}

/**
 * Takes the article's place among today's posts, inside the business lock and with the guard's full check (including the approval
 * after the review in approval mode and the day's limit): two articles, or an article and a post, published at the same time
 * never pass `maxPostsPerDay` together. It runs right before the article is authorized, so it counts once, when it is published;
 * a preview that waits for the owner's photo approval counts nothing. A refusal here comes after the translation was paid, so
 * that step holds its reservation (uncertain), as any step that fails after spending does.
 */
async function claimPostSlot(run: AgentRun): Promise<void> {
  await locked(run.businessId, async (tx) => {
    const current = await tx.agentRun.findFirstOrThrow({ where: { id: run.id, businessId: run.businessId } });
    if (current.cancelRequested) throw new Refusal("Trabajo cancelado.");
    const ws = await tx.agentWorkspace.findUniqueOrThrow({ where: { businessId: run.businessId } });
    const now = new Date();
    await assertCanSchedule(tx, current, ws, ["seo"], now);
    const { day } = await todayOf(tx, run.businessId, now);
    await tx.agentBudget.upsert({
      where: { businessId_day: { businessId: run.businessId, day } },
      create: { businessId: run.businessId, day, posts: 1 },
      update: { posts: { increment: 1 } },
    });
  });
}

/** The records of `article_publish` already made for this piece, oldest first. */
const earlierPublish = (run: AgentRun) =>
  db.agentStep.findMany({
    where: { runId: run.id, run: { businessId: run.businessId }, name: { startsWith: "article_publish" } },
    orderBy: { createdAt: "asc" },
    select: { name: true, status: true, output: true, finishedAt: true },
  });

type PublishPass = {
  /** The record name of this pass: the first keeps the step's name, every later one adds `:<n>`. */
  name: string;
  /** The article report this pass publishes: the one of the piece's latest `article` step. */
  reportId: string;
  /** The pass that already prepared THIS report and is waiting for the owner's approval of its photo, if any. */
  parked: { status: string; output: unknown; finishedAt: Date | null } | null;
};

/**
 * Which pass of `article_publish` this is. It belongs to the CURRENT article report: only an earlier pass that prepared this very
 * report counts (its output carries the report's id), so after a redo (a new draft, a new report) the publication starts again
 * with a fresh first pass, and the approval of an earlier draft's photo never authorizes this one.
 */
async function publishPass(run: AgentRun): Promise<PublishPass> {
  const [reportId, before] = await Promise.all([articleReportId(run), earlierPublish(run)]);
  const mine = before.filter((b) => field(b.output, "reportId") === reportId);
  return {
    name: before.length ? `article_publish:${before.length}` : "article_publish",
    reportId,
    parked: mine.length ? mine[mine.length - 1] : null,
  };
}

/**
 * What `article_publish` reserves. First pass: the translation. Second pass (the owner approved this report's AI photo): the photo,
 * at the price the owner was shown; a price that went up since, or a preview that went stale, is refused before anything is
 * reserved or generated.
 */
async function publishCost(run: AgentRun): Promise<number> {
  await assertCanPublish(run);
  const { reportId, parked } = await publishPass(run);
  if (!parked) {
    if (!aiEnabled())
      throw new AgentError("Falta la clave de la IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en Vercel.");
    return SITE_TEXT_CENTS;
  }
  const shown = field(parked.output, "photoCents");
  if (parked.status !== "succeeded" || field(parked.output, "published") !== false || typeof shown !== "number")
    throw new AgentError("Este artículo no espera la aprobación de una foto.");
  let current: number;
  try {
    current = (await sitePhotoApproval(run.businessId, reportId)).cents;
  } catch (e) {
    throw agentErrorOf(e);
  }
  if (current > shown)
    throw new AgentError(
      `El precio de la foto cambió: ahora cuesta ${usd(current)} y habías visto ${usd(shown)}. Pide la publicación otra vez para verlo y aprobarlo.`,
    );
  return current;
}

/** The record name of this pass of `article_publish` (see `publishPass`). */
export async function publishStepName(run: AgentRun): Promise<string> {
  return (await publishPass(run)).name;
}

/** What the owner reads when an article waits for the approval of its AI photo. */
function photoText(photo: string, title: string, cents: number, language: "es" | "en"): string {
  return photo === "generated"
    ? language === "en"
      ? `The AI photo of "${title}" is already created and costs nothing more. Approve it to publish the article.`
      : `La foto con IA de «${title}» ya está creada y no cuesta más. Apruébalo para publicar el artículo.`
    : language === "en"
      ? `I prepared the article "${title}" for your website, but no photo in your library fits the topic. Creating one with AI costs ${usd(cents)}. Approve it to create the photo and publish the article; no image is generated until then.`
      : `Preparé el artículo «${title}» para tu web, pero ninguna foto de tu biblioteca va con el tema. Crear una con IA cuesta ${usd(cents)}. Apruébalo para crear la foto y publicar el artículo; no se genera ninguna imagen hasta entonces.`;
}

/** What the owner reads when the article is on the website. */
function publishedText(urlEs: string, urlEn: string, already: boolean, photoFailed: boolean, language: "es" | "en"): string {
  const extra = photoFailed
    ? language === "en"
      ? " The photo could not be uploaded, so it uses the website's topic photo."
      : " La foto no se pudo subir: el artículo usa la foto del tema de tu web."
    : "";
  return language === "en"
    ? `${already ? "The article was already on your website" : "The article is on your website"}: ${urlEs} (${urlEn}).${extra}`
    : `${already ? "El artículo ya estaba en tu web" : "El artículo quedó publicado en tu web"}: ${urlEs} (${urlEn}).${extra}`;
}

/**
 * The `article_publish` step. First pass: prepares the website version (the translation, a few cents) and, when its photo costs
 * nothing extra, publishes it. When the photo is an AI image to create (or one created that the owner has not approved), it waits
 * for the owner without generating or publishing anything. Second pass (`article_publish:<n>`, after the owner's approval): it
 * authorizes the prepared version, and that is when the photo is created. The charge is the reservation: the translation, or the photo.
 */
async function publishStep(run: AgentRun, stepId: string): Promise<StepResult> {
  const language = languageOf(run.prompt);
  const { reportId, parked } = await publishPass(run);
  // What this pass reserved is what it costs: the translation, or the photo the owner approved (and the price it must still have).
  const reserved = await db.agentStep.findFirst({
    where: { runId: run.id, run: { businessId: run.businessId }, name: stepId },
    select: { reservedCents: true },
  });
  const cents = reserved?.reservedCents ?? 0;
  const tools = toolsFor({ key: "matya", tools: ["publishArticle"] }, run);
  const beforePublish = () => claimPostSlot(run);
  const r = await tools.use("publishArticle")(
    reportId,
    parked ? { approved: true, expectedCents: cents, beforePublish } : { beforePublish },
  );
  if (!r.published)
    return {
      data: { reportId, published: false, photo: r.photo, photoCents: r.photoCents, title: r.title, urlEs: r.urlEs, urlEn: r.urlEn },
      cents,
      text: photoText(r.photo, r.title, r.photoCents, language),
      state: "waiting_approval",
      advance: false,
    };
  return {
    data: { reportId, published: true, url: r.url, urlEn: r.urlEn, photoFailed: r.photoFailed, already: r.already },
    cents,
    text: publishedText(r.url, r.urlEn, r.already, r.photoFailed, language),
  };
}

// ---------- What workOne asks ----------

/**
 * What a piece's step reserves when it is one of these (`video`, `render`, `article`, `article-r<n>`, `article_publish`), or null
 * for any other step (they keep their usual cost). Throws an `AgentError` (a `Refusal` for a switch) when it must not run.
 */
export async function pieceStepCost(name: string, run: AgentRun): Promise<number | null> {
  // The video step only quotes: the render configuration is checked here so nobody is asked to approve what cannot be made.
  if (name === "video") {
    const off = switchesRefusal(await db.agentWorkspace.findUniqueOrThrow({ where: { businessId: run.businessId } }));
    if (off) throw new Refusal(off);
    if (videoBlocker()) throw new AgentError(NO_RENDER);
    return 0;
  }
  if (name === "render") return renderCost(run);
  if (isArticleStep(name)) return articleCost(run);
  if (name === "article_publish") return publishCost(run);
  return null;
}

/** The latest time a step of the run finished, or null when none did. */
async function lastFinished(run: AgentRun, name?: string): Promise<Date | null> {
  const last = await db.agentStep.findFirst({
    where: {
      runId: run.id,
      run: { businessId: run.businessId },
      finishedAt: { not: null },
      ...(name ? { name } : {}),
    },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true },
  });
  return last?.finishedAt ?? null;
}

/** The owner approved after `since` (at that same moment counts): an approval from before is for something else. */
const approvedSince = (run: AgentRun, since: Date | null) =>
  run.approvedAt !== null && (since === null || run.approvedAt.getTime() >= since.getTime());

/** What `workOne` tells the owner when a step must wait, and what it asked (so a changed ask is noticed when they approve). */
export type OwnerWait = { text: string; asked?: { step: string; cents: number } };

/** What the run asked the owner for the step `name` the last time it waited, or null. */
function askedOf(run: AgentRun, name: string): { cents: number; at: Date } | null {
  const asked = field(run.result, "asked");
  const at = typeof field(asked, "at") === "string" ? new Date(field(asked, "at") as string) : null;
  const cents = field(asked, "cents");
  return field(asked, "step") === name && typeof cents === "number" && at !== null && !Number.isNaN(at.getTime())
    ? { cents, at }
    : null;
}

/**
 * Whether the piece's step `name`, which would reserve `cost`, must wait for the owner first, and what to tell them. null: it
 * may go on. A paid step needs an approval given after the moment it asked for it:
 * - `render` (it costs): after the video's quote.
 * - `article`, `article-r<n>` (they cost): after the run last asked for that draft, and for no more than it asked (a dearer
 *   estimate, such as another AI provider, asks again). The first draft's approval does not pay for a rework draft.
 * - `article_publish`: in approval mode after an approval given after the review; its second pass (an AI photo) after the first
 *   pass of the same article report that showed its price.
 * A step that costs nothing never waits, and nothing here reserves or calls anyone.
 */
export async function approvalNeeded(run: AgentRun, name: string, cost: number): Promise<OwnerWait | null> {
  const language = languageOf(run.prompt);
  if (name === "render" && cost > 0) {
    if (approvedSince(run, await lastFinished(run, "video"))) return null;
    return {
      text:
        language === "en"
          ? `The video needs your approval before it is generated (${usd(cost)}). Approve it to start.`
          : `El video necesita tu aprobación antes de generarse (${usd(cost)}). Apruébalo para empezar.`,
    };
  }
  if (isArticleStep(name) && cost > 0) {
    const asked = askedOf(run, name);
    const approved = asked !== null && approvedSince(run, asked.at);
    if (approved && cost <= asked.cents) return null;
    const business = await db.business.findUnique({ where: { id: run.businessId }, select: { aiText: true } });
    return {
      text: articleApprovalText(
        articleKeyword(articlePiece(run)),
        pickText(business?.aiText ?? ""),
        language,
        name !== "article",
        approved,
      ),
      asked: { step: name, cents: cost },
    };
  }
  if (name === "article_publish") {
    const [ws, pass] = await Promise.all([
      db.agentWorkspace.findUniqueOrThrow({ where: { businessId: run.businessId } }),
      publishPass(run),
    ]);
    // Like a post's schedule step: a piece that reaches its publication without the approval it needs waits for it.
    if (ws.mode === "approval" && !(await approvedAfterReview(db, run)))
      return {
        text:
          language === "en"
            ? "The article needs your approval after its review before it is published. Approve it to publish."
            : "El artículo necesita tu aprobación después de su revisión para publicarse. Apruébalo para publicarlo.",
      };
    if (pass.parked && !approvedSince(run, pass.parked.finishedAt))
      return {
        text:
          language === "en"
            ? "The article's photo needs your approval before it is created. Approve it to publish."
            : "La foto del artículo necesita tu aprobación antes de crearse. Apruébalo para publicar.",
      };
  }
  return null;
}

/**
 * Leaves the run waiting for the owner with `text` (their next read), without a step: nothing was reserved or started. `asked`
 * is remembered in the run's result with the moment, so the approval that follows is checked against what was asked.
 */
export async function waitForOwner(run: AgentRun, wait: OwnerWait): Promise<void> {
  const parked = await db.agentRun.updateMany({
    where: { id: run.id, businessId: run.businessId, leaseToken: run.leaseToken, status: "running" },
    data: {
      status: "waiting_approval",
      leaseToken: "",
      leaseUntil: null,
      ...(wait.asked ? { result: json({ asked: { ...wait.asked, at: new Date().toISOString() } }) } : {}),
    },
  });
  if (!parked.count) return;
  await db.agentMessage.upsert({
    where: { runId_role: { runId: run.id, role: "assistant" } },
    create: { businessId: run.businessId, runId: run.id, role: "assistant", text: wait.text.slice(0, 6000) },
    update: { text: wait.text.slice(0, 6000) },
  });
}

registerMatyaStep("render", renderStep);
registerMatyaStep("video_wait", pieceVideoWait);
registerMatyaStep("article_publish", publishStep);
