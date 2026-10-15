"use server";

// «Tus fotos»: lo que el dueño decide de cada foto o video de su carpeta de Drive, y lo que pide el compositor.
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { syncDriveNow, type DriveResult } from "@/app/actions-drive";
import { deniedText, hasBusiness, requireBusiness } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensure } from "@/lib/ensure";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { logAiAction } from "@/lib/ai-actions";
import { photoVariant, VARIANT_CENTS, variantsEnabled } from "@/lib/imagegen";
import { EDIT_FOLDER, editedByAi, libraryPhotoUrl, markUsed, pickLibraryPhoto, recordAiMedia, recordEditedPhoto, usableLibrary, type LibraryCard, type PhotoEdit } from "@/lib/library";
import { ensureStoredCopy } from "@/lib/library-files";
import { readDescription, type LibraryChoice } from "@/lib/library-shape";
import { photoMetaFor, storeAiPhoto, storeEditedPhoto } from "@/lib/media-formats";
import { aiPhotoProblems, canUpscale, CUTOUT_CENTS, cutoutPhoto, FIX_CENTS, fixAiPhoto, fixEnabled, falToolsEnabled, UPSCALE_CENTS, upscalePhoto } from "@/lib/photo-tools";
import { publicMediaUrl, readMedia } from "@/lib/media";

async function itemOf(businessId: string, itemId: string) {
  const item = await db.libraryItem.findFirst({ where: { id: itemId, businessId }, select: { id: true, kind: true, url: true, enhancedUrl: true, useEnhanced: true } });
  if (!item) {
    const { t } = await getT();
    throw new Error(t("No encontramos esa foto. Puede que ya no esté en tu carpeta.", "We couldn't find that photo. It may no longer be in your folder."));
  }
  return item;
}

/** «Usar» (aprobada aunque tenga avisos), «No usar», o "" (decide la IA). */
export async function setLibraryChoice(businessId: string, itemId: string, choice: LibraryChoice) {
  ensure.text(businessId, itemId, choice);
  await requireBusiness(businessId, "publish");
  await itemOf(businessId, itemId);
  const value: LibraryChoice = choice === "use" || choice === "skip" ? choice : "";
  await db.libraryItem.update({ where: { id: itemId }, data: { choice: value } });
  revalidatePath(`/b/${businessId}/fotos`);
}

/** Cuenta que se usó en una publicación. */
export async function markLibraryUsed(businessId: string, itemId: string) {
  ensure.text(businessId, itemId);
  await requireBusiness(businessId, "publish");
  await itemOf(businessId, itemId);
  await markUsed(businessId, [itemId]);
}

export type LibraryMediaResult = { ok: true; url: string; type: "photo" | "video" } | { ok: false; error: string };

/** La dirección del archivo para ponerlo en una publicación (los videos se copian de Drive en este momento). */
export async function libraryMedia(businessId: string, itemId: string): Promise<LibraryMediaResult> {
  ensure.text(businessId, itemId);
  const { lang, t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, error: await deniedText(businessId, "publish") };
  try {
    const item = await itemOf(businessId, itemId);
    // Las fotos ya tienen su copia; los videos (o lo que falte) se traen de Drive ahora.
    // La foto mejorada si existe y el dueño no eligió la original.
    const url = item.kind === "photo" && item.url ? libraryPhotoUrl(item) : await ensureStoredCopy(itemId);
    if (!url) return { ok: false, error: t("No se pudo traer el archivo de tu carpeta.", "Couldn't get the file from your folder.") };
    await markUsed(businessId, [itemId]).catch(() => undefined);
    return { ok: true, url, type: item.kind === "video" ? "video" : "photo" };
  } catch (e) {
    const why = errorText(e, lang);
    return { ok: false, error: why === "not implemented" ? t("Todavía no se puede traer este archivo de Drive.", "This file can't be brought from Drive yet.") : why };
  }
}

/** Lo que se puede usar, para el selector «Tus fotos» del compositor. */
export async function libraryForPicker(businessId: string): Promise<LibraryCard[]> {
  ensure.text(businessId);
  if (!(await hasBusiness(businessId, "view"))) return [];
  return usableLibrary(businessId);
}

/** Modo mágico del compositor: la foto real que mejor va con lo que escribió la IA (o null: se crea con IA). */
export async function libraryPhotoFor(businessId: string, text: string, keywords: string[] = []): Promise<{ id: string; url: string } | null> {
  ensure.text(businessId, text); ensure.optionalTexts(keywords);
  if (!text.trim()) return null;
  // Elegirla la marca como usada: es parte de crear una publicación.
  if (!(await hasBusiness(businessId, "publish"))) return null;
  try {
    return await pickLibraryPhoto(businessId, { text: text.slice(0, 4000), keywords: keywords.slice(0, 8), shape: "square" });
  } catch {
    return null;
  }
}

