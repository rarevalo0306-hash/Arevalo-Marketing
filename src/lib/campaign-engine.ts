// Motor de campañas automáticas. Lo llama el cron (src/app/api/cron/route.ts) cada minuto.
//
// Para cada campaña activa «Con tu aprobación» o «100% IA» prepara las publicaciones de los próximos días:
// la IA escribe el texto de cada canal (con las palabras clave del negocio, la identidad de la marca y el objetivo),
// elige una foto real del negocio (o, si el dueño lo permitió y cabe en el tope, una foto con IA) y la guarda:
//  - approval → borrador (el dueño lo aprueba en Campañas o en «Ideas y plan con IA»),
//  - auto     → programada, solo si checkPost() la deja (si no, se anota limit.reached y se salta),
//  - manual   → el motor no hace nada.
// Todo queda en el registro (logAiAction). Es seguro si el cron corre dos veces a la vez: cada campaña se «toma»
// con un candado (como publishPost) y cada horario atendido se recuerda para no repetirlo nunca.

import type { Business, Campaign, Connection, Prisma } from "@prisma/client";
import { writePost, type AiPostOut, toPostFields } from "@/lib/ai";
import { logAiAction } from "@/lib/ai-actions";
import { aiSpentCents, campaignAlert, campaignKeywords, pauseCampaign, patchEngine, rulesOf, endDueCampaigns, type Bi } from "@/lib/campaign";
import {
  aiImageCents,
  bannedHits,
  campaignSlots,
  canClaim,
  centsText,
  checkPost,
  decideStatus,
  dueSlots,
  failuresInRow,
  kindLabel,
  pickKind,
  readEngine,
  readRules,
  reasonText,
  rulesJson,
  SAFETY_TOPICS,
  slotCounts,
  slotKey,
  writeLang,
  type CampaignRules,
  type CheckCounts,
  type EngineState,
  type PendingVideo,
  type PostKind,
  type Reason,
} from "@/lib/campaign-shape";
import { channelName } from "@/lib/channels";
import { recentOpenings } from "@/lib/content-ideas";
import { db } from "@/lib/db";
import { BUILTIN_TEMPLATES, pickTemplate, StoredTemplate, type DesignShape } from "@/lib/design-shapes";
import { createImage, imagesEnabled, pickImage } from "@/lib/imagegen";
import { pickLibraryPhoto, pickLibraryPhotos } from "@/lib/library";
import { photoContextFor, photoMetaFor, storeDesign } from "@/lib/media-formats";
import { fmtDateTime } from "@/lib/time";
import { makeCampaignVideo, pollCampaignVideo, type CampaignVideoJob } from "@/lib/video-campaign";

/** Cuántos días antes se prepara cada publicación. */
export const LEAD_DAYS = 3;
/** Como mucho, publicaciones nuevas por campaña en cada corrida, y campañas por corrida (límite de tiempo de Vercel). */
export const PER_CAMPAIGN_PER_RUN = 2;
export const CAMPAIGNS_PER_RUN = 4;
/** Cuánto dura el candado de una campaña (si una corrida se corta, a los 6 minutos otra puede seguir). */
export const LOCK_MS = 6 * 60000;
/** Después de un error, se espera esto antes de volver a intentar esa campaña. */
export const BACKOFF_MS = 15 * 60000;

type Claimed = { campaign: Campaign; rules: CampaignRules; engine: EngineState };

/** Lo mínimo de la base de datos que usa el candado (para poder probarlo con una base falsa). */
export type ClaimDb = {
  campaign: {
    findUnique(args: { where: { id: string } }): Promise<Campaign | null>;
    updateMany(args: { where: { id: string; updatedAt: Date; status: string }; data: { rules: Prisma.InputJsonValue } }): Promise<{ count: number }>;
  };
};

/**
 * Toma una campaña para trabajarla: solo si está activa, no es manual, nadie la tiene y nadie la cambió mientras
 * tanto (se compara updatedAt, de forma atómica, igual que publishPost pasa de "scheduled" a "publishing").
 */
