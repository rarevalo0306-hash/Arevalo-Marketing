// Videos con fotos reales: el guion (con la IA o de respaldo), los proyectos guardados y el trabajo de crear el video
// (cuadros → música → FFmpeg compose en fal.ai → MP4 guardado con un nombre con palabra clave y ciudad).
// Los proyectos se guardan en SeoReport con kind "video" (data = VideoProject de video-plan.ts): no hace falta
// cambiar la base de datos. Lo usan las acciones (src/app/actions-video.ts) y las campañas (video-campaign.ts).
import { randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { logAiAction } from "@/lib/ai-actions";
import { aiEnabled, askGemini } from "@/lib/ai";
import { brandSlogan, identityPrompt } from "@/lib/brand-identity";
import { readBrandIdentity } from "@/lib/brand-identity-shape";
import { db } from "@/lib/db";
import { composeFrameTrack, falEnabled, falPoll, musicUrlOf, startCompose, startMusic } from "@/lib/fal";
import { bi, errorText, type UiLang } from "@/lib/i18n";
import { ensureStoredCopy } from "@/lib/library-files";
import { scoreItem, usableNow } from "@/lib/library-match";
import { readDescription } from "@/lib/library-shape";
import { businessPlace } from "@/lib/media-formats";
import { publicMediaUrl, readMedia, storeBuffer, storeRemote, usesSupabaseStorage } from "@/lib/media";
import { libraryPhotoUrl, readEnhanceInfo } from "@/lib/photo-enhance-shape";
import { readTrackedKeywords } from "@/lib/seo/dataforseo";
import { readStudy, topKeywords } from "@/lib/study-shape";
import { renderKeyframes } from "@/lib/video-render";
import {
  AiStoryboardSchema,
  composeTracks,
  estimateCostCents,
  fromAi,
  storyboardPrompt,
  templateStoryboard,
  totalSec,
  uniqueKeywords,
  VIDEO_KIND,
  videoFileName,
  type PlanContext,
  type Storyboard,
  type VideoFormat,
  type VideoMedia,
  type VideoProject,
  readVideoProject,
} from "@/lib/video-plan";

// ---------- ¿Se puede crear el video? ----------

/** Lo que falta para crear el video (null = todo listo). El guion y la vista previa funcionan igual. */
export function videoBlocker(): "fal" | "storage" | null {
  if (!falEnabled()) return "fal";
  if (!usesSupabaseStorage()) return "storage";
  return null;
}

/** Tope por video (dólares) y videos por día: nunca se pasa aunque alguien lo intente. */
export const maxCentsPerVideo = () => Math.round(Math.max(0.01, Number(process.env.VIDEO_MAX_USD) || 0.5) * 100);
export const maxVideosPerDay = () => Math.max(1, Math.floor(Number(process.env.VIDEO_DAILY_MAX) || 10));

export async function rendersToday(businessId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  return db.aiAction.count({ where: { businessId, kind: "video.render", createdAt: { gte: since } } });
}

// ---------- Lo que el guion sabe del negocio ----------

const BIZ_SELECT = {
  id: true,
  name: true,
  phone: true,
  ownerPhone: true,
  website: true,
  hashtags: true,
  logoUrl: true,
  logoLightUrl: true,
  color: true,
  color2: true,
  fontHeading: true,
  brandIdentity: true,
  seoKeywords: true,
  seoLanguage: true,
  study: true,
  studyInput: true,
  seoMapPlace: true,
  seoLocations: true,
  seoLocationName: true,
  aiText: true,
} satisfies Prisma.BusinessSelect;
export type VideoBusiness = Prisma.BusinessGetPayload<{ select: typeof BIZ_SELECT }>;

export async function videoBusiness(businessId: string): Promise<VideoBusiness> {
  const b = await db.business.findUnique({ where: { id: businessId }, select: BIZ_SELECT });
  if (!b) throw bi("Negocio no encontrado", "Business not found");
  return b;
}

/** Palabras clave del negocio: primero las que se siguen en «Palabras clave», luego las mejores del estudio. */
export function businessKeywords(b: Pick<VideoBusiness, "seoKeywords" | "study">): string[] {
  const study = readStudy(b.study);
  return uniqueKeywords([...readTrackedKeywords(b.seoKeywords), ...(study ? topKeywords(study, 12) : [])], 20);
}

const MEDIA_SELECT = {
  id: true,
  kind: true,
  url: true,
  thumbUrl: true,
  status: true,
  usable: true,
  quality: true,
  privacy: true,
  choice: true,
  tags: true,
  folderPath: true,
  description: true,
  width: true,
  height: true,
  durationSec: true,
  usedCount: true,
  lastUsedAt: true,
  enhancedUrl: true,
  useEnhanced: true,
  enhanceInfo: true,
} satisfies Prisma.LibraryItemSelect;
type MediaRow = Prisma.LibraryItemGetPayload<{ select: typeof MEDIA_SELECT }>;

function toMedia(r: MediaRow, lang: "es" | "en"): VideoMedia {
  const info = readEnhanceInfo(r.enhanceInfo);
  const enhanced = r.kind === "photo" && r.enhancedUrl && r.useEnhanced;
  const d = readDescription(r.description);
  return {
    id: r.id,
    kind: r.kind === "video" ? "video" : "photo",
    // La mejorada si existe y el dueño no eligió la original.
    url: r.kind === "photo" ? libraryPhotoUrl(r) : r.url,
    thumb: (enhanced && info?.thumb) || r.thumbUrl || (r.kind === "video" ? "" : r.url),
    // El punto importante solo vale para la foto mejorada (es donde se calculó).
    focus: enhanced && info?.focus ? info.focus : null,
    width: enhanced && info?.enhanced.w ? info.enhanced.w : r.width,
    height: enhanced && info?.enhanced.h ? info.enhanced.h : r.height,
    durationSec: r.durationSec,
    about: (d ? d[lang] || d.es || d.en : r.tags.join(", ")).slice(0, 300),
  };
}

/** Las fotos y clips elegidos (en el orden elegido), solo si se pueden usar. */
export async function loadVideoMedia(businessId: string, ids: string[], lang: "es" | "en"): Promise<VideoMedia[]> {
  const unique = [...new Set(ids)].slice(0, 12);
  if (!unique.length) return [];
  const rows = await db.libraryItem.findMany({ where: { businessId, id: { in: unique }, status: "ready", NOT: { choice: "skip" } }, select: MEDIA_SELECT });
  const byId = new Map(rows.filter((r) => usableNow(r)).map((r) => [r.id, r]));
  return unique.map((id) => byId.get(id)).filter((r): r is MediaRow => Boolean(r)).map((r) => toMedia(r, lang));
}

/** Las fotos (y clips) que mejor van con la idea, para empezar con algo elegido. */
export async function suggestMedia(businessId: string, idea: string, format: VideoFormat, keywords: string[], max = 6): Promise<string[]> {
  const rows = await db.libraryItem.findMany({ where: { businessId, status: "ready", NOT: { choice: "skip" } }, select: MEDIA_SELECT, take: 400 });
  const usable = rows.filter((r) => usableNow(r) && (r.kind === "photo" ? Boolean(r.url) : true));
  const q = { text: idea, keywords: keywords.slice(0, 6), shape: format === "vertical" ? ("vertical" as const) : ("horizontal" as const) };
  return usable
    .map((r) => ({ id: r.id, kind: r.kind, s: scoreItem(r, q) }))
    .sort((a, b) => b.s.relevance - a.s.relevance || b.s.score - a.s.score || (a.kind === "photo" ? -1 : 1))
    .slice(0, max)
    .map((x) => x.id);
}

/** Todo lo que el guion necesita, a partir de la base de datos. */
export function planContext(b: VideoBusiness, o: { idea: string; format: VideoFormat; media: VideoMedia[]; lang: "es" | "en" }): PlanContext {
  const id = readBrandIdentity(b.brandIdentity);
  const place = businessPlace(b);
  return {
    idea: o.idea,
    format: o.format,
    lang: o.lang,
    media: o.media,
    business: {
      name: b.name,
      phone: b.phone || b.ownerPhone,
      website: b.website,
      city: place.city ?? "",
      hashtags: b.hashtags,
      slogan: brandSlogan(b, o.lang),
      logoUrl: b.logoUrl,
      logoLightUrl: b.logoLightUrl,
      color: b.color,
      color2: b.color2,
      fontHeading: b.fontHeading,
    },
    keywords: businessKeywords(b),
    music: id.music,
  };
}

/** El idioma de los textos del video: el del negocio (no el de la app). */
export const contentLang = (b: Pick<VideoBusiness, "seoLanguage">): "es" | "en" => (b.seoLanguage === "en" ? "en" : "es");

/** El guion: la IA lo escribe con la identidad de la marca; si no puede, queda el de respaldo (nunca falla). */
export async function writeStoryboard(b: VideoBusiness, ctx: PlanContext): Promise<Storyboard> {
  if (!ctx.media.length) throw bi("Elige al menos una foto o un clip para el video.", "Pick at least one photo or clip for the video.");
  if (aiEnabled() && process.env.GEMINI_API_KEY) {
    try {
      const fallback = templateStoryboard(ctx);
      const { system, user } = storyboardPrompt(ctx, fallback.keyword, fallback.keywords);
      const ai = await askGemini(AiStoryboardSchema, system + identityPrompt(b), user, 4000);
      const sb = fromAi(ctx, ai);
      if (sb) return sb;
    } catch {
      // La IA no respondió: se usa el guion de respaldo.
    }
  }
  return templateStoryboard(ctx);
}

// ---------- Proyectos guardados ----------

export type ProjectRow = { id: string; createdAt: Date; project: VideoProject };

export async function listProjects(businessId: string, take = 20): Promise<ProjectRow[]> {
  const rows = await db.seoReport.findMany({ where: { businessId, kind: VIDEO_KIND }, orderBy: { createdAt: "desc" }, take });
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt, project: readVideoProject(r.data) })).filter((r): r is ProjectRow => r.project !== null);
}

