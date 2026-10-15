import Link from "next/link";
import { researchAds } from "@/app/actions-seo-ads";
import { AdsForm } from "@/components/seo/AdsForm";
import { HowToRead } from "@/components/seo/HowToRead";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { ADS_KIND, ADS_MAX_COMPETITORS, adsCostEstimate, advertisersFrom, hasSavedAds, pickAdCompetitors, readAdsReport, transparencyUrl } from "@/lib/seo/ads-research";
import { readCompetitorsReport, withoutDirectories } from "@/lib/seo/competitors";
import { dataForSeoEnabled, readZones } from "@/lib/seo/dataforseo";
import { costText } from "@/lib/seo/keywords";
import { readRankReport } from "@/lib/seo/rank";
import { latestReports } from "@/lib/seo/reports";
import { groupByZone } from "@/lib/seo/zones";
import { BUSINESS_TZ } from "@/lib/time";

/** «Anuncios de tu competencia»: quién paga anuncios en tus búsquedas, con qué texto y en qué búsquedas. */
export async function AdsPanel({ businessId }: { businessId: string }) {
  if (!dataForSeoEnabled()) return null;
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true } });
  if (!b) return null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const [[saved], [compRow], rankRows] = await Promise.all([latestReports(businessId, ADS_KIND, 1), latestReports(businessId, "competitors", 1), latestReports(businessId, "rank", 2 * Math.max(1, zones.length))]);
  const report = saved ? readAdsReport(saved.data) : null;
  const comp = compRow ? readCompetitorsReport(compRow.data) : null;
  // Los anuncios de la última revisión de cada zona.
  const latest = [...groupByZone(rankRows.map((r) => readRankReport(r.data)), zones).values()].flatMap((list) => (list[0] ? [list[0]] : []));
  const advertisers = advertisersFrom(latest, b.website);
  const savedAds = hasSavedAds(latest);
  const defaults = report?.competitors.map((c) => c.domain) ?? pickAdCompetitors({ competitors: comp ? withoutDirectories(comp).report.competitors.map((c) => c.domain) : [], advertisers, self: b.website });
  const number = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 0 });
  const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  const money0 = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const date = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeZone: BUSINESS_TZ });
  const FORMAT: Record<string, [string, string]> = { text: ["Anuncio de texto", "Text ad"], image: ["Anuncio con imagen", "Image ad"], video: ["Anuncio en video", "Video ad"] };

  return (
    <section className="card" id="anuncios-competencia">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{t("Anuncios de tu competencia", "Your competitors' ads")}</h2>
        <p className="small muted">
          {t(
            "Quién paga anuncios en Google cuando buscan lo que vendes, por qué búsquedas paga, qué dice su anuncio y cuánto gastaría. Úsalo para tu propio plan de Google Ads.",
            "Who pays for Google ads when people search for what you sell, which searches they pay for, what their ad says and how much they'd spend. Use it for your own Google Ads plan.",
          )}
        </p>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <span className="lbl">{t("Anuncios que salieron en tus búsquedas (gratis)", "Ads that showed on your searches (free)")}</span>
        {advertisers.length ? (
          <div className="ads-grid">
            {advertisers.slice(0, 6).map((a) => (
              <article key={a.domain} className="ads-card">
                <strong>{a.domain}</strong>
                <span className="small muted">
                  {t(`Anuncia en ${a.keywords.length} de tus búsquedas: `, `Advertises on ${a.keywords.length} of your searches: `)}
                  {a.keywords.slice(0, 3).join(", ")}
                  {a.keywords.length > 3 ? "…" : ""}
                </span>
                {a.ads.slice(0, 2).map((ad) => (
                  <div key={`${ad.title}-${ad.keyword}`} className="ads-copy">
                    <span className="ads-label">{t("Patrocinado", "Sponsored")}</span>
                    <span className="ads-title">{ad.title || a.domain}</span>
                    {ad.description && <span className="small">{ad.description}</span>}
                    <span className="small muted">«{ad.keyword}»</span>
                  </div>
                ))}
              </article>
            ))}
          </div>
        ) : (
          <p className="small muted">
            {savedAds
              ? t("Nadie pagó anuncios en tus búsquedas en la última revisión.", "Nobody paid for ads on your searches in the last check.")
              : t(
                  "Desde ahora, cada revisión de posiciones guarda los anuncios que salen en tus búsquedas. Aparecerán aquí después de la próxima revisión.",
                  "From now on, every rankings check saves the ads that show on your searches. They'll appear here after the next check.",
                )}
          </p>
        )}
      </div>

      {zones.length > 0 && <AdsForm action={researchAds.bind(null, businessId)} defaults={defaults} price={costText(adsCostEstimate(ADS_MAX_COMPETITORS))} has={Boolean(report)} />}

      {report && saved && (
        <div className="stack" style={{ gap: 12 }}>
          <span className="small muted">
            {t(`Datos de Google en ${report.country}`, `Google data for ${report.country}`)} · {date.format(saved.createdAt)} · {t("costó", "cost")} {costText(report.cost)}
          </span>
          {report.competitors.map((c) => (
            <details key={c.domain} className="ads-comp" open={report.competitors.length === 1}>
              <summary>
                <strong>{c.domain}</strong>
                <span className="small muted">
                  {c.paidKeywords ? t(` · paga en ${number.format(c.paidKeywords)} búsquedas`, ` · pays on ${number.format(c.paidKeywords)} searches`) : t(" · no vimos búsquedas pagadas", " · no paid searches seen")}
                  {c.paidCost ? t(` · gastaría ≈ ${money0.format(c.paidCost)} al mes`, ` · would spend ≈ ${money0.format(c.paidCost)} a month`) : ""}
                  {c.transparency?.recent ? t(` · ${c.transparency.recent} anuncios en los últimos 30 días`, ` · ${c.transparency.recent} ads in the last 30 days`) : ""}
                </span>
              </summary>
              <div className="stack" style={{ gap: 10, paddingTop: 8 }}>
                {c.keywords.length > 0 && (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("Búsqueda que paga", "Search it pays for")}</th>
                          <th className="kw-num">{t("Búsquedas al mes", "Monthly searches")}</th>
                          <th className="kw-num">CPC</th>
                          <th>{t("Su anuncio", "Their ad")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.keywords.map((k) => (
                          <tr key={k.keyword}>
                            <td>
                              <strong>{k.keyword}</strong>
                            </td>
                            <td className="kw-num">{k.volume !== null ? number.format(k.volume) : "—"}</td>
                            <td className="kw-num">{k.cpc !== null ? money.format(k.cpc) : "—"}</td>
                            <td className="small">
                              {k.title && <strong>{k.title}</strong>}
                              {k.description && <div className="muted">{k.description}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {c.transparency && c.transparency.ads.length > 0 && (
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">{t("Sus anuncios en el Centro de Transparencia de Google", "Their ads in Google's Ads Transparency Center")}</span>
                    <div className="ads-previews">
                      {c.transparency.ads.map((a, i) => (
                        <a key={`${a.url}-${i}`} href={a.url || transparencyUrl(c.domain)} target="_blank" rel="noopener noreferrer" className="ads-preview">
                          {a.preview ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={a.preview} alt={t(`Anuncio de ${c.domain}`, `Ad by ${c.domain}`)} loading="lazy" referrerPolicy="no-referrer" />
                          ) : (
                            <span className="small">{t(...(FORMAT[a.format] ?? ["Anuncio", "Ad"]))}</span>
                          )}
                          {a.lastShown && <span className="small muted">{t(`visto el ${date.format(new Date(a.lastShown))}`, `seen ${date.format(new Date(a.lastShown))}`)}</span>}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                <a href={transparencyUrl(c.domain)} target="_blank" rel="noopener noreferrer" className="small">
                  {t("Ver todos sus anuncios en Google →", "See all their ads on Google →")}
                </a>
              </div>
            </details>
          ))}
          {report.notes.length > 0 && (
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              {report.notes.map((n, i) => (
                <li key={i}>{lang === "en" ? n.en : n.es}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <HowToRead title={t("Cómo usar los anuncios de tu competencia", "How to use your competitors' ads")}>
        <ul>
          <li>{t("Si un competidor paga mucho por una búsqueda, esa búsqueda le trae clientes: vale la pena que tú salgas gratis con una buena página o un artículo.", "If a competitor pays a lot for a search, it brings them customers: it's worth showing up for free with a good page or article.")}</li>
          <li>{t("Mira qué prometen en sus anuncios y di algo distinto en los tuyos (tu experiencia, tu zona, tu garantía real).", "See what their ads promise and say something different in yours (your experience, your area, your real guarantee).")}</li>
          <li>
            {t("Arma tu propia campaña con el ", "Build your own campaign with the ")}
            <Link href={`/b/${businessId}/anuncios`}>{t("plan de Google Ads", "Google Ads plan")}</Link>.
          </li>
          <li>{t("El gasto es un estimado de DataForSEO para todo el país: sirve para comparar, no es lo que pagan de verdad.", "The spend is a DataForSEO estimate for the whole country: use it to compare, it's not what they really pay.")}</li>
        </ul>
      </HowToRead>
    </section>
  );
}
