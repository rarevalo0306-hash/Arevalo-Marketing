"use server";

// «Tus fotos»: la copia mejorada de cada foto (luz, color, nitidez, enderezada, datos privados tapados).
// La original nunca se toca; el dueño elige cuál va en sus publicaciones.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { enhanceItem, enhancePending, setUseEnhanced } from "@/lib/photo-enhance-run";

async function ownPhoto(businessId: string, itemId: string) {
  const item = await db.libraryItem.findFirst({ where: { id: itemId, businessId }, select: { id: true, kind: true } });
  if (!item) {
    const { t } = await getT();
    throw new Error(t("No encontramos esa foto. Puede que ya no esté en tu carpeta.", "We couldn't find that photo. It may no longer be in your folder."));
  }
  return item;
}

export type EnhanceActionResult = { ok: boolean; message: string };

/** «Mejorar» / «Volver a mejorar» una foto. Si tiene avisos de privacidad, la IA vuelve a buscar qué tapar. */
export async function enhanceOne(businessId: string, itemId: string, _prev: EnhanceActionResult | null, _f: FormData): Promise<EnhanceActionResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  try {
    await ownPhoto(businessId, itemId);
    const r = await enhanceItem(itemId, { lang, askAi: true, fresh: true, preferOriginal: true });
    revalidatePath(`/b/${businessId}/fotos`);
    return r.ok ? { ok: true, message: t("Listo: la foto quedó mejorada.", "Done: the photo was improved.") } : { ok: false, message: r.error };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

export type EnhanceAllStep = { ok: boolean; done: number; failed: number; left: number; aiCalls: number; message: string };

/**
 * «Mejorar todas»: una tanda (lo que cabe en unos 40 segundos). El navegador vuelve a llamar mientras `left` > 0.
 * Solo pregunta a la IA por las fotos con avisos de privacidad que no traen qué tapar desde su revisión.
 */
export async function enhanceAllStep(businessId: string): Promise<EnhanceAllStep> {
  const { lang } = await getT();
  try {
    const r = await enhancePending(businessId, { lang, budgetMs: 40_000, limit: 4, askAi: true, preferOriginal: true });
    if (r.done || r.failed) revalidatePath(`/b/${businessId}/fotos`);
    return { ok: true, ...r, message: r.lastError };
  } catch (e) {
    return { ok: false, done: 0, failed: 0, left: 0, aiCalls: 0, message: errorText(e, lang) };
  }
}

/** «Usar la mejorada» (true) o «Usar la original» (false) en las publicaciones. */
export async function chooseVersion(businessId: string, itemId: string, useEnhanced: boolean): Promise<EnhanceActionResult> {
  const { lang, t } = await getT();
  try {
    await ownPhoto(businessId, itemId);
    await setUseEnhanced(itemId, useEnhanced);
    revalidatePath(`/b/${businessId}/fotos`);
    return {
      ok: true,
      message: useEnhanced
        ? t("Tus publicaciones usarán la foto mejorada.", "Your posts will use the improved photo.")
        : t("Tus publicaciones usarán la foto original.", "Your posts will use the original photo."),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
