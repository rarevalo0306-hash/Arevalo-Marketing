import { emailRangeReport, saveDailySettings, sendYesterdayNow } from "@/app/actions-reports";
import { PageHead } from "@/components/PageHead";
import { DailyHistory } from "@/components/reports/DailyHistory";
import { DailySettings } from "@/components/reports/DailySettings";
import { RangePicker } from "@/components/reports/RangePicker";
import { ReportActions } from "@/components/reports/ReportActions";
import { ReportView } from "@/components/reports/ReportView";
import { appTz, businessTz, COMMON_TZS, localDay, suggestTz, tzName } from "@/lib/business-tz";
import { buildReportFor, dailyHistory, dailyRecipients, getReportSettings, savedHighlights } from "@/lib/daily-report";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { businessPlace } from "@/lib/media-formats";
import { isSingleDay, parseRange, periodText, presetPeriod, rangeQuery } from "@/lib/report-period";
import { reportSections, ruleHighlights } from "@/lib/report-period-view";
import { resolveSender, senderLabel } from "@/lib/seo/alerts";
import { fmtTime } from "@/lib/time";

export const dynamic = "force-dynamic";
// «Mandar el de ayer ahora» y «Enviarme este reporte» escriben con la IA y mandan el email en el momento.
export const maxDuration = 60;

export default async function ReportesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ desde?: string; hasta?: string; p?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const { lang, t } = await getT();
  const b = await db.business.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      name: true,
      color: true,
      timezone: true,
      reportDaily: true,
      reportEmail: true,
      ownerEmail: true,
      seoEmailLang: true,
      study: true,
      studyInput: true,
      seoMapPlace: true,
      seoLocations: true,
      seoLocationName: true,
    },
  });
  const tz = businessTz(b);
  const now = new Date();
  const period = parseRange(q, tz, now);
  const base = `/b/${id}/reportes`;

  const [built, history, settings, cached, sender] = await Promise.all([
    buildReportFor(id, period, now),
    dailyHistory(id, 30, now),
    getReportSettings(id),
    isSingleDay(period) ? savedHighlights(id, period.fromDay) : Promise.resolve(null),
    resolveSender(id).then(
      (x) => ({ ok: true as const, from: senderLabel(x) }),
      (e) => ({ ok: false as const, error: errorText(e, lang) }),
    ),
  ]);
  const report = built.report;
  const sections = reportSections(report, lang);
  // Si el email de ese día ya tiene las frases de la IA, se muestran las mismas (y del idioma del email).
  const sameLang = (b.seoEmailLang === "en" ? "en" : "es") === lang;
  const highlights = cached && sameLang ? cached : { items: ruleHighlights(report, lang), source: "rules" as const };
  const recipients = dailyRecipients(b);

  const place = businessPlace(b);
  const suggested = suggestTz(place);
  const placeText = [place.city, place.state, place.country].filter(Boolean).join(", ");
  const nowIn = Object.fromEntries([...new Set([...COMMON_TZS.map((z) => z.id), tz, appTz()])].map((z) => [z, fmtTime(now, lang, z)]));

  const presets = (["ayer", "7-dias", "este-mes", "mes-pasado"] as const).map((p) => {
    const x = presetPeriod(p, tz, now);
    const label = { ayer: t("Ayer", "Yesterday"), "7-dias": t("Últimos 7 días", "Last 7 days"), "este-mes": t("Este mes", "This month"), "mes-pasado": t("Mes pasado", "Last month") }[p];
    return { id: p, label, href: `${base}?${rangeQuery(x)}` };
  });
  const title = isSingleDay(period) ? t("Lo más importante del día", "The most important that day") : t("Lo más importante", "The most important");

  return (
    <>
      <PageHead
        business={b}
        prefix={t("Reportes de", "Reports for")}
        section={t("Reportes", "Reports")}
        title={t("Reportes", "Reports")}
        subtitle={t(
          `Lo que pasó en tu negocio: cada día te llega por email después de la medianoche, y aquí puedes ver (o bajar en PDF) cualquier rango de fechas. Las horas están en la zona del negocio: ${tzName(tz, "es")}.`,
          `What happened in your business: every day it reaches your email after midnight, and here you can see (or download as PDF) any date range. Times are in the business time zone: ${tzName(tz, "en")}.`,
        )}
      />

      <section className="card" aria-label={t("Fechas del reporte", "Report dates")}>
        <RangePicker
          base={base}
          preset={period.preset}
          fromDay={period.fromDay}
          toDay={period.toDay}
          maxDay={localDay(now, tz)}
          presets={presets}
          labels={{ custom: t("Personalizado", "Custom"), from: t("Desde", "From"), to: t("Hasta", "To"), see: t("Ver reporte", "See report"), aria: t("Atajos de fechas", "Date shortcuts") }}
        />
        <p className="small muted" style={{ margin: 0 }}>
          {t("Viendo:", "Showing:")} <strong>{periodText(period, lang, "long")}</strong>
          {period.preset === "este-mes" ? t(" (hasta ahora)", " (so far)") : ""}
        </p>
        <ReportActions
          pdfHref={`${base}/pdf?${rangeQuery(period)}&lang=${lang}`}
          fromDay={period.fromDay}
          toDay={period.toDay}
          sendEmail={emailRangeReport.bind(null, id)}
          recipients={recipients.join(", ")}
        />
      </section>

      <ReportView title={title} highlights={highlights.items} source={highlights.source} sections={sections} lang={lang} />

      <div className="grid-2">
        <section className="card" aria-labelledby="rep-history">
          <h2 id="rep-history">{t("Reportes enviados", "Reports sent")}</h2>
          <DailyHistory items={history} base={base} lang={lang} tz={tz} />
        </section>
        <section className="card" id="ajustes" aria-labelledby="rep-settings">
          <h2 id="rep-settings">{t("Ajustes del reporte", "Report settings")}</h2>
          <DailySettings
            save={saveDailySettings.bind(null, id)}
            test={sendYesterdayNow.bind(null, id)}
            initial={{ daily: b.reportDaily, email: b.reportEmail, timezone: b.timezone, quietDays: settings.quietDays, lang: b.seoEmailLang === "en" ? "en" : "es" }}
            ownerEmail={b.ownerEmail}
            appTz={appTz()}
            suggestion={suggested ? { tz: suggested, place: placeText || t("tu zona", "your area") } : null}
            nowIn={nowIn}
            sender={sender}
          />
        </section>
      </div>
    </>
  );
}