/** «Revisar ahora» de la página «Tus fotos». */
export async function reviewDriveNow(businessId: string, _prev: DriveResult | null, _f: FormData): Promise<DriveResult> {
  ensure.text(businessId);
  void _prev;
  void _f;
  const { lang, t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  try {
    const r = await syncDriveNow(businessId);
    revalidatePath(`/b/${businessId}/fotos`);
    return r.message ? r : { ok: r.ok, message: r.ok ? t("Listo: tu carpeta está al día.", "Done: your folder is up to date.") : t("No se pudo revisar la carpeta ahora. Intenta más tarde.", "Couldn't check the folder right now. Try again later.") };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

export type VariantResult = { ok: true; message: string } | { ok: false; message: string } | null;

/**
 * «Crear otra versión» de una foto que hizo la IA: mismo tema y estilo, otro ángulo. Queda en la biblioteca como foto
 * nueva («Hechas con IA») para que no se repita la misma foto. Solo con fotos de IA: las fotos reales de trabajos no se
 * alteran (una versión inventada de un trabajo o un daño real pasaría por foto real).
 */
export async function makePhotoVariant(businessId: string, itemId: string): Promise<VariantResult> {
  ensure.text(businessId, itemId);
  const { lang, t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  if (!variantsEnabled()) return { ok: false, message: t("Para hacer otra versión hace falta la clave de Gemini o de fal.ai en la configuración del servidor.", "Making another version needs the Gemini or fal.ai key in the server settings.") };
  // Las fotos reales recortadas o agrandadas con IA también están en «Hechas con IA», pero siguen siendo reales.
  const item = await db.libraryItem.findFirst({ where: { id: itemId, businessId, source: "ai", kind: "photo", status: "ready", NOT: { folderPath: { in: [EDIT_FOLDER.cutout, EDIT_FOLDER.upscale] } } }, select: { id: true, url: true, name: true, tags: true, description: true } });
  if (!item?.url) return { ok: false, message: t("Solo se pueden hacer versiones de fotos creadas por la IA.", "Only photos made by the AI can get new versions.") };
  const b = await db.business.findUnique({ where: { id: businessId } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  try {
    const d = readDescription(item.description);
    const title = d?.es || item.name;
    const out = await photoVariant({ data: await readMedia(item.url), url: publicMediaUrl(item.url) });
    const url = await storeAiPhoto(out.data, out.type, businessId, photoMetaFor(b, { title, keywords: item.tags }));
    await recordAiMedia(businessId, url, { kind: "photo", title, prompt: d?.en || title, keywords: item.tags, parentId: item.id, used: false });
    await logAiAction({ businessId, kind: "photo.variant", actor: "owner", costCents: VARIANT_CENTS, summary: { es: "Otra versión de una foto hecha con IA", en: "Another version of an AI photo" }, detail: { from: item.id } });
    revalidatePath(`/b/${businessId}/fotos`);
    return { ok: true, message: t("Listo: la versión nueva está en «Hechas con IA».", "Done: the new version is in “Made with AI”.") };
  } catch (e) {
    return { ok: false, message: t(`No se pudo hacer otra versión: ${errorText(e, lang)}`, `Couldn't make another version: ${errorText(e, lang)}`) };
  }
}

// ---------- Editar una foto con IA: recortar, agrandar y arreglar ----------

const TOOL_SELECT = { id: true, url: true, enhancedUrl: true, useEnhanced: true, name: true, description: true, tags: true, quality: true, privacy: true, choice: true, usable: true, source: true, folderPath: true } as const;

const DONE: Record<PhotoEdit, { es: string; en: string; cents: number; kind: string }> = {
  cutout: { es: "Foto recortada (sin fondo) con IA", en: "Photo cut out (no background) with AI", cents: CUTOUT_CENTS, kind: "photo.cutout" },
  upscale: { es: "Foto agrandada sin inventar con IA", en: "Photo enlarged without inventing, with AI", cents: UPSCALE_CENTS, kind: "photo.upscale" },
  fix: { es: "Foto de IA arreglada (errores típicos)", en: "AI photo fixed (typical errors)", cents: FIX_CENTS, kind: "photo.fix" },
};

/**
 * Hace una edición de una foto de «Tus fotos» y la guarda como foto nueva (la original nunca se toca). Recortar y
 * agrandar sirven para cualquier foto; arreglar, solo para las que hizo la IA (en una foto real, «arreglar» sería
 * cambiar lo que pasó).
 */
async function editLibraryPhoto(businessId: string, itemId: string, edit: PhotoEdit): Promise<VariantResult> {
  ensure.text(businessId, itemId);
  const { lang, t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  if (edit === "fix" ? !fixEnabled() : !falToolsEnabled())
    return { ok: false, message: edit === "fix" ? t("Para revisar fotos hace falta la clave de Gemini en la configuración del servidor.", "Checking photos needs the Gemini key in the server settings.") : t("Para esto hace falta la clave de fal.ai en la configuración del servidor.", "This needs the fal.ai key in the server settings.") };
  const item = await db.libraryItem.findFirst({ where: { id: itemId, businessId, kind: "photo", status: "ready" }, select: TOOL_SELECT });
  if (!item) return { ok: false, message: t("No encontré esa foto.", "I couldn't find that photo.") };
  const fullyAi = item.source === "ai" && !editedByAi(item.folderPath);
  if (edit === "fix" && !fullyAi) return { ok: false, message: t("Solo se arreglan fotos hechas con IA: una foto real no se cambia.", "Only AI-made photos get fixed: a real photo isn't changed.") };
  const b = await db.business.findUnique({ where: { id: businessId } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  try {
    // La que se usa en las publicaciones (la mejorada, con lo privado ya tapado, si existe).
    const src = libraryPhotoUrl(item);
    const data = await readMedia(src);
    const d = readDescription(item.description);
    const meta = photoMetaFor(b, { title: d?.es || item.name, keywords: item.tags });
    let url: string;
    let note = "";
    if (edit === "fix") {
      const problems = await aiPhotoProblems(data);
      if (!problems.length) return { ok: true, message: t("La IA revisó la foto y no vio errores: no hizo falta arreglarla.", "The AI checked the photo and saw no errors: nothing to fix.") };
      const out = await fixAiPhoto({ data, url: publicMediaUrl(src) }, problems);
      url = await storeAiPhoto(out.data, out.type, businessId, meta);
      note = problems.join("; ");
    } else {
      const size = await sharp(data).metadata();
      if (edit === "upscale" && !canUpscale(size.width ?? 0, size.height ?? 0)) return { ok: false, message: t("Esta foto ya es grande: no hace falta agrandarla.", "This photo is already big: no need to enlarge it.") };
      const out = edit === "cutout" ? await cutoutPhoto(publicMediaUrl(src)) : await upscalePhoto(publicMediaUrl(src));
      url = await storeEditedPhoto(out, edit === "cutout" ? "image/png" : "image/jpeg", businessId, { fullyAi, tool: edit === "cutout" ? "Bria RMBG (fal.ai)" : "Real-ESRGAN (fal.ai)", meta });
    }
    const info = await sharp(await readMedia(url)).metadata();
    await recordEditedPhoto(businessId, url, item, edit, { width: info.width ?? 0, height: info.height ?? 0 });
    await logAiAction({ businessId, kind: DONE[edit].kind, actor: "owner", costCents: DONE[edit].cents, summary: { es: DONE[edit].es, en: DONE[edit].en }, detail: { from: item.id, ...(note ? { problems: note } : {}) } });
    revalidatePath(`/b/${businessId}/fotos`);
    if (edit === "cutout") return { ok: true, message: t("Listo: la foto recortada (sin fondo) está en «Hechas con IA». La IA no la usa sola; úsala tú cuando quieras.", "Done: the cut-out photo (no background) is in “Made with AI”. The AI won't use it on its own; use it whenever you want.") };
    if (edit === "upscale") return { ok: true, message: t("Listo: la foto agrandada está en «Hechas con IA». Si ya no quieres la chica, márcala «No usar».", "Done: the enlarged photo is in “Made with AI”. If you don't want the small one anymore, mark it “Don't use”.") };
    return { ok: true, message: t(`Listo: la versión arreglada está en «Hechas con IA». Se arregló: ${note}.`, `Done: the fixed version is in “Made with AI”. Fixed: ${note}.`) };
  } catch (e) {
    return { ok: false, message: t(`No se pudo: ${errorText(e, lang)}`, `Couldn't do it: ${errorText(e, lang)}`) };
  }
}

/** Recortar: la persona u objeto principal sin el fondo (PNG transparente). */
export async function cutoutLibraryPhoto(businessId: string, itemId: string): Promise<VariantResult> {
  ensure.text(businessId, itemId);
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  return editLibraryPhoto(businessId, itemId, "cutout");
}

/** Agrandar sin inventar: la foto al doble de tamaño (solo fotos chicas). */
export async function upscaleLibraryPhoto(businessId: string, itemId: string): Promise<VariantResult> {
  ensure.text(businessId, itemId);
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  return editLibraryPhoto(businessId, itemId, "upscale");
}

/** Arreglar: la IA revisa una foto que ella hizo y arregla los errores típicos (manos, letras, objetos raros). */
export async function fixLibraryAiPhoto(businessId: string, itemId: string): Promise<VariantResult> {
  ensure.text(businessId, itemId);
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  return editLibraryPhoto(businessId, itemId, "fix");
}
