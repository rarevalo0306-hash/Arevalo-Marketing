import { emailReport, saveMonthlyReport } from "@/app/actions-seo-report";
import { aiEnabled } from "@/lib/ai";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { alertRecipients } from "@/lib/seo/alerts";
import { BUSINESS_TZ } from "@/lib/time";
import { ReportForm } from "./ReportForm";

/** Reporte en PDF: descargarlo, mandarlo por email o recibirlo solo el día 1 de cada mes. */
export async function ReportCard({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const b = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { seoAlertEmail: true, seoMonthly: true, seoMonthlyAt: true } });
  const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intlLocale(lang), { timeZone: BUSINESS_TZ, ...opts });
  const lastMonthly = b.seoMonthlyAt ? fmt({ dateStyle: "long", timeStyle: "short" }).format(b.seoMonthlyAt) : null;
  // Los primeros días del mes lo útil es el mes que acaba de terminar.
  const dayOfMonth = Number(fmt({ day: "numeric" }).format(new Date()));
  return (
    <section className="card" id="reporte">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{t("Reporte en PDF", "PDF report")}</h2>
        <p className="small muted">
          {t(
            "Un reporte con tu logo y tus colores para guardar cada mes o mandarle a un cliente: posiciones en Google, mapa de calor, reseñas, IAs, tu sitio, oportunidades y lo que publicaste. Solo usa lo que ya revisaste (no gasta DataForSEO).",
            "A report with your logo and colors to keep every month or send to a client: Google rankings, heatmap, reviews, AI assistants, your website, opportunities and what you posted. It only uses what you've already checked (no DataForSEO cost).",
          )}
        </p>
      </div>
      <ReportForm
        businessId={businessId}
        send={emailReport.bind(null, businessId)}
        saveMonthly={saveMonthlyReport.bind(null, businessId)}
        recipients={alertRecipients(b.seoAlertEmail)}
        monthly={b.seoMonthly}
        lastMonthly={lastMonthly}
        aiReady={aiEnabled()}
        defaultPeriod={dayOfMonth <= 10 ? "mes-pasado" : "este-mes"}
        defaultLang={lang}
      />
    </section>
  );
}