export async function loadProject(businessId: string, id: string): Promise<ProjectRow> {
  const r = await db.seoReport.findFirst({ where: { id, businessId, kind: VIDEO_KIND } });
  const project = r ? readVideoProject(r.data) : null;
  if (!r || !project) throw bi("No encontramos ese video. Puede que se haya borrado.", "We couldn't find that video. It may have been deleted.");
  return { id: r.id, createdAt: r.createdAt, project };
}

const asJson = (p: VideoProject) => JSON.parse(JSON.stringify(p)) as Prisma.InputJsonValue;

export async function createProject(businessId: string, storyboard: Storyboard): Promise<ProjectRow> {
  const project: VideoProject = { v: 1, status: "draft", storyboard, job: null, videoUrl: "", thumbUrl: "", error: "", costCents: 0, postId: "", updatedAt: new Date().toISOString() };
  const r = await db.seoReport.create({ data: { businessId, kind: VIDEO_KIND, data: asJson(project) } });
  // Se guardan los últimos 30.
  const old = await db.seoReport.findMany({ where: { businessId, kind: VIDEO_KIND }, orderBy: { createdAt: "desc" }, skip: 30, select: { id: true } });
  if (old.length) await db.seoReport.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  return { id: r.id, createdAt: r.createdAt, project };
}

