"use server";

import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { checkWebFixAccess, discardWebFix, getWebFix, publishWebFix, refreshWebFix, startWebFix, type StartInput } from "@/lib/webfix";
import type { FixView } from "@/lib/webfix-shape";

export type WebFixResult = { ok: boolean; message: string; job: FixView | null };

/** «Arréglalo por mí»: empieza a preparar los arreglos (el trabajo sigue después de responder). */
export async function startWebFixAction(businessId: string, input: StartInput): Promise<WebFixResult> {
  const { lang, t } = await getT();
  try {
    const job = await startWebFix(businessId, input);
    return { ok: true, message: t("Matya está preparando los arreglos. Tu web no cambia hasta que tú lo apruebes.", "Matya is preparing the fixes. Your website doesn't change until you approve it."), job };
  } catch (e) {
    return { ok: false, message: errorText(e, lang), job: null };
  }
}

/** El último arreglo guardado (solo la base de datos; para ver el avance mientras se prepara). */
export async function getWebFixAction(businessId: string): Promise<FixView | null> {
  return getWebFix(businessId);
}

/** Revisa el PR en GitHub: vista previa, conflictos, o si se publicó o cerró fuera de Matya. */
export async function refreshWebFixAction(businessId: string, id: string): Promise<FixView | null> {
  try {
    return await refreshWebFix(businessId, id);
  } catch {
    return null;
  }
}

export async function publishWebFixAction(businessId: string, id: string): Promise<WebFixResult> {
  const { lang } = await getT();
  try {
    const r = await publishWebFix(businessId, id);
    return { ok: r.ok, message: r.message[lang], job: r.job };
  } catch (e) {
    return { ok: false, message: errorText(e, lang), job: null };
  }
}

export async function discardWebFixAction(businessId: string, id: string): Promise<WebFixResult> {
  const { lang } = await getT();
  try {
    const r = await discardWebFix(businessId, id);
    return { ok: r.ok, message: r.message[lang], job: r.job };
  } catch (e) {
    return { ok: false, message: errorText(e, lang), job: null };
  }
}

export type AccessResult = { ok: boolean; lines: { ok: boolean; text: string }[]; expires: string; missingPulls: boolean };

/** «Revisar la llave»: solo lectura, no cambia nada en GitHub. */
export async function checkWebFixAccessAction(businessId: string): Promise<AccessResult> {
  const { lang, t } = await getT();
  try {
    const r = await checkWebFixAccess(businessId);
    if (!r) return { ok: false, lines: [{ ok: false, text: t("Primero conecta tu web en Conexiones → Sitio web.", "First connect your website in Connections → Website.") }], expires: "", missingPulls: false };
    return { ok: r.ok, lines: r.lines.map((l) => ({ ok: l.ok, text: l.text[lang] })), expires: r.expires, missingPulls: r.missing.includes("pulls") || r.missing.includes("contents") };
  } catch (e) {
    return { ok: false, lines: [{ ok: false, text: errorText(e, lang) }], expires: "", missingPulls: false };
  }
}
