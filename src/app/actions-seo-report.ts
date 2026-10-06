"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { asLang, errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { alertRecipients, senderLabel } from "@/lib/seo/alerts";
import { asPreset } from "@/lib/seo/report";
import { emailReport as sendReport } from "@/lib/seo/report-run";

export type ReportResult = { ok: boolean; message: string } | null;

const last = (f: FormData, key: string) => {
  const all = f.getAll(key);
  return all.length ? String(all[all.length - 1]) : null;
};
const on = (v: string | null) => v === "1" || v === "on";

/** Arma el reporte en PDF y lo manda adjunto a los emails de los avisos. */
export async function emailReport(businessId: string, _prev: ReportResult, f: FormData): Promise<ReportResult> {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  try {
    const { to, sender, report } = await sendReport(businessId, {
      preset: asPreset(last(f, "periodo")),
      lang: asLang(last(f, "lang") ?? lang),
      ai: on(last(f, "ia")),
      whiteLabel: !on(last(f, "marca") ?? "1"),
    });
    return {
      ok: true,
      message: t(
        `Listo: mandamos el reporte (${report.fileName}) a ${to.join(", ")} desde ${senderLabel(sender)}. Revisa tu bandeja de entrada (y la carpeta de spam).`,
        `Done: we sent the report (${report.fileName}) to ${to.join(", ")} from ${senderLabel(sender)}. Check your inbox (and the spam folder).`,
      ),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** Enciende o apaga el reporte de cada mes (sale el día 1 con el mes anterior, al email de los avisos). */
export async function saveMonthlyReport(businessId: string, _prev: ReportResult, f: FormData): Promise<ReportResult> {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { seoAlertEmail: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  const monthly = f.get("monthly") === "on";
  const to = alertRecipients(b.seoAlertEmail);
  if (monthly && !to.length)
    return {
      ok: false,
      message: t(
        "Primero guarda tu email en «Avisos por email» (más arriba en esta página) y vuelve a intentar.",
        "First save your email in \"Email alerts\" (higher up on this page) and try again.",
      ),
    };
  await db.business.update({ where: { id: businessId }, data: { seoMonthly: monthly, ...(monthly ? { seoEmailLang: lang } : {}) } });
  revalidatePath(`/b/${businessId}/seo`);
  return {
    ok: true,
    message: monthly
      ? t(`Guardado. El día 1 de cada mes te mandamos el reporte del mes anterior a ${to.join(", ")}.`, `Saved. On the 1st of each month we'll send last month's report to ${to.join(", ")}.`)
      : t("Guardado. El reporte de cada mes está apagado.", "Saved. The monthly report is off."),
  };
}