export async function claimCampaign(id: string, now: Date, client: ClaimDb = db as unknown as ClaimDb): Promise<Claimed | null> {
  const c = await client.campaign.findUnique({ where: { id } });
  if (!c || c.status !== "active" || c.mode === "manual") return null;
  const engine = readEngine(c.rules);
  if (!canClaim(engine, now)) return null;
  const rules = readRules(c.rules);
  const locked: EngineState = { ...engine, lockedUntil: new Date(now.getTime() + LOCK_MS).toISOString() };
  const res = await client.campaign.updateMany({
    where: { id, updatedAt: c.updatedAt, status: "active" },
    data: { rules: rulesJson(rules, locked) as Prisma.InputJsonValue },
  });
  if (res.count === 0) return null;
  return { campaign: c, rules, engine: locked };
}


type Biz = Business & { connections: Pick<Connection, "channel">[] };

type Media = { mediaUrl: string; mediaType: "photo" | "none"; media?: { url: string; alt: string }[]; costCents: number; aiImage: boolean; kind: PostKind; note?: Bi };

/** Plantillas del negocio (o las de fábrica). */
async function templatesOf(businessId: string): Promise<StoredTemplate[]> {
  const rows = await db.template.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } });
  const list = rows.map((r) => StoredTemplate.safeParse(r.spec)).filter((r) => r.success).map((r) => r.data!);
  return list.length ? list : BUILTIN_TEMPLATES;
}

async function brandDesign(b: Biz, photoUrl: string | undefined, post: AiPostOut, shape: DesignShape, seed: number, keywords: string[]): Promise<string> {
  const list = await templatesOf(b.id);
  const template = pickTemplate(list, -1, { headline: post.imageHeadline, steps: post.imageSteps, hasPhoto: !!photoUrl, seed });
  const brand = { name: b.name, color: b.color, color2: b.color2, color3: b.color3, logoUrl: b.logoUrl, logoLightUrl: b.logoLightUrl, phone: b.phone, website: b.website, fontHeading: b.fontHeading, fontBody: b.fontBody };
  return storeDesign({ brand, template, headline: post.imageHeadline, photoUrl, steps: post.imageSteps, shape }, b.id, photoMetaFor(b, { title: post.imageHeadline, keywords }));
}

/** Texto alternativo con la palabra clave principal (para Google, Facebook y lectores de pantalla). */
export function altTextFor(headline: string, keywords: string[], businessName: string): string {
  const kw = keywords[0] && !headline.toLowerCase().includes(keywords[0].toLowerCase()) ? ` – ${keywords[0]}` : "";
  return `${headline.trim()}${kw} · ${businessName}`.slice(0, 250);
}

/**
 * La foto de la publicación: primero fotos reales del negocio; si no hay y el tope lo permite, una foto con IA.
 * Con la marca encendida, se diseña con el logo y el titular (gratis). Nunca falla: sin foto, sale solo texto.
 */
