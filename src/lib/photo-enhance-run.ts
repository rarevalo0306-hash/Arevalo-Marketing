// Hacer y guardar la copia mejorada de las fotos de «Tus fotos» (LibraryItem). La original (`url`) nunca se toca:
// la mejorada va aparte (enhancedUrl) con lo que se hizo (enhanceInfo, forma en photo-enhance-shape.ts).
// La IA solo ayuda a decir qué tapar, cuánto enderezar y dónde está lo importante; normalmente eso ya vino en la
// revisión de la foto (sin costo extra). Si falta y la foto tiene avisos de privacidad, se puede preguntar aparte.
import { Prisma, type LibraryItem } from "@prisma/client";
import { z } from "zod";
import { askGemini } from "@/lib/ai";
import { db } from "@/lib/db";
import { downloadFile } from "@/lib/drive";
import { serviceAccountEnabled } from "@/lib/google-sa";
import { bi, errorText, translator, type UiLang } from "@/lib/i18n";
import { aiModelName, ENHANCE_RULES, fetchUpload, PHOTO_MAX_BYTES, storeLibraryCopy, toPreview } from "@/lib/library-sync";
import { readMedia } from "@/lib/media";
import { enhancePhoto, type EnhanceOutput } from "@/lib/photo-enhance";
import { BLUR_REASONS, ENHANCE_VERSION, hintsFromAnswer, readEnhanceInfo, type EnhanceHints, type EnhanceInfo } from "@/lib/photo-enhance-shape";
import { deleteObject, keyFromPublicUrl, r2Enabled } from "@/lib/r2";

/** Costo aproximado de preguntar a Gemini Flash por una foto (una imagen chica y una respuesta corta), en dólares. */
export const AI_HINTS_COST_USD = 0.0008;

/** Lo que se pide en la pregunta aparte (una foto). */
const HintsSchema = z.object({
  straighten: z.number(),
  focusX: z.number(),
  focusY: z.number(),
  hide: z.array(z.object({ what: z.enum(BLUR_REASONS), box: z.array(z.number()).describe("[ymin, xmin, ymax, xmax] from 0 to 1000") })),
});

/** Pregunta a la IA por una foto: qué tapar, cuánto enderezar y dónde está lo importante. */
async function askHints(source: Buffer, item: Pick<LibraryItem, "name" | "folderPath">): Promise<EnhanceHints | null> {
  const preview = await toPreview(source);
  const system = `You help improve a real photo from a small business's own library WITHOUT changing what it shows: the app only straightens it, fixes light and color, and blurs private details. Look at the photo and answer:
${ENHANCE_RULES}`;
  const raw = await askGemini(HintsSchema, system, `Photo "${item.name}"${item.folderPath ? ` (${item.folderPath})` : ""}.`, 1024, [
    { inlineData: { mimeType: "image/jpeg", data: preview.toString("base64") } },
  ]);
  return hintsFromAnswer(raw, "enhance", aiModelName());
}

/** La foto de la que se parte: la original (más calidad) si se puede traer, si no la copia guardada. */
async function sources(item: LibraryItem, preferOriginal: boolean): Promise<Buffer[]> {
  const out: (() => Promise<Buffer>)[] = [];
  if (preferOriginal && item.sizeBytes <= PHOTO_MAX_BYTES) {
    if (item.source === "upload" && r2Enabled()) out.push(() => fetchUpload(item.externalId, PHOTO_MAX_BYTES));
    if (item.source === "drive" && serviceAccountEnabled()) out.push(() => downloadFile(item.externalId, PHOTO_MAX_BYTES));
  }
  if (item.url) out.push(() => readMedia(item.url));
  const got: Buffer[] = [];
  for (const get of out) {
    try {
      got.push(await get());
    } catch {
      // Sigue con la próxima.
    }
  }
  return got;
}

/** Borra una mejorada anterior guardada en R2 (si no se puede, queda; no es grave). */
async function dropOld(url: string, businessId: string) {
  const key = url ? keyFromPublicUrl(url) : null;
  if (!key || !key.startsWith(`library/${businessId}/`)) return;
  await deleteObject(key).catch(() => undefined);
}

export type EnhanceItemResult = { ok: true; steps: number; aiUsed: boolean } | { ok: false; error: string };

/**
 * Hace (o vuelve a hacer) la copia mejorada de una foto y la guarda. `askAi`: si faltan las indicaciones de la IA (o
 * `fresh`) y la foto tiene avisos de privacidad, se le pregunta aparte (unos US$0.0008). Si la IA falla, igual se
 * mejora con sharp (sin tapar nada). Nunca cambia `url` (la original).
 */
