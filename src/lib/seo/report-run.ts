// Arma el reporte en PDF de un negocio y lo manda por email (a pedido o el día 1 de cada mes, desde el cron).
import { db } from "@/lib/db";
import type { UiLang } from "@/lib/i18n";
import { BUSINESS_TZ } from "@/lib/time";
import { alertRecipients, type Sender, SenderConfigError, sendSeoEmail } from "@/lib/seo/alerts";
import {
  buildReportEmail,
  currentMonthStart,
  gatherReport,
  isMonthlyDue,
  periodFor,
  reportFileName,
  reportSummary,
  type PeriodPreset,
  type ReportData,
  type ReportSummary,
} from "@/lib/seo/report";
import { loadLogo, renderReportPdf } from "@/lib/seo/report-pdf";

const DAY_MS = 24 * 3600_000;

export type ReportOptions = {
  preset: PeriodPreset;
  lang: UiLang;
  /** Resumen escrito por la IA (unos centavos). Si falla, sale el resumen sin IA. */
  ai: boolean;
  /** Sin "Preparado con Nehora". */
  whiteLabel: boolean;
  now?: Date;
};

export type BuiltReport = { pdf: Buffer; data: ReportData; summary: ReportSummary; fileName: string; ms: number };

/** Lee lo guardado, escribe el resumen (con o sin IA) y dibuja el PDF. */
export async function createReport(businessId: string, opts: ReportOptions): Promise<BuiltReport> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const period = periodFor(opts.preset, now, BUSINESS_TZ);
  const data = await gatherReport(businessId, period, { now });
  const [summary, logo] = await Promise.all([reportSummary(data, opts.lang, { ai: opts.ai }), data.business.logoUrl ? loadLogo(data.business.logoUrl) : Promise.resolve(null)]);
  const pdf = await renderReportPdf(data, { lang: opts.lang, summary, whiteLabel: opts.whiteLabel, logo });
  return { pdf, data, summary, fileName: reportFileName(data.business.name, period, opts.lang), ms: Date.now() - started };
}

/** Arma el reporte y lo manda como PDF adjunto a los emails de los avisos. */
export async function emailReport(businessId: string, opts: ReportOptions): Promise<{ to: string[]; sender: Sender; report: BuiltReport }> {
  const b = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { seoAlertEmail: true } });
  const to = alertRecipients(b.seoAlertEmail);
  if (!to.length)
    throw new SenderConfigError(
      "Primero guarda tu email en «Avisos por email» (más arriba en esta página).",
      "First save your email in \"Email alerts\" (higher up on this page).",
    );
  const report = await createReport(businessId, opts);
  const email = buildReportEmail(report.data, opts.lang, report.summary);
  const sender = await sendSeoEmail({ businessId, to, ...email, attachments: [{ name: report.fileName, content: report.pdf }] });
  return { to, sender, report };
}

const FAIL_MARK = "monthly-fail";
const MAX_RETRIES = 3;

/**
 * Lo llama el cron cada minuto: el día 1 desde las 8:00 manda como mucho UN reporte del mes anterior por llamada.
 * Reserva el negocio con un updateMany (si otra llamada lo reservó antes, no hace nada). Si falla por algo pasajero,
 * deja seoMonthlyAt como estaba para reintentar en el próximo minuto (hasta 3 veces); si es de configuración, no reintenta.
 */
export async function runMonthlyReports(now = new Date()): Promise<{ businessId: string; ok: boolean; error?: string; ms?: number } | null> {
  const monthStart = currentMonthStart(now, BUSINESS_TZ);
  if (!isMonthlyDue(now, null)) return null;
  const candidates = await db.business.findMany({
    where: { seoMonthly: true, seoAlertEmail: { not: "" }, OR: [{ seoMonthlyAt: null }, { seoMonthlyAt: { lt: monthStart } }] },
    select: { id: true, seoAlertEmail: true, seoMonthlyAt: true, seoEmailLang: true },
    orderBy: { seoMonthlyAt: { sort: "asc", nulls: "first" } },
    take: 50,
  });
  const due = candidates.find((b) => alertRecipients(b.seoAlertEmail).length && isMonthlyDue(now, b.seoMonthlyAt));
  if (!due) return null;

  const claimed = await db.business.updateMany({ where: { id: due.id, seoMonthly: true, seoMonthlyAt: due.seoMonthlyAt }, data: { seoMonthlyAt: now } });
  if (claimed.count !== 1) return null;

  try {
    const { report } = await emailReport(due.id, { preset: "mes-pasado", lang: due.seoEmailLang === "en" ? "en" : "es", ai: true, whiteLabel: false, now });
    await db.seoReport.deleteMany({ where: { businessId: due.id, kind: FAIL_MARK } });
    return { businessId: due.id, ok: true, ms: report.ms };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    let retry = !(e instanceof SenderConfigError);
    if (retry) {
      await db.seoReport.create({ data: { businessId: due.id, kind: FAIL_MARK, data: { at: now.toISOString(), error: error.slice(0, 300) } } });
      const fails = await db.seoReport.count({ where: { businessId: due.id, kind: FAIL_MARK, createdAt: { gte: new Date(now.getTime() - DAY_MS) } } });
      retry = fails < MAX_RETRIES;
      await db.seoReport.deleteMany({ where: { businessId: due.id, kind: FAIL_MARK, createdAt: { lt: new Date(now.getTime() - 40 * DAY_MS) } } });
    }
    if (retry) await db.business.updateMany({ where: { id: due.id, seoMonthlyAt: now }, data: { seoMonthlyAt: due.seoMonthlyAt } });
    console.error(`[reporte-mensual] ${due.id}: ${error}${retry ? " (se reintenta en el próximo minuto)" : " (no se reintenta este mes)"}`);
    return { businessId: due.id, ok: false, error };
  }
}