async function mediaFor(b: Biz, c: Campaign, rules: CampaignRules, post: AiPostOut, kind: PostKind, keywords: string[], seed: number, spent: number): Promise<Media> {
  const text = [post.imageHeadline, post.imageIdea, post.seoTitle, post.google].join("\n");
  const alt = altTextFor(post.imageHeadline, keywords, b.name);
  const shape = kind === "story" ? "vertical" : "square";
  if (kind === "carousel") {
    const picks = await pickLibraryPhotos(
      b.id,
      [post.imageHeadline, ...keywords.slice(0, 4)].map((k) => ({ text: `${text}\n${k}`, keywords: [k], shape: "square" as const })),
    );
    const urls = picks.filter((p): p is { id: string; url: string } => !!p).map((p) => p.url);
    if (urls.length >= 2)
      return { kind, mediaUrl: urls[0], mediaType: "photo", media: urls.map((url, i) => ({ url, alt: i === 0 ? alt : `${alt} (${i + 1})` })), costCents: 0, aiImage: false };
    // Sin suficientes fotos reales para un carrusel: sale como post normal.
    kind = "post";
  }
  let photo: string | undefined;
  let costCents = 0;
  let aiImage = false;
  let note: Bi | undefined;
  try {
    photo = (await pickLibraryPhoto(b.id, { text, keywords: [post.imageHeadline, ...keywords.slice(0, 3)], shape }))?.url;
  } catch {
    photo = undefined;
  }
  if (!photo && imagesEnabled()) {
    const cost = aiImageCents(pickImage(b.aiImage));
    if (rules.maxAiCostCents > 0 && spent + cost <= rules.maxAiCostCents) {
      try {
        photo = await createImage(b.aiImage, post.imageIdea, shape, b.id, photoContextFor(b, { title: post.imageHeadline, keywords }));
        costCents = cost;
        aiImage = true;
      } catch (e) {
        note = { es: `No se pudo crear la foto con IA (${errMsg(e)}).`, en: `Couldn't create the AI photo (${errMsg(e)}).` };
      }
    } else if (rules.maxAiCostCents > 0) {
      note = { es: "Sin foto con IA: se llegó al tope de gasto de la campaña.", en: "No AI photo: the campaign's spending cap was reached." };
    }
  }
  let url = photo ?? "";
  if (b.brandImages && post.imageHeadline.trim()) {
    try {
      url = await brandDesign(b, photo, post, kind === "story" ? "story" : "square", seed, keywords);
    } catch {
      url = photo ?? "";
    }
  }
  return url ? { kind, mediaUrl: url, mediaType: "photo", media: [{ url, alt }], costCents, aiImage, note } : { kind, mediaUrl: "", mediaType: "none", costCents, aiImage, note };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** Lo que se le pide a la IA para cada publicación de la campaña. */
export function campaignIdea(c: Pick<Campaign, "name" | "goal">, rules: CampaignRules, kind: PostKind, keywords: string[], n: number, avoidWords: string[] = []): string {
  const banned = [
    ...rules.bannedTopics,
    ...SAFETY_TOPICS.filter((s) => rules.safety[s.id] && s.id !== "competitors").map((s) => s.en.toLowerCase()),
    ...(rules.safety.competitors ? rules.competitors.map((x) => `the competitor "${x}"`) : []),
    ...avoidWords,
  ];
  const kindText: Record<PostKind, string> = {
    post: "a regular feed post (one image)",
    carousel: "a carousel (several photos): the text should walk through a few points, one per photo",
    story: "a story (vertical 9:16, seen for a few seconds): keep the text very short and direct",
    video: "a short vertical video post",
  };
  return [
    `Campaign: ${c.name}`,
    c.goal.trim() ? `Campaign goal (what the owner wants): ${c.goal.trim()}` : "",
    rules.allowedTopics.length ? `Focus only on these services or topics: ${rules.allowedTopics.join(", ")}` : "",
    `Format: ${kindText[kind]}.`,
    keywords.length ? `Use 1-3 of these SEO keywords naturally in the texts (and as hashtags where hashtags fit): ${keywords.join(", ")}` : "",
    banned.length ? `NEVER mention or touch any of these topics or words, not even indirectly: ${banned.join("; ")}.` : "",
    rules.safety.prices ? "Do not mention any price, amount, percentage, discount or anything free." : "",
    `This is post number ${n + 1} of the campaign: choose an angle different from the previous ones.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Todos los textos de una publicación de la IA (para buscar temas prohibidos). */
export function postTexts(p: AiPostOut): string[] {
  return [p.facebook, p.instagram, p.tiktok, p.google, p.sms, p.emailSubject, p.email, p.seoTitle, p.imageHeadline, ...p.imageSteps, p.facebookOther ?? "", p.instagramOther ?? ""];
}

/**
 * Crea la publicación solo si la campaña sigue activa, en la misma transacción y con la fila de la campaña
 * bloqueada: si el dueño presiona PARAR mientras la IA escribe, no se crea nada (ver stopCampaign).
 */
async function createCampaignPost(campaignId: string, data: Prisma.PostUncheckedCreateInput): Promise<string | null> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "Campaign" WHERE "id" = ${campaignId} FOR UPDATE`;
    if (rows[0]?.status !== "active") return null;
    const post = await tx.post.create({ data, select: { id: true } });
    return post.id;
  });
}

