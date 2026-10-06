import { saveSeoSettings } from "@/app/actions-seo-dfs";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { dataForSeoBalance, dataForSeoEnabled, readTrackedKeywords } from "@/lib/seo/dataforseo";
import { readStudy, topKeywords } from "@/lib/study-shape";
import { DfsSettingsForm } from "./DfsSettingsForm";

/** Configuración de los datos de Google con DataForSEO: zona, idioma, palabras clave que se siguen y saldo. */
export async function DfsSettingsPanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  if (!dataForSeoEnabled()) {
    return (
      <section className="card">
        <h2>{t("Datos reales de Google (DataForSEO)", "Real Google data (DataForSEO)")}</h2>
        <p className="small muted">
          {t(
            "Con una cuenta de DataForSEO verás cuánta gente busca cada palabra clave, en qué lugar sales en Google cada día y qué hacen tus competidores. Agrega DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel.",
            "With a DataForSEO account you'll see how many people search each keyword, where you rank on Google every day, and what your competitors do. Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel.",
          )}
        </p>
      </section>
    );
  }
  const b = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { seoLocationCode: true, seoLocationName: true, seoLanguage: true, seoKeywords: true, seoDaily: true, study: true, studyInput: true },
  });
  const tracked = readTrackedKeywords(b.seoKeywords);
  const study = readStudy(b.study);
  const suggested = study ? topKeywords(study, 15) : [];
  const balance = await dataForSeoBalance();
  const money = new Intl.NumberFormat(lang === "en" ? "en-US" : "es", { style: "currency", currency: "USD" });
  return (
    <section className="card">
      <div className="row between">
        <div className="stack" style={{ gap: 4 }}>
          <h2>{t("Datos reales de Google (DataForSEO)", "Real Google data (DataForSEO)")}</h2>
          <p className="small muted">
            {t(
              "Elige la zona donde buscan tus clientes y las palabras clave que quieres seguir. Con esto salen las búsquedas reales, tu posición en Google y tus competidores.",
              "Pick the area where your customers search and the keywords you want to track. This powers real search volumes, your Google rankings and your competitors.",
            )}
          </p>
        </div>
        {balance !== null && (
          <span className="pill done" title={t("Saldo de tu cuenta de DataForSEO", "Your DataForSEO account balance")}>
            {t("Saldo", "Balance")}: {money.format(balance)}
          </span>
        )}
      </div>
      <DfsSettingsForm
        action={saveSeoSettings.bind(null, businessId)}
        initial={{
          locationCode: b.seoLocationCode,
          locationName: b.seoLocationName,
          language: b.seoLanguage === "en" ? "en" : "es",
          keywords: tracked.length ? tracked : suggested,
          daily: b.seoDaily,
        }}
        suggested={suggested}
        fromStudy={!tracked.length && suggested.length > 0}
      />
    </section>
  );
}
