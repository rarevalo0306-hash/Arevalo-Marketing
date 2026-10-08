"use server";

// «Tus fotos»: lo que el dueño decide de cada foto o video de su carpeta de Drive, y lo que pide el compositor.
import { revalidatePath } from "next/cache";
import { syncDriveNow, type DriveResult } from "@/app/actions-drive";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { libraryPhotoUrl, markUsed, pickLibraryPhoto, usableLibrary, type LibraryCard } from "@/lib/library";
import { ensureStoredCopy } from "@/lib/library-files";
import type { LibraryChoice } from "@/lib/library-shape";

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
  await itemOf(businessId, itemId);
  const value: LibraryChoice = choice === "use" || choice === "skip" ? choice : "";
  await db.libraryItem.update({ where: { id: itemId }, data: { choice: value } });
  revalidatePath(`/b/${businessId}/fotos`);
}

/** Cuenta que se usó en una publicación. */
export async function markLibraryUsed(businessId: string, itemId: string) {
  await itemOf(businessId, itemId);
  await markUsed(businessId, [itemId]);
}

export type LibraryMediaResult = { ok: true; url: string; type: "photo" | "video" } | { ok: false; error: string };

/** La dirección del archivo para ponerlo en una publicación (los videos se copian de Drive en este momento). */
export async function libraryMedia(businessId: string, itemId: string): Promise<LibraryMediaResult> {
  const { lang, t } = await getT();
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
  return usableLibrary(businessId);
}

/** Modo mágico del compositor: la foto real que mejor va con lo que escribió la IA (o null: se crea con IA). */
export async function libraryPhotoFor(businessId: string, text: string, keywords: string[] = []): Promise<{ id: string; url: string } | null> {
  if (!text.trim()) return null;
  try {
    return await pickLibraryPhoto(businessId, { text: text.slice(0, 4000), keywords: keywords.slice(0, 8), shape: "square" });
  } catch {
    return null;
  }
}

/** «Revisar ahora» de la página «Tus fotos». */
export async function reviewDriveNow(businessId: string, _prev: DriveResult | null, _f: FormData): Promise<DriveResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  try {
    const r = await syncDriveNow(businessId);
    revalidatePath(`/b/${businessId}/fotos`);
    return r.message ? r : { ok: r.ok, message: r.ok ? t("Listo: tu carpeta está al día.", "Done: your folder is up to date.") : t("No se pudo revisar la carpeta ahora. Intenta más tarde.", "Couldn't check the folder right now. Try again later.") };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
