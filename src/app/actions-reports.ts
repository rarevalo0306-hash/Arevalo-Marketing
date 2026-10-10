"use server";

import { revalidatePath } from "next/cache";
import { appOrigin } from "@/lib/app-origin";
import { businessTz, isValidTz, yesterday } from "@/lib/business-tz";
import { dailyRecipients, saveReportSettings, sendDailyReport, sendRangeReport } from "@/lib/daily-report";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { parseRange, periodText } from "@/lib/report-period";
import { parseAlertEmails, senderLabel } from "@/lib/seo/alerts";

export type ReportActionResult = { ok: boolean; message: string } | null;

const get = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Guarda los ajustes del reporte diario: encendido, a quién, zona horaria, días tranquilos e idioma del email. */
export async function saveDailySettings(businessId: string, _prev: ReportActionResult, f: FormData): Promise<ReportActionResult> {
  const { t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { ownerEmail: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  const daily = f.get("daily") === "on";
  const rawEmail = get(f, "email");
  let reportEmail = "";
  if (rawEmail) {
    const parsed = parseAlertEmails(rawEmail);
    if (!parsed.ok)
      return {
        ok: false,
        message: parsed.tooMany
          ? t("Puedes poner hasta 3 emails, separados por comas.", "You can enter up to 3 emails, separated by commas.")
          : t(`Este email no parece válido: ${parsed.bad}`, `This email doesn't look valid: ${parsed.bad}`),
      };
    reportEmail = parsed.emails.join(", ");
    // Si es el mismo del dueño, se deja vacío: así sigue al email del dueño si lo cambia.
    if (reportEmail === b.ownerEmail.trim().toLowerCase()) reportEmail = "";
  }
  const tzRaw = get(f, "timezone");
  if (tzRaw && !isValidTz(tzRaw)) return { ok: false, message: t("Esa zona horaria no existe. Elige una de la lista.", "That time zone doesn't exist. Pick one from the list.") };
  const to = dailyRecipients({ reportEmail, ownerEmail: b.ownerEmail });
  if (daily && !to.length)
    return {
      ok: false,
      message: t(
        "Escribe a qué email mandarlo (o guarda el email del dueño en «Datos del negocio») y vuelve a guardar.",
        "Enter which email to send it to (or save the owner's email in \"Business details\") and save again.",
      ),
    };
  const emailLang = get(f, "lang") === "en" ? "en" : "es";
  await db.business.update({ where: { id: businessId }, data: { reportDaily: daily, reportEmail, timezone: tzRaw, seoEmailLang: emailLang } });
  await saveReportSettings(businessId, { quietDays: f.get("quiet") === "on" ? "send" : "skip" });
  revalidatePath(`/b/${businessId}/reportes`);
  return {
    ok: true,
    message: daily
      ? t(`Guardado. Cada día, después de la medianoche, te mandamos el reporte del día anterior a ${to.join(", ")}.`, `Saved. Every day, after midnight, we'll send the previous day's report to ${to.join(", ")}.`)
      : t("Guardado. El reporte diario por email está apagado (puedes ver cualquier reporte aquí cuando quieras).", "Saved. The daily email report is off (you can see any report here whenever you want)."),
  };
}

/** «Mandar el de ayer ahora»: manda ya el reporte de ayer (aunque ya se haya mandado), para ver cómo llega. */
export async function sendYesterdayNow(businessId: string, _prev: ReportActionResult): Promise<ReportActionResult> {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { timezone: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  const day = yesterday(businessTz(b));
  try {
    const res = await sendDailyReport(businessId, day, { trigger: "manual", baseUrl: await appOrigin() });
    revalidatePath(`/b/${businessId}/reportes`);
    if (res.state !== "sent") return { ok: false, message: t("Ya se está mandando ese reporte. Espera un minuto.", "That report is already being sent. Wait a minute.") };
    return {
      ok: true,
      message: t(
        `Listo: mandamos el reporte de ayer a ${res.to.join(", ")}${res.sender ? ` desde ${senderLabel(res.sender)}` : ""}. Revisa tu bandeja de entrada (y la carpeta de spam).`,
        `Done: we sent yesterday's report to ${res.to.join(", ")}${res.sender ? ` from ${senderLabel(res.sender)}` : ""}. Check your inbox (and the spam folder).`,
      ),
    };
  } catch (e) {
    revalidatePath(`/b/${businessId}/reportes`);
    return { ok: false, message: errorText(e, lang) };
  }
}

/** «Enviarme este reporte por email»: el reporte del rango que se está viendo. */
export async function emailRangeReport(businessId: string, _prev: ReportActionResult, f: FormData): Promise<ReportActionResult> {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { timezone: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  const period = parseRange({ desde: get(f, "desde"), hasta: get(f, "hasta") }, businessTz(b));
  try {
    const res = await sendRangeReport(businessId, period, { baseUrl: await appOrigin() });
    revalidatePath(`/b/${businessId}/reportes`);
    return {
      ok: true,
      message: t(
        `Listo: mandamos el reporte de ${periodText(period, "es")} a ${res.to.join(", ")}. Revisa tu bandeja de entrada (y la carpeta de spam).`,
        `Done: we sent the report for ${periodText(period, "en")} to ${res.to.join(", ")}. Check your inbox (and the spam folder).`,
      ),
    };
  } catch (e) {
    revalidatePath(`/b/${businessId}/reportes`);
    return { ok: false, message: errorText(e, lang) };
  }
}
