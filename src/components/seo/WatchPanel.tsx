import Link from "next/link";
import { watchAction } from "@/app/actions-seo-watch";
import { HowToRead } from "@/components/seo/HowToRead";
import { WatchForm } from "@/components/seo/WatchForm";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { alertRecipients } from "@/lib/seo/alerts";
import { readCompetitorsReport, withoutDirectories } from "@/lib/seo/competitors";
import { dataForSeoEnabled, readZones } from "@/lib/seo/dataforseo";
import { costText } from "@/lib/seo/keywords";
import { latestReports } from "@/lib/seo/reports";
import { changeText, readWatchConfig, readWatchReport, WATCH_CONFIG_KIND, WATCH_KIND, WATCH_MAX, watchCostEstimate, watchDomains } from "@/lib/seo/watch";
import { BUSINESS_TZ } from "@/lib/time";

const WEEK = 7 * 86_400_000;

/** «Qué hizo tu competencia»: cada semana (si se enciende) revisa hasta 3 competidores y muestra lo nuevo. */
export async function WatchPanel({ businessId }: { businessId: string }) {
  if (!dataForSeoEnabled()) return null;
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true, seoAlertEmail: true, seoLocations: true, seoLocationCode: true, seoLocationName: true } });
  if (!b) return null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const [[configRow], [compRow], rows] = await Promise.all([latestReports(businessId, WATCH_CONFIG_KIND, 1), latestReports(businessId, "competitors", 1), latestReports(businessId, WATCH_KIND, 5)]);
  const config = readWatchConfig(configRow?.data);
  const comp = compRow ? readCompetitorsReport(compRow.data) : null;
  const defaults = watchDomains(config, comp ? withoutDirectories(comp).report.competitors.map((c) => c.domain) : [], b.website);
  const reports = rows.flatMap((r) => {
    const rep = readWatchReport(r.data);
    return rep ? [{ ...rep, at: r.createdAt }] : [];
  });
  const [latest, ...older] = reports;
  const pastChanges = older.filter((r) => r.competitors.some((c) => c.changes.length));
  const emails = alertRecipients(b.seoAlertEmail);
  const number = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 0 });
  const date = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeZone: BUSINESS_TZ });
  const next = latest ? new Date(Math.max(Date.now(), latest.at.getTime() + WEEK)) : null;

  return (
    <section className="card" id="vigilancia">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{t("Qué hizo tu competencia esta semana", "What your competitors did this week")}</h2>
        <p className="small muted">
          {t(
            "Revisamos a tus competidores y te contamos lo nuevo: búsquedas por las que empezaron a salir en Google, páginas nuevas que les traen visitas, si sus visitas subieron o bajaron y si lanzaron anuncios.",
            "We check your competitors and tell you what's new: searches they started ranking for on Google, new pages bringing them visits, whether their visits went up or down and whether they launched ads.",
          )}
        </p>
      </div>

      {zones.length ? (
        <WatchForm action={watchAction.bind(null, businessId)} defaults={defaults} enabled={config.enabled} price={costText(watchCostEstimate(WATCH_MAX))} />
      ) : (
        <p className="small muted">{t("Primero elige la zona donde buscan tus clientes en la pestaña «⚙ Ajustes».", "First pick the area where your customers search in the “⚙ Settings” tab.")}</p>
      )}

      {config.enabled && (
        <p className="small muted">
          {t("Se revisa sola cada semana", "It checks by itself every week")}
          {next ? t(` · próxima revisión ≈ ${date.format(next)}`, ` · next check ≈ ${date.format(next)}`) : t(" · la primera revisión se hace en unos minutos", " · the first check runs in a few minutes")}
          {" · "}
          {emails.length ? (
            t(`aviso a ${emails.join(", ")}`, `email to ${emails.join(", ")}`)
          ) : (
            <>
              {t("para recibir el aviso por email, agrega tu email en ", "to get the email, add your email in ")}
              <Link href={`/b/${businessId}/seo?tab=reportes#alertas`}>{t("Reportes → Alertas", "Reports → Alerts")}</Link>
            </>
          )}
        </p>
      )}

      {latest && (
        <div className="stack" style={{ gap: 10 }}>
          <span className="small muted">
            {t(`Datos de Google en ${latest.country}`, `Google data for ${latest.country}`)} · {date.format(latest.at)} · {latest.auto ? t("revisión automática", "automatic check") : t("revisada a mano", "checked by hand")} · {t("costó", "cost")} {costText(latest.cost)}
          </span>
          <div className="ads-grid">
            {latest.competitors.map((c) => (
              <article key={c.domain} className="ads-card watch-card">
                <strong>{c.domain}</strong>
                <span className="small muted">
                  {c.traffic !== null ? t(`≈ ${number.format(c.traffic)} visitas de Google al mes`, `≈ ${number.format(c.traffic)} Google visits a month`) : t("visitas: sin datos", "visits: no data")}
                  {c.keywordsCount !== null ? t(` · sale en ${number.format(c.keywordsCount)} búsquedas`, ` · ranks for ${number.format(c.keywordsCount)} searches`) : ""}
                  {c.adsRunning ? t(` · ${c.adsRunning} anuncios activos`, ` · ${c.adsRunning} active ads`) : ""}
                </span>
                {!c.ok ? (
                  <span className="small muted">{t("No se pudo revisar esta vez.", "Couldn't check it this time.")}</span>
                ) : c.first ? (
                  <span className="small muted">{t("Primera revisión: quedó la base. La próxima te muestra lo que cambió.", "First check: baseline saved. The next one shows what changed.")}</span>
                ) : c.changes.length ? (
                  <ul className="watch-changes">
                    {c.changes.map((x, i) => (
                      <li key={i} className={x.kind === "traffic" && x.pct < 0 ? "watch-down" : undefined}>
                        {changeText(x, lang)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="small muted">{t("Nada importante cambió desde la revisión anterior.", "Nothing important changed since the last check.")}</span>
                )}
              </article>
            ))}
          </div>
          {latest.notes.length > 0 && (
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              {latest.notes.map((n, i) => (
                <li key={i}>{lang === "en" ? n.en : n.es}</li>
              ))}
            </ul>
          )}
          {pastChanges.length > 0 && (
            <details className="ads-comp">
              <summary>
                <strong>{t("Semanas anteriores", "Previous weeks")}</strong>
              </summary>
              <div className="stack" style={{ gap: 10, paddingTop: 8 }}>
                {pastChanges.map((r) => (
                  <div key={r.createdAt} className="stack" style={{ gap: 4 }}>
                    <span className="lbl">{date.format(r.at)}</span>
                    <ul className="watch-changes">
                      {r.competitors.flatMap((c) =>
                        c.changes.map((x, i) => (
                          <li key={`${c.domain}-${i}`}>
                            <strong>{c.domain}:</strong> {changeText(x, lang)}
                          </li>
                        )),
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <HowToRead title={t("Qué hacer con lo que hizo tu competencia", "What to do with what your competitors did")}>
        <ul>
          <li>{t("Si empezó a salir en una búsqueda que también es tuya, revisa qué página usa y haz la tuya más completa (o pídele a la IA un artículo en «Escribir con IA»).", "If they started ranking for a search that's yours too, look at the page they use and make yours more complete (or ask the AI for an article in “Write with AI”).")}</li>
          <li>{t("Una página nueva con visitas suele ser un servicio o una oferta nueva: mírala para no quedarte atrás.", "A new page with visits is usually a new service or offer: look at it so you don't fall behind.")}</li>
          <li>{t("Si lanzó anuncios, mira qué dicen en «Anuncios de tu competencia» (arriba) y di algo distinto en los tuyos.", "If they launched ads, see what they say in “Your competitors' ads” (above) and say something different in yours.")}</li>
          <li>{t("Las visitas son un estimado de DataForSEO: sirven para ver si sube o baja, no son exactas.", "Visits are a DataForSEO estimate: use them to see whether they go up or down, they aren't exact.")}</li>
        </ul>
      </HowToRead>
    </section>
  );
}
