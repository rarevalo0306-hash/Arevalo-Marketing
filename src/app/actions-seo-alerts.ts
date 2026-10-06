"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { MAX_ALERT_EMAILS, parseAlertEmails, senderLabel, sendWeeklyReport } from "@/lib/seo/alerts";

export type AlertsResult = { ok: boolean; message: string } | null;

/** Guarda a quién mandar los avisos, qué avisos quiere y el idioma de los emails (el de la app ahora). */
export async function saveSeoAlerts(businessId: string, _prev: AlertsResult, f: FormData): Promise<AlertsResult> {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  const alerts = f.get("alerts") === "on";
  const weekly = f.get("weekly") === "on";
  const parsed = parseAlertEmails(String(f.get("email") ?? "").slice(0, 700));
  if (!parsed.ok)
    return {
      ok: false,
      message: parsed.tooMany
        ? t(`Puedes poner hasta ${MAX_ALERT_EMAILS} emails, separados por comas.`, `You can enter up to ${MAX_ALERT_EMAILS} emails, separated by commas.`)
        : t(`Este email no es válido: ${parsed.bad}. Escríbelo así: tu@correo.com`, `This email isn't valid: ${parsed.bad}. Write it like: you@email.com`),
    };
  if ((alerts || weekly) && !parsed.emails.length)
    return { ok: false, message: t("Escribe el email donde quieres recibir los avisos.", "Enter the email where you want to receive the alerts.") };
  await db.business.update({
    where: { id: businessId },
    data: { seoAlertEmail: parsed.emails.join(", "), seoAlerts: alerts, seoWeekly: weekly, seoEmailLang: lang },
  });
  revalidatePath(`/b/${businessId}/seo`);
  const what = [alerts && t("avisos si bajas en Google", "alerts if you drop on Google"), weekly && t("resumen cada lunes", "summary every Monday")].filter(Boolean).join(t(" y ", " and "));
  return {
    ok: true,
    message: what
      ? t(`Guardado. Recibirás ${what} en ${parsed.emails.join(", ")}.`, `Saved. You'll get ${what} at ${parsed.emails.join(", ")}.`)
      : t("Guardado. Los avisos por email están apagados.", "Saved. Email alerts are off."),
  };
}

/** Manda ahora el resumen semanal al email guardado (no cuenta como el resumen del lunes). */
export async function sendSeoTestEmail(businessId: string, _prev: AlertsResult): Promise<AlertsResult> {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  try {
    const { to, sender } = await sendWeeklyReport(businessId);
    return {
      ok: true,
      message: t(
        `Listo: mandamos el resumen a ${to.join(", ")} desde ${senderLabel(sender)}. Revisa tu bandeja de entrada (y la carpeta de spam).`,
        `Done: we sent the summary to ${to.join(", ")} from ${senderLabel(sender)}. Check your inbox (and the spam folder).`,
      ),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