/**
 * Videos de campaña que se están creando (src/lib/video-campaign.ts): se avanzan y, al estar listos, la publicación
 * toma el video y queda como debía (programada en 100% IA, o borrador para aprobar). Si falla, queda como borrador.
 */
async function pollVideos(c: Campaign, pending: PendingVideo[], now: Date): Promise<PendingVideo[]> {
  const keep: PendingVideo[] = [...pending.slice(3)];
  for (const v of pending.slice(0, 3)) {
    const post = await db.post.findFirst({ where: { id: v.postId, campaignId: c.id }, select: { id: true, status: true, scheduledAt: true } });
    if (!post || post.status !== "draft") continue;
    const job = await pollCampaignVideo(c.businessId, v.projectId);
    const old = now.getTime() - Date.parse(v.since) > 24 * 3600000;
    if (job?.status === "ready" && job.videoUrl) {
      await db.post.update({ where: { id: post.id }, data: { mediaUrl: job.videoUrl, mediaType: "video" } });
      let scheduled = false;
      if (v.want === "scheduled" && post.scheduledAt.getTime() > now.getTime() + 5 * 60000) {
        const r = await db.post.updateMany({ where: { id: post.id, status: "draft", campaign: { is: { status: "active" } } }, data: { status: "scheduled" } });
        scheduled = r.count > 0;
      }
      await logAiAction({
        businessId: c.businessId,
        campaignId: c.id,
        postId: post.id,
        kind: scheduled ? "post.scheduled" : "video.ready",
        summary: scheduled
          ? { es: "El video quedó listo y la publicación quedó programada.", en: "The video is ready and the post is now scheduled." }
          : { es: "El video quedó listo: la publicación espera tu aprobación.", en: "The video is ready: the post is waiting for your approval." },
      });
    } else if (!job || job.status === "failed" || old) {
      if (job && job.status !== "failed" && !old) {
        keep.push(v);
        continue;
      }
      await logAiAction({
        businessId: c.businessId,
        campaignId: c.id,
        postId: post.id,
        kind: "video.failed",
        summary: { es: "No se pudo crear el video: la publicación queda como borrador sin video.", en: "The video couldn't be created: the post stays as a draft without video." },
      });
    } else keep.push(v);
  }
  return keep;
}

export type RunSummary = { ended: number; campaigns: number; drafts: number; scheduled: number; skipped: number; errors: number; paused: number };

/** Una corrida del motor: termina las campañas vencidas y prepara lo que toca, dentro de `budgetMs`. */
export async function runCampaigns(now = new Date(), budgetMs = 150_000): Promise<RunSummary> {
  const started = Date.now();
  const sum: RunSummary = { ended: 0, campaigns: 0, drafts: 0, scheduled: 0, skipped: 0, errors: 0, paused: 0 };
  sum.ended = await endDueCampaigns(now);
  const list = await db.campaign.findMany({
    where: { status: "active", mode: { in: ["approval", "auto"] }, startsAt: { lte: new Date(now.getTime() + LEAD_DAYS * 86400000) } },
    orderBy: { updatedAt: "asc" },
    select: { id: true },
    take: 25,
  });
  for (const { id } of list) {
    if (sum.campaigns >= CAMPAIGNS_PER_RUN || Date.now() - started > budgetMs) break;
    const claim = await claimCampaign(id, now);
    if (!claim) continue;
    sum.campaigns++;
    let next: (e: EngineState) => EngineState = (e) => e;
    try {
      next = await runOne(claim, now, sum, started + budgetMs);
    } catch (e) {
      console.error("[campañas] error en", id, e);
      sum.errors++;
      next = (en) => ({ ...en, errorsInRow: en.errorsInRow + 1, lockedUntil: new Date(now.getTime() + BACKOFF_MS).toISOString() });
    } finally {
      await patchEngine(id, (e) => {
        const n = next(e);
        // Se suelta el candado de esta corrida (o queda la espera después de un error).
        return { ...n, lockedUntil: n.lockedUntil === claim.engine.lockedUntil ? null : n.lockedUntil, lastRunAt: now.toISOString() };
      }).catch((e) => console.error("[campañas] no se pudo soltar", id, e));
    }
  }
  return sum;
}

