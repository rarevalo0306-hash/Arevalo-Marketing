// Videos para las campañas (lo llama el agente de campañas: src/lib/campaign-*.ts).
//
// makeCampaignVideo(businessId, idea, opts?) → Promise<CampaignVideoJob | null>
//   Hace un video vertical (Reel/TikTok/Short) con las fotos y clips reales que mejor van con la idea, el guion de
//   la IA (con la identidad de la marca y las palabras clave del negocio) y lo empieza a crear en fal.ai.
//   - Devuelve null si el video no está configurado (sin FAL_KEY o sin Supabase Storage), si no hay fotos reales
//     que usar, o si crearlo pasaría los topes (VIDEO_MAX_USD por video, VIDEO_DAILY_MAX por día) o el
//     `maxCents` que pase la campaña. Nunca lanza error por eso: la campaña sigue sin video.
//   - Cuesta unos US$0.01–0.03 por video (FFmpeg compose US$0.0002/s + música US$0.02/min). El costo queda
//     anotado en AiAction (kind "video.render", con campaignId) para el reporte diario.
//   - El video se termina en segundo plano: llama a pollCampaignVideo(businessId, job.projectId) (por ejemplo
//     desde el cron) hasta que `status` sea "ready" (entonces `videoUrl` es el MP4 público) o "failed".
//   - No publica nada: la campaña decide cuándo y dónde (Post con kind "video", mediaType "video", mediaUrl =
//     videoUrl; los textos por red están en job.texts: title/description/tags de YouTube, instagram, tiktok, facebook).
import { db } from "@/lib/db";
import { advanceRender, contentLang, createProject, loadVideoMedia, planContext, projectCost, maxCentsPerVideo, maxVideosPerDay, rendersToday, startRender, suggestMedia, videoBlocker, videoBusiness, writeStoryboard, businessKeywords } from "@/lib/video-jobs";
import type { VideoFormat, VideoStatus, VideoTexts } from "@/lib/video-plan";

export type CampaignVideoJob = {
  projectId: string;
  status: VideoStatus;
  costCents: number;
  /** MP4 público cuando status = "ready" ("" mientras se crea). */
  videoUrl: string;
  texts: VideoTexts;
  keyword: string;
};

export type CampaignVideoOptions = {
  campaignId?: string | null;
  format?: VideoFormat;
  /** Tope de la campaña para este video (centavos). Si el video cuesta más, no se crea. */
  maxCents?: number;
  /** Quién lo pidió: "auto" (la IA de la campaña) o "approved" (el dueño aprobó). */
  actor?: "auto" | "approved";
};

export async function makeCampaignVideo(businessId: string, idea: string, opts: CampaignVideoOptions = {}): Promise<CampaignVideoJob | null> {
  if (videoBlocker() || !idea.trim()) return null;
  try {
    const b = await videoBusiness(businessId);
    const lang = contentLang(b);
    const format = opts.format ?? "vertical";
    const ids = await suggestMedia(businessId, idea, format, businessKeywords(b));
    const media = await loadVideoMedia(businessId, ids, lang);
    if (!media.length) return null;
    const sb = await writeStoryboard(b, planContext(b, { idea, format, media, lang }));
    const cost = projectCost(sb);
    if (cost > maxCentsPerVideo() || (opts.maxCents !== undefined && cost > opts.maxCents)) return null;
    if ((await rendersToday(businessId)) >= maxVideosPerDay()) return null;
    const row = await createProject(businessId, sb);
    const p = await startRender(businessId, row.id, cost, opts.actor ?? "auto", opts.campaignId ?? null);
    if (ids.length) await db.libraryItem.updateMany({ where: { businessId, id: { in: media.map((m) => m.id) } }, data: { usedCount: { increment: 1 }, lastUsedAt: new Date() } }).catch(() => undefined);
    return { projectId: row.id, status: p.status, costCents: p.costCents, videoUrl: p.videoUrl, texts: sb.texts, keyword: sb.keyword };
  } catch (e) {
    console.error("makeCampaignVideo", e);
    return null;
  }
}

/** Cómo va un video de campaña (y lo avanza: música → unir → guardar). */
export async function pollCampaignVideo(businessId: string, projectId: string): Promise<CampaignVideoJob | null> {
  try {
    const p = await advanceRender(businessId, projectId);
    return { projectId, status: p.status, costCents: p.costCents, videoUrl: p.videoUrl, texts: p.storyboard.texts, keyword: p.storyboard.keyword };
  } catch {
    return null;
  }
}
