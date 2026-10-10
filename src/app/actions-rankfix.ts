"use server";

import { revalidatePath } from "next/cache";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { authorizeRankFix, closeRankFix, pollRankFix, publishRankFix, removeRankFixItem, stockPhotoRankFixItem } from "@/lib/rankfix";
import type { RankFixView } from "@/lib/rankfix-shape";
import type { FixView } from "@/lib/webfix-shape";

export type RankFixResult = { ok: boolean; message: string; job: RankFixView | null; fix: FixView | null };

/** «Autorizar · hasta US$X.XX»: aprueba el gasto para PREPARAR (no publica nada). `cents` es lo que vio el dueño. */
export async function authorizeRankFixAction(businessId: string, keys: string[], cents: number): Promise<RankFixResult> {
  const { lang } = await getT();
  try {
    const r = await authorizeRankFix(businessId, Array.isArray(keys) ? keys.filter((k) => typeof k === "string") : [], Number(cents), lang);
    return { ok: r.ok, message: r.message[lang], job: r.job, fix: r.fix };
  } catch (e) {
    return { ok: false, message: errorText(e, lang), job: null, fix: null };
  }
}

/** El avance (solo la base de datos). Si el trabajo se cortó, sigue donde quedó. */
export async function pollRankFixAction(businessId: string, id: string): Promise<{ job: RankFixView | null; fix: FixView | null }> {
  try {
    return await pollRankFix(businessId, String(id));
  } catch {
    return { job: null, fix: null };
  }
}

/** «Quitar»: ese artículo no se publica (queda guardado en «Escribir artículo»). */
export async function removeRankFixItemAction(businessId: string, id: string, key: string): Promise<RankFixView | null> {
  try {
    return await removeRankFixItem(businessId, String(id), String(key));
  } catch {
    return null;
  }
}

/** Usar la foto del tema de la web (gratis) en un artículo que paró antes de la foto con IA. */
export async function stockPhotoRankFixAction(businessId: string, id: string, key: string): Promise<RankFixResult> {
  const { lang, t } = await getT();
  try {
    const job = await stockPhotoRankFixItem(businessId, String(id), String(key));
    return { ok: Boolean(job), message: t("Listo: usará la foto del tema de tu web.", "Done: it will use your website's topic photo."), job, fix: null };
  } catch (e) {
    return { ok: false, message: errorText(e, lang), job: null, fix: null };
  }
}

/** «Publicar todo»: el segundo y último clic (aprueba que salga en la web). */
export async function publishRankFixAction(businessId: string, id: string): Promise<RankFixResult> {
  const { lang } = await getT();
  try {
    const r = await publishRankFix(businessId, String(id));
    revalidatePath(`/b/${businessId}/seo/escribir`);
    return { ok: r.ok, message: r.message[lang], job: r.job, fix: r.fix };
  } catch (e) {
    return { ok: false, message: errorText(e, lang), job: null, fix: null };
  }
}

/** «Cerrar esta lista»: los artículos quedan guardados en «Escribir artículo»; se puede armar otra ronda. */
export async function closeRankFixAction(businessId: string, id: string): Promise<boolean> {
  try {
    const ok = await closeRankFix(businessId, String(id));
    revalidatePath(`/b/${businessId}/seo`);
    return ok;
  } catch {
    return false;
  }
}