export async function saveProject(businessId: string, id: string, project: VideoProject): Promise<void> {
  await db.seoReport.updateMany({ where: { id, businessId, kind: VIDEO_KIND }, data: { data: asJson({ ...project, updatedAt: new Date().toISOString() }) } });
}

// ---------- Crear el video ----------

/** Lo que cuesta crear este guion (centavos). */
export const projectCost = (sb: Storyboard) => estimateCostCents({ totalSec: totalSec(sb.scenes), music: sb.music.on });

/**
 * Empieza a crear el video: dibuja y sube los cuadros, y pide la música (o une todo de una vez si no hay música).
 * `confirmCents` es el precio que el dueño vio y aceptó: si cambió o pasa el tope, no se hace nada.
 */
export async function startRender(businessId: string, id: string, confirmCents: number, actor: "owner" | "auto" | "approved" = "owner", campaignId: string | null = null): Promise<VideoProject> {
  const row = await loadProject(businessId, id);
  const p = row.project;
  if (p.status === "rendering") return p;
  const blocker = videoBlocker();
  if (blocker === "fal") throw bi("Para crear el video falta la clave de fal.ai (FAL_KEY) en la configuración del servidor. Puedes ver el guion y la vista previa igual.", "To create the video, the fal.ai key (FAL_KEY) is missing from the server settings. You can still see the storyboard and the preview.");
  if (blocker === "storage") throw bi("Para crear el video hace falta el almacenamiento en la nube (Supabase Storage).", "Creating the video needs cloud storage (Supabase Storage).");
  const cost = projectCost(p.storyboard);
  if (cost !== confirmCents) throw bi(`El precio cambió a US$${(cost / 100).toFixed(2)}. Revísalo y confirma de nuevo.`, `The price changed to US$${(cost / 100).toFixed(2)}. Review it and confirm again.`);
  if (cost > maxCentsPerVideo()) throw bi(`Este video costaría US$${(cost / 100).toFixed(2)} y el tope es US$${(maxCentsPerVideo() / 100).toFixed(2)}. Hazlo más corto o quita la música.`, `This video would cost US$${(cost / 100).toFixed(2)} and the limit is US$${(maxCentsPerVideo() / 100).toFixed(2)}. Make it shorter or turn off the music.`);
  if ((await rendersToday(businessId)) >= maxVideosPerDay()) throw bi(`Ya se crearon ${maxVideosPerDay()} videos en las últimas 24 horas (es el tope). Intenta mañana.`, `${maxVideosPerDay()} videos were already created in the last 24 hours (that's the limit). Try tomorrow.`);

  const sb = p.storyboard;
  // La música primero: si la clave de fal.ai no sirve, se sabe antes de subir los cuadros.
  const music = sb.music.on ? await startMusic(sb.music.prompt, totalSec(sb.scenes)) : null;
  const rendered = await renderKeyframes(sb, {
    read: (url) => readMedia(url),
    upload: async (data, type) => publicMediaUrl((await storeBuffer(data, type, businessId)).url),
    clipUrl: async (mediaId, url) => publicMediaUrl(/^https:\/\//.test(url) ? url : await ensureStoredCopy(mediaId)),
  });
  const job: NonNullable<VideoProject["job"]> = {
    stage: music ? "music" : "compose",
    music,
    musicUrl: "",
    compose: music ? null : await startCompose(composeTracks(rendered.keyframes, "", rendered.totalMs, composeFrameTrack())),
    keyframes: rendered.keyframes,
    totalMs: rendered.totalMs,
    startedAt: Date.now(),
    etaSec: 60 + Math.round(rendered.totalMs / 1000),
  };
  const next: VideoProject = { ...p, status: "rendering", job, error: "", costCents: cost };
  await saveProject(businessId, id, next);
  await logAiAction({
    businessId,
    campaignId,
    kind: "video.render",
    actor,
    costCents: cost,
    summary: {
      es: `Se empezó a crear un video de ${Math.round(rendered.totalMs / 1000)} s («${sb.keyword || sb.idea.slice(0, 60)}») con ${sb.media.length} fotos/clips reales.`,
      en: `Started creating a ${Math.round(rendered.totalMs / 1000)} s video ("${sb.keyword || sb.idea.slice(0, 60)}") with ${sb.media.length} real photos/clips.`,
    },
    detail: { projectId: id, frames: rendered.frames, format: sb.format, music: sb.music.on },
  });
  return next;
}

/** Revisa cómo va el video; cuando está listo, lo guarda con un nombre con la palabra clave y la ciudad. */
export async function advanceRender(businessId: string, id: string, lang: UiLang = "es"): Promise<VideoProject> {
  const row = await loadProject(businessId, id);
  const p = row.project;
  if (p.status !== "rendering" || !p.job) return p;
  const job = { ...p.job };
  const fail = async (e: unknown) => {
    const next: VideoProject = { ...p, status: "failed", job: null, error: errorText(e, lang).slice(0, 500) };
    await saveProject(businessId, id, next);
    return next;
  };
  try {
    if (job.stage === "music" && job.music) {
      const r = await falPoll<{ audio_file?: { url?: string } }>(job.music);
      if (!r.done) return p;
      job.musicUrl = musicUrlOf(r.out);
      job.stage = "compose";
      job.compose = await startCompose(composeTracks(job.keyframes, job.musicUrl, job.totalMs, composeFrameTrack()));
      const next: VideoProject = { ...p, job };
      await saveProject(businessId, id, next);
      return next;
    }
    if (!job.compose) return fail(bi("El trabajo del video se perdió. Vuelve a crearlo.", "The video job was lost. Create it again."));
    const r = await falPoll<{ video_url?: string; thumbnail_url?: string }>(job.compose);
    if (!r.done) return p;
    if (!r.out.video_url) return fail(bi("fal.ai terminó pero no devolvió el video. Intenta de nuevo.", "fal.ai finished but didn't return the video. Please try again."));
    const sb = p.storyboard;
    const res = await fetch(r.out.video_url);
    if (!res.ok) return fail(bi(`No se pudo descargar el video (${res.status}).`, `Couldn't download the video (${res.status}).`));
    // Nombre con palabra clave y ciudad (lo leen Google y las redes); con un sufijo para que no choquen.
    const name = videoFileName(sb.keyword, sb.city, sb.format, randomBytes(3).toString("hex"));
    const stored = await storeBuffer(Buffer.from(await res.arrayBuffer()), "video/mp4", businessId, usesSupabaseStorage() ? name : undefined);
    const thumb = r.out.thumbnail_url ? await storeRemote(r.out.thumbnail_url, businessId).then((x) => x.url).catch(() => "") : "";
    const next: VideoProject = { ...p, status: "ready", job: null, videoUrl: stored.url, thumbUrl: thumb, error: "" };
    await saveProject(businessId, id, next);
    return next;
  } catch (e) {
    return fail(e);
  }
}
