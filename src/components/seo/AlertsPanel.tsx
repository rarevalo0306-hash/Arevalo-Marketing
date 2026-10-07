import { saveSeoAlerts, sendSeoTestEmail } from "@/app/actions-seo-alerts";
import { db } from "@/lib/db";
import { errorText, intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { resolveSender, senderLabel } from "@/lib/seo/alerts";
import { dataForSeoEnabled } from "@/lib/seo/dataforseo";
import { BUSINESS_TZ } from "@/lib/time";
import { AlertsForm } from "./AlertsForm";

/** Avisos de SEO por email: a quién, aviso si baja en Google, resumen de cada lunes y email de prueba. */
export async function AlertsPanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const b = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { seoAlertEmail: true, seoAlerts: true, seoWeekly: true, seoWeeklyAt: true, seoDaily: true, seoRankDays: true },
  });
  let sender: { ok: true; from: string } | { ok: false; error: string };
  try {
    sender = { ok: true, from: senderLabel(await resolveSender(businessId)) };
  } catch (e) {
    sender = { ok: false, error: errorText(e, lang) };
  }
  const lastWeekly = b.seoWeeklyAt
    ? new Intl.DateTimeFormat(intlLocale(lang), { timeZone: BUSINESS_TZ, dateStyle: "long", timeStyle: "short" }).format(b.seoWeeklyAt)
    : null;
  return (
    <section className="card" id="alertas">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{t("Avisos por email", "Email alerts")}</h2>
        <p className="small muted">
          {t(
            "Te escribimos si bajas en Google y cada lunes te mandamos un resumen de cómo te fue: posiciones, competidores, IAs, tu página y recomendaciones.",
            "We'll email you if you drop on Google, and every Monday we'll send a summary of how you did: rankings, competitors, AI assistants, your website and recommendations.",
          )}
        </p>
      </div>
      <AlertsForm
        save={saveSeoAlerts.bind(null, businessId)}
        test={sendSeoTestEmail.bind(null, businessId)}
        initial={{ email: b.seoAlertEmail, alerts: b.seoAlerts, weekly: b.seoWeekly }}
        daily={b.seoDaily && dataForSeoEnabled()}
        rankDays={[1, 7, 15, 30].includes(b.seoRankDays) ? b.seoRankDays : 7}
        sender={sender}
        lastWeekly={lastWeekly}
      />
    </section>
  );
}
