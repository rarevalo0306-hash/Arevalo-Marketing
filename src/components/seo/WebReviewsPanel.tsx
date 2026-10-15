import { refreshWebReviews } from "@/app/actions-seo-web-reviews";
import { HowToRead } from "@/components/seo/HowToRead";
import { WebReviewsForm } from "@/components/seo/WebReviewsForm";
import { WebReviewsList } from "@/components/seo/WebReviewsList";
import { aiEnabled } from "@/lib/ai";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled } from "@/lib/seo/dataforseo";
import { costText } from "@/lib/seo/keywords";
import { latestReports } from "@/lib/seo/reports";
import { readWebReviewsReport, WEB_REVIEWS_KIND } from "@/lib/seo/web-reviews";
import { BUSINESS_TZ } from "@/lib/time";

/** «Reseñas en otros sitios»: Yelp, Facebook, Trustpilot, Tripadvisor… con respuestas de la IA para copiar y pegar. */
export async function WebReviewsPanel({ businessId }: { businessId: string }) {
  if (!dataForSeoEnabled()) return null;
  const { lang, t } = await getT();
  const [row] = await latestReports(businessId, WEB_REVIEWS_KIND, 1);
  const report = row ? readWebReviewsReport(row.data) : null;
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  const one = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 1 });
  return (
    <section className="card" id="resenas-web">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{t("Reseñas en otros sitios", "Reviews on other sites")}</h2>
        <p className="small muted">
          {t(
            "Tus reseñas fuera de Google —Yelp, Facebook, Trustpilot, Tripadvisor y otros— en un solo lugar. La IA te escribe la respuesta; tú la copias y la pegas en cada sitio (esos sitios no dejan contestar desde otra app).",
            "Your reviews outside Google —Yelp, Facebook, Trustpilot, Tripadvisor and others— in one place. The AI writes the reply; you copy it and paste it on each site (those sites don't allow replying from another app).",
          )}
        </p>
      </div>
      <WebReviewsForm action={refreshWebReviews.bind(null, businessId)} tripadvisor={report?.tripadvisorPath ? `https://www.tripadvisor.com/${report.tripadvisorPath}` : ""} has={Boolean(report)} />
      {report && row && (
        <>
          <p className="small muted">
            {t("Última vez:", "Last time:")} {fmt.format(row.createdAt)} · {t("costó", "cost")} {costText(report.cost)}
          </p>
          {report.sources.length > 0 && (
            <div className="tags">
              {report.sources.map((s) => {
                const label = `${s.name}${s.rating !== null ? ` · ${one.format(s.rating)}★` : ""} · ${s.total ?? s.count} ${t("reseñas", "reviews")}`;
                return s.url ? (
                  <a key={s.id} className="tag" href={s.url} target="_blank" rel="noopener noreferrer">
                    {label}
                  </a>
                ) : (
                  <span key={s.id} className="tag">
                    {label}
                  </span>
                );
              })}
            </div>
          )}
          {report.reviews.length > 0 ? (
            <WebReviewsList businessId={businessId} reviews={report.reviews} aiReady={aiEnabled()} />
          ) : (
            <p className="small muted">
              {t(
                "No encontramos reseñas tuyas en otros sitios. Si tienes ficha en Yelp o Facebook, pide a tus clientes que te dejen una reseña ahí también.",
                "We didn't find your reviews on other sites. If you have a Yelp or Facebook page, ask your customers to leave a review there too.",
              )}
            </p>
          )}
          {report.notes.length > 0 && (
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              {report.notes.map((n, i) => (
                <li key={i}>{lang === "en" ? n.en : n.es}</li>
              ))}
            </ul>
          )}
        </>
      )}
      <HowToRead title={t("Cómo contestar reseñas en otros sitios", "How to reply to reviews on other sites")}>
        <ul>
          <li>{t("Contesta todas, sobre todo las de 3 estrellas o menos: los clientes leen cómo respondes.", "Reply to all of them, especially 3 stars or fewer: customers read how you respond.")}</li>
          <li>{t("«Copiar y abrir» copia la respuesta y abre la reseña en ese sitio: entra con tu cuenta de negocio, pega y publica.", "“Copy and open” copies the reply and opens the review on that site: log in with your business account, paste and post.")}</li>
          <li>{t("Para contestar en Yelp, Facebook o Trustpilot necesitas haber reclamado tu ficha en ese sitio (mira «Directorios y reseñas»).", "To reply on Yelp, Facebook or Trustpilot you need to have claimed your listing on that site (see “Directories & reviews”).")}</li>
          <li>{t("Yelp y Facebook se ven gracias a Google («Reseñas de la web» de tu perfil): solo salen las que Google muestra.", "Yelp and Facebook show up thanks to Google (your profile's “Reviews from the web”): only the ones Google shows appear.")}</li>
        </ul>
      </HowToRead>
    </section>
  );
}