export async function enhanceItem(
  itemId: string,
  o: { lang?: UiLang; askAi?: boolean; fresh?: boolean; preferOriginal?: boolean } = {},
): Promise<EnhanceItemResult> {
  const t = translator(o.lang ?? "es");
  const item = await db.libraryItem.findUnique({ where: { id: itemId } });
  if (!item) return { ok: false, error: t("Esa foto ya no está en la biblioteca.", "That photo is no longer in the library.") };
  if (item.kind !== "photo") return { ok: false, error: t("Solo se mejoran fotos, no videos.", "Only photos are improved, not videos.") };
  if (!item.url || item.status !== "ready")
    return { ok: false, error: t("La foto todavía no está lista: espera a que la IA la revise.", "The photo isn't ready yet: wait for the AI to review it.") };

  const prev = readEnhanceInfo(item.enhanceInfo);
  let hints = prev?.hints ?? null;
  let ai: EnhanceInfo["ai"] = hints ? { model: hints.model, costUsd: hints.from === "review" ? 0 : AI_HINTS_COST_USD } : null;
  const bufs = await sources(item, o.preferOriginal ?? true);
  if (!bufs.length) return save(item, prev, { error: t("No se pudo traer la foto para mejorarla.", "Couldn't get the photo to improve it.") });

  const wantAi = Boolean(o.askAi && process.env.GEMINI_API_KEY && item.privacy.length > 0 && (!hints || o.fresh));
  let asked = false;
  if (wantAi) {
    try {
      const fresh = await askHints(bufs[0], item);
      asked = true;
      if (fresh) {
        hints = fresh;
        ai = { model: fresh.model, costUsd: AI_HINTS_COST_USD };
      }
    } catch (e) {
      // Sin la IA igual se mejora (sin tapar nada); el aviso de privacidad sigue pidiendo la aprobación del dueño.
      console.error("[mejorar] la IA no contestó:", errorText(e, "es"));
    }
  }

  let out: EnhanceOutput | null = null;
  let lastError = "";
  for (const b of bufs) {
    try {
      out = await enhancePhoto(b, { hints });
      break;
    } catch (e) {
      lastError = errorText(e, o.lang ?? "es");
    }
  }
  if (!out) {
    return save(item, prev, {
      hints,
      error: t("La app no pudo abrir esta foto para mejorarla", "The app couldn't open this photo to improve it") + (lastError ? ` (${lastError.slice(0, 120)}).` : "."),
    });
  }
  try {
    const [url, thumb] = await Promise.all([storeLibraryCopy(out.data, item.businessId), storeLibraryCopy(out.thumb, item.businessId)]);
    const info: EnhanceInfo = {
      v: ENHANCE_VERSION,
      at: new Date().toISOString(),
      steps: out.steps,
      focus: out.focus,
      focusFrom: out.focusFrom,
      original: out.original,
      enhanced: { w: out.width, h: out.height },
      thumb,
      ai: hints ? ai : null,
      hints,
      error: "",
    };
    await db.libraryItem.update({
      where: { id: item.id },
      data: { enhancedUrl: url, enhancedAt: new Date(), enhanceInfo: info as unknown as Prisma.InputJsonValue },
    });
    if (item.enhancedUrl && item.enhancedUrl !== url) {
      await dropOld(item.enhancedUrl, item.businessId);
      if (prev?.thumb) await dropOld(prev.thumb, item.businessId);
    }
    return { ok: true, steps: out.steps.length, aiUsed: asked };
  } catch (e) {
    return save(item, prev, { hints, error: t("No se pudo guardar la foto mejorada: ", "Couldn't save the improved photo: ") + errorText(e, o.lang ?? "es") });
  }
}

/** Guarda el error (la mejorada anterior, si había, se queda). Marca la fecha para no reintentar sola sin parar. */
async function save(item: LibraryItem, prev: EnhanceInfo | null, o: { hints?: EnhanceHints | null; error: string }): Promise<EnhanceItemResult> {
  const info = { ...(prev ?? {}), v: prev?.v || ENHANCE_VERSION, hints: o.hints ?? prev?.hints ?? null, error: o.error };
  await db.libraryItem.update({
    where: { id: item.id },
    data: { enhancedAt: new Date(), enhanceInfo: info as unknown as Prisma.InputJsonValue },
  });
  return { ok: false, error: o.error };
}

/** Fotos listas que todavía no tienen mejorada (ni se intentó). */
export const pendingWhere = (businessId: string): Prisma.LibraryItemWhereInput => ({
  businessId,
  kind: "photo",
  status: "ready",
  url: { not: "" },
  enhancedAt: null,
});

export const pendingEnhanceCount = (businessId: string) => db.libraryItem.count({ where: pendingWhere(businessId) });

export type EnhanceBatch = { done: number; failed: number; left: number; aiCalls: number; lastError: string };

/**
 * Mejora las fotos que faltan (las más nuevas primero) mientras quede tiempo. Pensado para llamarse varias veces
 * (cada llamada cabe en el límite de tiempo de Vercel): `left` dice cuántas quedan.
 */
export async function enhancePending(
  businessId: string,
  o: { lang?: UiLang; budgetMs?: number; limit?: number; askAi?: boolean; preferOriginal?: boolean } = {},
): Promise<EnhanceBatch> {
  const start = Date.now();
  const budget = o.budgetMs ?? 40_000;
  const rows = await db.libraryItem.findMany({
    where: pendingWhere(businessId),
    select: { id: true },
    orderBy: [{ createdAt: "desc" }],
    take: o.limit ?? 12,
  });
  const out: EnhanceBatch = { done: 0, failed: 0, left: 0, aiCalls: 0, lastError: "" };
  for (const r of rows) {
    // Cada foto tarda unos segundos (más si se trae la original de Drive): se deja margen.
    if (Date.now() - start > budget - 8_000 && out.done + out.failed > 0) break;
    try {
      const res = await enhanceItem(r.id, { lang: o.lang, askAi: o.askAi, preferOriginal: o.preferOriginal });
      if (res.ok) {
        out.done++;
        if (res.aiUsed) out.aiCalls++;
      } else {
        out.failed++;
        out.lastError = res.error;
      }
    } catch (e) {
      out.failed++;
      out.lastError = errorText(e, o.lang ?? "es");
    }
  }
  out.left = await pendingEnhanceCount(businessId);
  return out;
}

/** «Usar la mejorada» (true) o «Usar la original» (false). */
export async function setUseEnhanced(itemId: string, use: boolean): Promise<void> {
  const item = await db.libraryItem.findUnique({ where: { id: itemId }, select: { enhancedUrl: true } });
  if (!item) throw bi("Esa foto ya no está en la biblioteca.", "That photo is no longer in the library.");
  await db.libraryItem.update({ where: { id: itemId }, data: { useEnhanced: use } });
}
