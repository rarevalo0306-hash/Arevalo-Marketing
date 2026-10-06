import Link from "next/link";
import { runCompetitors, trackGapKeyword } from "@/app/actions-seo-competitors";
import { CompetitorsForm, TrackGapButton } from "@/components/seo/CompetitorsForm";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { distinctCountries, normalizeDomain, readCompetitorsReport, type CompetitorSource, type DomainStats } from "@/lib/seo/competitors";
import { dataForSeoEnabled, readTrackedKeywords, readZones, zoneLabel } from "@/lib/seo/dataforseo";
import { latestReports } from "@/lib/seo/reports";
import { BUSINESS_TZ } from "@/lib/time";

/** Tu competencia en Google: quiénes son, cuánto los visitan y qué búsquedas ganan que tú no. */
export async function CompetitorsPanel({ businessId }: { businessId: string }) {
  if (!dataForSeoEnabled()) return null;
  const { lang, t } = await getT();
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, seoKeywords: true },
  });
  if (!b) return null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const countries = distinctCountries(zones);
  const self = normalizeDomain(b.website);

  const header = (
    <div className="stack" style={{ gap: 4 }}>
      <h2>{t("Tu competencia en Google", "Your competition on Google")}</h2>
      <p className="small muted">
        {t(
          "Quiénes salen en Google cuando tus clientes buscan lo que vendes, cuántas visitas les llegan y por qué búsquedas aparecen ellos y tú no.",
          "Who shows up on Google when your customers search for what you sell, how many visits they get, and which searches they show up for and you don't.",
        )}
      </p>
    </div>
  );

  if (!self || !zones.length) {
    return (
      <section className="card">
        {header}
        <p className="note">
          {!self ? (
            <>
              {t("Para buscar a tu competencia, primero agrega la dirección de tu página en ", "To find your competition, first add your website address in ")}
              <Link href={`/b/${businessId}/negocio`}>{t("Ajustes del negocio", "Business settings")}</Link>.
            </>
          ) : (
            t("Para buscar a tu competencia, primero elige la zona donde buscan tus clientes (arriba, en Datos reales de Google).", "To find your competition, first pick the area where your customers search (above, in Real Google data).")
          )}
        </p>
      </section>
    );
  }

  const [row] = await latestReports(businessId, "competitors", 1);
  const report = row ? readCompetitorsReport(row.data) : null;
  const tracked = new Set(readTrackedKeywords(b.seoKeywords).map((k) => k.toLowerCase()));
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  const number = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 0 });
  const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 3 });
  const n = (v: number | null) => (v === null ? "—" : number.format(v));

  const sourceLabel: Record<CompetitorSource, string> = {
    labs: t("Lo encontró DataForSEO", "Found by DataForSEO"),
    serp: t("Sale arriba en tus búsquedas", "Ranks high on your searches"),
    owner: t("Lo agregaste tú", "You added it"),
  };
  const sourcePill: Record<CompetitorSource, string> = { labs: "scheduled", serp: "partial", owner: "draft" };
  const href = (d: string) => `https://${d}`;
  const idea = (kw: string) => t(`Escribe una publicación para competir por la búsqueda: ${kw}`, `Write a post to compete for the search: ${kw}`);
  const track = trackGapKeyword.bind(null, businessId);

  const all: DomainStats[] = report ? [report.you, ...report.competitors] : [];
  const maxTraffic = Math.max(1, ...all.map((d) => d.traffic ?? 0));

  return (
    <section className="card">
      {header}
      <p className="small muted">
        {t("Tu página:", "Your website:")} <a href={href(self)} target="_blank" rel="noopener noreferrer">{self}</a>
        {row && (
          <>
            {" "}
            · {t("Última búsqueda:", "Last search:")} {fmt.format(row.createdAt)}
            {report && <> · {t("Costo:", "Cost:")} {money.format(report.cost)}</>}
          </>
        )}
      </p>

      {report?.location.local && (
        <p className="note">
          {zones.length > 1
            ? t(
                `Los datos de competencia son de todo ${report.location.countryName} (DataForSEO no los tiene por ciudad). Los que salen arriba en tus búsquedas sí vienen de tus posiciones en cada una de tus ${zones.length} zonas.`,
                `Competitor data covers all of ${report.location.countryName} (DataForSEO doesn't have it by city). The ones ranking high on your searches do come from your rankings in each of your ${zones.length} areas.`,
              )
            : t(
                `Los datos de competencia son de todo ${report.location.countryName} (DataForSEO no los tiene por ciudad). Tus posiciones en Google sí son de ${zoneLabel(report.location.name)}.`,
                `Competitor data covers all of ${report.location.countryName} (DataForSEO doesn't have it by city). Your Google rankings are for ${zoneLabel(report.location.name)}.`,
              )}
        </p>
      )}
      {countries.length > 1 && (
        <p className="small muted">
          {t(
            `Tus zonas están en ${countries.length} países (${countries.join(", ")}). Para no cobrarte dos veces, la competencia del país se busca solo en ${countries[0]}, el de tu zona principal; los competidores de tus búsquedas sí salen de todas tus zonas.`,
            `Your areas are in ${countries.length} countries (${countries.join(", ")}). To avoid paying twice, country-wide competitor data is looked up only for ${countries[0]}, your main area's country; competitors from your searches do come from all your areas.`,
          )}
        </p>
      )}

      <CompetitorsForm action={runCompetitors.bind(null, businessId)} has={Boolean(row)} defaultDomains={report?.ownerDomains ?? []} />

      {!row && (
        <p className="small muted">
          {t(
            "Consejo: revisa primero tus posiciones en Google (arriba). Así encontramos a los que te ganan en tu zona, no solo a los grandes del país.",
            "Tip: check your Google rankings first (above). That way we find the ones beating you in your area, not just the big national sites.",
          )}
        </p>
      )}
      {row && !report && (
        <p className="note">{t("El último reporte tiene un formato viejo y no se puede mostrar. Vuelve a buscar.", "The last report is in an old format and can't be shown. Search again.")}</p>
      )}

      {report && (
        <>
          {report.notes.length > 0 && (
            <ul className="small muted comp-notes">
              {report.notes.map((x, i) => <li key={i}>{lang === "en" ? x.en : x.es}</li>)}
            </ul>
          )}

          {report.competitors.length === 0 ? (
            <p className="note">
              {t(
                "No encontramos competidores con datos en Google. Escribe arriba los sitios de 1 a 3 negocios que compiten contigo y vuelve a buscar.",
                "We didn't find competitors with Google data. Type the websites of 1 to 3 businesses that compete with you above and search again.",
              )}
            </p>
          ) : (
            <>
              <div className="cards">
                {report.competitors.map((c) => (
                  <article key={c.domain} className="comp-card">
                    <div className="row between" style={{ gap: 8 }}>
                      <a className="comp-domain" href={href(c.domain)} target="_blank" rel="noopener noreferrer">{c.domain}</a>
                      <span className={`pill ${sourcePill[c.source]}`}>{sourceLabel[c.source]}</span>
                    </div>
                    <div className="comp-stats">
                      <div>
                        <strong>{n(c.keywords)}</strong>
                        <span className="small muted">{t("búsquedas en Google", "Google searches")}</span>
                      </div>
                      <div>
                        <strong>{n(c.traffic)}</strong>
                        <span className="small muted">{t("visitas al mes (est.)", "visits a month (est.)")}</span>
                      </div>
                    </div>
                    <span className="small muted">
                      {[
                        c.overlap !== null && t(`${n(c.overlap)} búsquedas en común contigo`, `${n(c.overlap)} searches in common with you`),
                        c.serpHits !== null && report.rankKeywords > 0 && t(`top 5 en ${c.serpHits} de tus ${report.rankKeywords} palabras`, `top 5 on ${c.serpHits} of your ${report.rankKeywords} keywords`),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {c.top.length > 0 && (
                      <details>
                        <summary className="btn link" style={{ display: "inline-flex", minHeight: 0, padding: 0 }}>
                          {t("Sus búsquedas principales", "Their top searches")}
                        </summary>
                        <ul className="comp-top">
                          {c.top.slice(0, 8).map((k) => (
                            <li key={k.keyword}>
                              <span>{k.keyword}</span>
                              <span className="muted">
                                #{k.position}
                                {k.volume !== null && ` · ${n(k.volume)}/${t("mes", "mo")}`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </article>
                ))}
              </div>

              <div className="stack" style={{ gap: 8 }}>
                <span className="lbl">{t("Tú contra ellos", "You vs. them")}</span>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Sitio", "Website")}</th>
                        <th className="comp-num">{t("Búsquedas en Google", "Google searches")}</th>
                        <th>{t("Visitas al mes (est.)", "Visits a month (est.)")}</th>
                        <th className="comp-num">{t("En común contigo", "In common with you")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {all.map((d, i) => (
                        <tr key={d.domain} className={i === 0 ? "comp-you" : ""}>
                          <td className="small" style={{ wordBreak: "break-all" }}>
                            {i === 0 ? <strong>{t("Tú", "You")} · {d.domain}</strong> : d.domain}
                          </td>
                          <td className="comp-num">{n(d.keywords)}</td>
                          <td>
                            <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                              <span className="meter comp-meter"><span style={{ width: `${Math.round(((d.traffic ?? 0) / maxTraffic) * 100)}%` }} /></span>
                              <span className="comp-num">{n(d.traffic)}</span>
                            </span>
                          </td>
                          <td className="comp-num">{i === 0 ? "—" : n(d.overlap)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          <div className="stack" style={{ gap: 8 }}>
            <span className="lbl">{t("Búsquedas donde ellos salen y tú no", "Searches where they show up and you don't")}</span>
            {report.gap.length === 0 ? (
              <p className="small muted">
                {report.competitors.some((c) => c.analyzed)
                  ? t("No encontramos búsquedas donde ellos estén en la primera página y tú no. ¡Bien!", "We didn't find searches where they're on page one and you aren't. Nice!")
                  : t("Todavía no hay datos para comparar.", "There's no data to compare yet.")}
              </p>
            ) : (
              <ul className="comp-gap">
                {report.gap.map((g) => (
                  <li key={g.keyword}>
                    <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                      <strong>{g.keyword}</strong>
                      <span className="small muted">
                        {g.volume !== null && <>{t(`${n(g.volume)} búsquedas al mes`, `${n(g.volume)} searches a month`)} · </>}
                        {t(`${g.bestCompetitor} sale #${g.competitorPosition}`, `${g.bestCompetitor} ranks #${g.competitorPosition}`)} ·{" "}
                        {g.yourPosition === null ? t("tú no sales", "you don't show up") : t(`tú sales #${g.yourPosition}`, `you rank #${g.yourPosition}`)}
                      </span>
                    </div>
                    <span className="row" style={{ gap: 6 }}>
                      <TrackGapButton action={track} keyword={g.keyword} tracked={tracked.has(g.keyword.toLowerCase())} />
                      <Link className="btn" href={`/b/${businessId}/publicar?${new URLSearchParams({ idea: idea(g.keyword), magic: "1" })}`}>
                        {t("Crear post", "Create post")}
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="small muted">
            {t(
              `Las búsquedas, visitas y volúmenes son estimados de DataForSEO para ${report.location.countryName || "tu país"} en Google; son aproximados, no datos de Google Analytics ni de Search Console.`,
              `Searches, visits and volumes are DataForSEO estimates for ${report.location.countryName || "your country"} on Google; they're approximations, not Google Analytics or Search Console data.`,
            )}
          </p>
        </>
      )}
    </section>
  );
}