async function runOne(claim: Claimed, now: Date, sum: RunSummary, deadline: number): Promise<(e: EngineState) => EngineState> {
  const c = claim.campaign;
  const b = (await db.business.findUniqueOrThrow({ where: { id: c.businessId }, include: { connections: { select: { channel: true } } } })) as Biz;
  const rules = rulesOf(c, b);
  const engine = claim.engine;
  const pendingVideos = engine.videos.length ? await pollVideos(c, engine.videos, now) : [];
  const newVideos: PendingVideo[] = [];

  // 1) ¿Fallaron seguidas las últimas publicaciones? Pausa y aviso.
  const finished = await db.post.findMany({
    where: { campaignId: c.id, status: { in: ["done", "partial", "failed"] }, ...(engine.resetAt ? { scheduledAt: { gt: new Date(engine.resetAt) } } : {}) },
    orderBy: { scheduledAt: "desc" },
    take: 12,
    select: { status: true },
  });
  const failed = failuresInRow(finished.map((p) => p.status));
  if (failed >= rules.stopOnErrors || engine.errorsInRow >= rules.stopOnErrors) {
    const n = Math.max(failed, engine.errorsInRow);
    await pauseCampaign(c.businessId, c.id, {
      actor: "auto",
      why: { es: `Hubo ${n} errores seguidos (tu límite es ${rules.stopOnErrors}). Revisa las conexiones y reanúdala.`, en: `There were ${n} errors in a row (your limit is ${rules.stopOnErrors}). Check the connections and resume it.` },
    });
    sum.paused++;
    return (e) => ({ ...e, videos: pendingVideos });
  }

  // 2) Los horarios que toca preparar.
  const slots = campaignSlots(c, rules);
  const due = dueSlots(slots, engine.handled, now, LEAD_DAYS).slice(0, PER_CAMPAIGN_PER_RUN);
  if (!due.length) return (e) => ({ ...e, videos: pendingVideos });

  const existing = await db.post.findMany({ where: { campaignId: c.id, status: { not: "failed" } }, select: { scheduledAt: true } });
  const sentChannels = await db.postTarget.findMany({ where: { status: "sent", post: { businessId: b.id } }, distinct: ["channel"], select: { channel: true } });
  const connected = b.connections.map((x) => x.channel);
  const keywords = campaignKeywords(b, c);
  const lang = writeLang(rules);
  let spent = await aiSpentCents(c.id);
  const avoid = await recentOpenings(b.id);
  const handled: string[] = [];
  let errors = 0;
  let ok = 0;
  const name = (id: string) => channelName(id);

  for (const slot of due) {
    if (Date.now() > deadline) break;
    const index = slots.findIndex((s) => s.getTime() === slot.getTime());
    let kind = pickKind(rules.contentMix, Math.max(0, index));
    const targets = c.channels.filter((ch) => connected.includes(ch));
    const counts = (): CheckCounts => ({ ...slotCounts(existing, slot, c.startsAt, rules.timezone), aiSpentCents: spent, connected, usedChannels: sentChannels.map((s) => s.channel) });
    const when = { es: fmtDateTime(slot, "es", rules.timezone), en: fmtDateTime(slot, "en", rules.timezone) };

    const skip = async (reasons: Reason[], extra?: Prisma.InputJsonValue) => {
      handled.push(slotKey(slot));
      sum.skipped++;
      const es = reasons.map((r) => reasonText(r, "es", name)).join(" ");
      const en = reasons.map((r) => reasonText(r, "en", name)).join(" ");
      const summary = { es: `No se preparó la publicación del ${when.es}: ${es}`, en: `The post for ${when.en} wasn't prepared: ${en}` };
      await logAiAction({ businessId: b.id, campaignId: c.id, kind: "limit.reached", summary, detail: { slot: slotKey(slot), reasons, ...(extra ? { extra } : {}) } as Prisma.InputJsonValue });
      await campaignAlert(c.id, "limit", summary);
    };

    // a) Antes de gastar en la IA: horario, días, máximos, canales.
    const pre = checkPost(rules, c, { texts: [], channels: targets, scheduledAt: slot, aiCostCents: 0 }, counts(), now);
    if (!pre.ok) {
      await skip(pre.reasons);
      continue;
    }

    // b) El texto (si toca un tema prohibido, se pide otro una vez más avisando la palabra).
    let post: AiPostOut | null = null;
    let hits: string[] = [];
    try {
      for (let attempt = 0; attempt < 2 && !post; attempt++) {
        const p = await writePost(b, campaignIdea(c, rules, kind, keywords, Math.max(0, index), hits), lang, { avoid });
        const found = bannedHits(rules, postTexts(p).join("\n"));
        if (!found.length) post = p;
        else hits = [...new Set([...hits, ...found.map((h) => h.word)])];
      }
    } catch (e) {
      errors++;
      sum.errors++;
      await logAiAction({
        businessId: b.id,
        campaignId: c.id,
        kind: "post.error",
        summary: { es: `La IA no pudo escribir la publicación del ${when.es}; se vuelve a intentar más tarde.`, en: `The AI couldn't write the post for ${when.en}. It will try again later.` },
        detail: { slot: slotKey(slot), error: errMsg(e) },
      });
      break;
    }
    if (!post) {
      await skip(hits.map((w) => ({ code: "banned" as const, word: w })), { attempts: 2 });
      continue;
    }

    // c) Video con fotos reales (src/lib/video-campaign.ts), dentro de lo que queda del tope de gasto. Se termina en
    // segundo plano (pollVideos). Si no se puede (sin fotos, sin servicio, más caro que el tope), sale como post.
    let video: CampaignVideoJob | null = null;
    if (kind === "video") {
      const room = rules.maxAiCostCents - spent;
      if (room > 0)
        video = await makeCampaignVideo(b.id, `${campaignIdea(c, rules, kind, keywords, Math.max(0, index))}\n\n${post.facebook}`, { campaignId: c.id, format: "vertical", maxCents: room, actor: "auto" }).catch(() => null);
      if (!video || video.status === "failed") {
        video = null;
        kind = "post";
      } else spent += video.costCents; // Ya quedó anotado en el registro (video.render).
    }
    const videoReady = !!video && video.status === "ready" && !!video.videoUrl;

    // d) La foto.
    const media: Media = video
      ? { kind: "video", mediaUrl: videoReady ? video.videoUrl : "", mediaType: "none", costCents: 0, aiImage: false }
      : await mediaFor(b, c, rules, post, kind, keywords, Math.max(0, index), spent);

    // e) La revisión final con todo (texto, canales, gasto).
    const fields = toPostFields(post);
    if (video) {
      // Los textos que escribió el guion del video para cada red.
      const vt = video.texts;
      for (const [ch, txt] of [["facebook", vt.facebook], ["instagram", vt.instagram], ["tiktok", vt.tiktok], ["youtube", vt.description]] as const)
        if (txt?.trim()) (fields.variants as Record<string, string>)[ch] = txt;
      if (vt.title?.trim()) fields.seoTitle = vt.title.slice(0, 100);
    }
    const check = checkPost(rules, c, { texts: postTexts(post), channels: targets, scheduledAt: slot, aiCostCents: media.costCents, aiImage: media.aiImage }, counts(), now);
    const status = decideStatus(c.mode, check);
    if (!status) {
      if (media.costCents) {
        spent += media.costCents;
        await logAiAction({
          businessId: b.id,
          campaignId: c.id,
          kind: "media.unused",
          costCents: media.costCents,
          summary: { es: `Foto con IA creada pero no usada (${centsText(media.costCents)}).`, en: `AI photo created but not used (${centsText(media.costCents)}).` },
        });
      }
      await skip(check.reasons);
      continue;
    }

    // Mientras el video se crea, la publicación espera como borrador (pollVideos la programa al estar listo).
    const created: "draft" | "scheduled" = video && !videoReady ? "draft" : status;
    const data: Prisma.PostUncheckedCreateInput = {
      businessId: b.id,
      campaignId: c.id,
      ...fields,
      variants: fields.variants as Prisma.InputJsonValue,
      source: "ai",
      status: created,
      kind: media.kind,
      mediaUrl: media.mediaUrl,
      mediaType: videoReady ? "video" : video ? "none" : media.mediaType,
      media: media.media ? (media.media as Prisma.InputJsonValue) : undefined,
      altText: media.media?.[0]?.alt ?? altTextFor(post.imageHeadline, keywords, b.name),
      scheduledAt: slot,
      targets: { create: targets.map((channel) => ({ channel })) },
    };
    const postId = await createCampaignPost(c.id, data);
    if (!postId) {
      // La campaña dejó de estar activa mientras la IA trabajaba (pausa o PARAR): no se crea nada.
      if (media.costCents) {
        await logAiAction({
          businessId: b.id,
          campaignId: c.id,
          kind: "media.unused",
          costCents: media.costCents,
          summary: { es: `Foto con IA creada pero no usada porque la campaña se detuvo (${centsText(media.costCents)}).`, en: `AI photo created but not used because the campaign stopped (${centsText(media.costCents)}).` },
        });
      }
      break;
    }
    ok++;
    spent += media.costCents;
    if (video && !videoReady) newVideos.push({ postId, projectId: video.projectId, want: status, since: now.toISOString() });
    existing.push({ scheduledAt: slot });
    handled.push(slotKey(slot));
    if (created === "draft") sum.drafts++;
    else sum.scheduled++;

    const chans = targets.map((t) => channelName(t, "es")).join(", ");
    const chansEn = targets.map((t) => channelName(t, "en")).join(", ");
    const wait = video && !videoReady ? { es: " El video se está creando; al estar listo la publicación queda como debe.", en: " The video is being made; when it's ready the post is set as it should be." } : { es: "", en: "" };
    const cost = media.costCents ? { es: ` Costo de la foto con IA: ${centsText(media.costCents)}.`, en: ` AI photo cost: ${centsText(media.costCents)}.` } : { es: "", en: "" };
    // En «Con tu aprobación» todo espera al dueño: solo en 100% IA se explica por qué esta pide permiso.
    const why = c.mode === "auto" && check.needsApproval.length
      ? { es: ` Necesita tu aprobación: ${check.needsApproval.map((r) => reasonText(r, "es", name)).join(" ")}`, en: ` Needs your approval: ${check.needsApproval.map((r) => reasonText(r, "en", name)).join(" ")}` }
      : { es: "", en: "" };
    const summary: Bi =
      created === "draft"
        ? {
            es: `La IA preparó un borrador (${kindLabel(media.kind, "es")}) para el ${when.es} en ${chans}: «${post.imageHeadline}».${why.es}${wait.es}${cost.es}`,
            en: `The AI prepared a draft (${kindLabel(media.kind, "en")}) for ${when.en} on ${chansEn}: “${post.imageHeadline}”.${why.en}${wait.en}${cost.en}`,
          }
        : {
            es: `La IA programó una publicación (${kindLabel(media.kind, "es")}) para el ${when.es} en ${chans}: «${post.imageHeadline}».${cost.es}`,
            en: `The AI scheduled a post (${kindLabel(media.kind, "en")}) for ${when.en} on ${chansEn}: “${post.imageHeadline}”.${cost.en}`,
          };
    await logAiAction({
      businessId: b.id,
      campaignId: c.id,
      postId,
      kind: created === "draft" ? "post.draft" : "post.scheduled",
      costCents: media.costCents,
      summary,
      detail: {
        slot: slotKey(slot),
        kind: media.kind,
        keywords: keywords.slice(0, 6),
        needsApproval: check.needsApproval,
        photo: media.aiImage ? "ai" : media.mediaUrl ? "library-or-design" : "none",
        ...(media.note ? { note: media.note } : {}),
      } as Prisma.InputJsonValue,
    });
    await campaignAlert(c.id, "post", summary);
  }

  return (e) => ({
    ...e,
    videos: [...pendingVideos, ...newVideos],
    handled: [...e.handled, ...handled],
    errorsInRow: errors ? e.errorsInRow + errors : ok ? 0 : e.errorsInRow,
    // Después de un error se espera un rato antes de volver a intentar.
    lockedUntil: errors ? new Date(now.getTime() + BACKOFF_MS).toISOString() : null,
  });
}
