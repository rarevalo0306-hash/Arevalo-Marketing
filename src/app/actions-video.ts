"use server";

// «Videos»: guion con IA a partir de fotos reales, vista previa, crear el video (con costo confirmado) y publicarlo
// en Instagram (Reel), TikTok, YouTube (Short) y Facebook.
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { logAiAction } from "@/lib/ai-actions";
import type { ChannelId } from "@/lib/channels";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { readMedia } from "@/lib/media";
import { publishPost } from "@/lib/publish";
import { localToUtc } from "@/lib/time";
import {
  advanceRender,
  businessKeywords,
  contentLang,
  createProject,
  loadProject,
  loadVideoMedia,
  planContext,
  saveProject,
  startRender,
  suggestMedia,
  videoBusiness,
  writeStoryboard,
} from "@/lib/video-jobs";
import { applyEdits, applyTextEdits, channelsFor, VIDEO_KIND, type SceneEdit, type VideoFormat, type VideoProject, type VideoTexts } from "@/lib/video-plan";
import { sceneStill } from "@/lib/video-render";

export type VideoView = { id: string; createdAt: string; project: VideoProject };
export type VideoResult = { ok: true; video: VideoView } | { ok: false; error: string };

const view = (r: { id: string; createdAt: Date; project: VideoProject }): VideoView => ({ id: r.id, createdAt: r.createdAt.toISOString(), project: r.project });
const page = (businessId: string) => `/b/${businessId}/videos`;

/** Las fotos y clips que mejor van con la idea (para empezar con algo elegido). */
export async function suggestVideoMedia(businessId: string, idea: string, format: VideoFormat): Promise<string[]> {
  try {
    const b = await videoBusiness(businessId);
    return await suggestMedia(businessId, idea.slice(0, 2000), format === "horizontal" ? "horizontal" : "vertical", businessKeywords(b));
  } catch {
    return [];
  }
}

