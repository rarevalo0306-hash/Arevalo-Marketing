"use server";

// «Tus fotos»: lo que el dueño decide de cada foto o video de su carpeta de Drive, y lo que pide el compositor.
import { revalidatePath } from "next/cache";
import { syncDriveNow, type DriveResult } from "@/app/actions-drive";
import { deniedText, hasBusiness, requireBusiness } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensure } from "@/lib/ensure";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { logAiAction } from "@/lib/ai-actions";
import { photoVariant, VARIANT_CENTS, variantsEnabled } from "@/lib/imagegen";
import { libraryPhotoUrl, markUsed, pickLibraryPhoto, recordAiMedia, usableLibrary, type LibraryCard } from "@/lib/library";
import { ensureStoredCopy } from "@/lib/library-files";
import { readDescription, type LibraryChoice } from "@/lib/library-shape";
import { photoMetaFor, storeAiPhoto } from "@/lib/media-formats";
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
  const item = await db.libraryItem.findFirst({ where: { id: itemId, businessId, source: "ai", kind: "photo", status: "ready" }, select: { id: true, url: true, name: true, tags: true, description: true } });
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