/** Escribe el guion (la IA, o el de respaldo si la IA no responde) y lo guarda como video nuevo. */
export async function planVideo(businessId: string, input: { idea: string; format: VideoFormat; mediaIds: string[] }): Promise<VideoResult> {
  const { lang, t } = await getT();
  try {
    const b = await videoBusiness(businessId);
    const cl = contentLang(b);
    const format: VideoFormat = input.format === "horizontal" ? "horizontal" : "vertical";
    const idea = input.idea.trim().slice(0, 2000);
    if (!idea) return { ok: false, error: t("Escribe o elige de qué es el video.", "Write or pick what the video is about.") };
    const media = await loadVideoMedia(businessId, input.mediaIds, cl);
    if (!media.length) return { ok: false, error: t("Elige al menos una foto o un clip de tus fotos.", "Pick at least one photo or clip from your photos.") };
    const sb = await writeStoryboard(b, planContext(b, { idea, format, media, lang: cl }));
    const row = await createProject(businessId, sb);
    await db.libraryItem.updateMany({ where: { businessId, id: { in: media.map((m) => m.id) } }, data: { usedCount: { increment: 1 }, lastUsedAt: new Date() } }).catch(() => undefined);
    revalidatePath(page(businessId));
    return { ok: true, video: view(row) };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

/** Guarda lo que el dueño cambió del guion (orden, textos, movimiento, música y textos de cada red). */
export async function saveVideoEdits(businessId: string, projectId: string, edits: { scenes: SceneEdit[]; texts?: Partial<VideoTexts>; music?: boolean }): Promise<VideoResult> {
  const { lang, t } = await getT();
  try {
    const row = await loadProject(businessId, projectId);
    const p = row.project;
    if (p.status === "rendering") return { ok: false, error: t("El video se está creando: espera a que termine para cambiarlo.", "The video is being created: wait for it to finish before changing it.") };
    let sb = applyEdits(p.storyboard, edits.scenes.slice(0, 12));
    if (typeof edits.music === "boolean") sb = { ...sb, music: { ...sb.music, on: edits.music } };
    sb = { ...sb, texts: applyTextEdits(sb, edits.texts ?? {}) };
    // Si ya había un video y cambió el guion, hay que volver a crearlo.
    const changed = JSON.stringify(sb.scenes) !== JSON.stringify(p.storyboard.scenes) || sb.music.on !== p.storyboard.music.on;
    const next: VideoProject = { ...p, storyboard: sb, ...(changed && p.status !== "published" ? { status: "draft" as const, videoUrl: p.status === "ready" ? "" : p.videoUrl } : {}) };
    await saveProject(businessId, projectId, next);
    return { ok: true, video: view({ ...row, project: next }) };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

/** Un cuadro real de una escena (como saldrá en el video), en pequeño. */
export async function videoSceneStill(businessId: string, projectId: string, sceneId: string): Promise<{ ok: true; src: string } | { ok: false; error: string }> {
  const { lang } = await getT();
  try {
    const { project } = await loadProject(businessId, projectId);
    const jpg = await sceneStill(project.storyboard, sceneId, { read: readMedia });
    const small = await sharp(jpg).resize({ width: project.storyboard.format === "vertical" ? 540 : 960 }).jpeg({ quality: 78 }).toBuffer();
    return { ok: true, src: `data:image/jpeg;base64,${small.toString("base64")}` };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

/** «Sí, crear video»: solo con el precio que el dueño vio y aceptó. */
export async function startVideoRender(businessId: string, projectId: string, confirmCents: number): Promise<VideoResult> {
  const { lang } = await getT();
  try {
    await startRender(businessId, projectId, Math.round(confirmCents), "owner");
    revalidatePath(page(businessId));
    return { ok: true, video: view(await loadProject(businessId, projectId)) };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

/** ¿Ya está el video? (la pantalla pregunta cada pocos segundos). */
export async function checkVideoRender(businessId: string, projectId: string): Promise<VideoResult> {
  const { lang } = await getT();
  try {
    await advanceRender(businessId, projectId, lang);
    const row = await loadProject(businessId, projectId);
    if (row.project.status !== "rendering") revalidatePath(page(businessId));
    return { ok: true, video: view(row) };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

export type PublishVideoResult = { ok: true; href: string; message: string } | { ok: false; error: string };

/**
 * «Publicar»: crea la publicación de video (kind "video") con el texto de cada red, igual que «Nueva publicación»,
 * y la publica ahora o a la hora elegida.
 */
export async function publishVideo(businessId: string, projectId: string, f: FormData): Promise<PublishVideoResult> {
  const { lang, t } = await getT();
  try {
    const row = await loadProject(businessId, projectId);
    const p = row.project;
    if (!p.videoUrl || (p.status !== "ready" && p.status !== "published")) return { ok: false, error: t("Primero crea el video.", "Create the video first.") };
    const allowed = channelsFor(p.storyboard.format);
    const channels = f.getAll("channels").map(String).filter((c): c is (typeof allowed)[number] => (allowed as string[]).includes(c));
    if (!channels.length) return { ok: false, error: t("Elige al menos una red.", "Choose at least one network.") };
    const sb = p.storyboard;
    const texts = applyTextEdits(sb, {
      title: String(f.get("title") ?? sb.texts.title),
      description: String(f.get("description") ?? sb.texts.description),
      instagram: String(f.get("instagram") ?? sb.texts.instagram),
      tiktok: String(f.get("tiktok") ?? sb.texts.tiktok),
      facebook: String(f.get("facebook") ?? sb.texts.facebook),
    });
    const when = String(f.get("when") ?? "now");
    let scheduledAt = new Date();
    if (when === "later") {
      const date = String(f.get("date") ?? "");
      const time = String(f.get("time") ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: t("Elige el día para programarlo.", "Pick the day to schedule it.") };
      scheduledAt = localToUtc(date, 0, time);
      if (scheduledAt.getTime() < Date.now() - 60_000) return { ok: false, error: t("Esa hora ya pasó. Elige una hora futura.", "That time has passed. Pick a future time.") };
    }
    const variants: Partial<Record<ChannelId, string>> = { instagram: texts.instagram, tiktok: texts.tiktok, facebook: texts.facebook, youtube: texts.description };
    const post = await db.post.create({
      data: {
        businessId,
        text: texts.facebook || texts.instagram,
        variants,
        source: "ai",
        subject: "",
        seoTitle: texts.title,
        mediaUrl: p.videoUrl,
        mediaType: "video",
        kind: "video",
        altText: texts.title.replace(/\s*#Shorts\b/i, "").slice(0, 250),
        scheduledAt,
        targets: { create: channels.map((channel) => ({ channel })) },
      },
    });
    await saveProject(businessId, projectId, { ...p, storyboard: { ...sb, texts }, status: "published", postId: post.id });
    await logAiAction({
      businessId,
      kind: when === "later" ? "post.scheduled" : "post.published",
      actor: "owner",
      postId: post.id,
      summary: {
        es: `Video «${texts.title.slice(0, 80)}» ${when === "later" ? "programado" : "enviado"} a ${channels.join(", ")}.`,
        en: `Video "${texts.title.slice(0, 80)}" ${when === "later" ? "scheduled" : "sent"} to ${channels.join(", ")}.`,
      },
      detail: { projectId, channels, keyword: sb.keyword },
    });
    if (when !== "later") await publishPost(post.id);
    revalidatePath(`/b/${businessId}/historial`);
    revalidatePath(page(businessId));
    return {
      ok: true,
      href: `/b/${businessId}/historial?nuevo=${post.id}`,
      message: when === "later" ? t("Listo: el video quedó programado.", "Done: the video is scheduled.") : t("Listo: el video se envió a las redes elegidas.", "Done: the video was sent to the chosen networks."),
    };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

/** Borra un video de la lista (no borra lo que ya se publicó). */
export async function deleteVideo(businessId: string, projectId: string): Promise<void> {
  await db.seoReport.deleteMany({ where: { id: projectId, businessId, kind: VIDEO_KIND } });
  revalidatePath(page(businessId));
}
