import { runTraffic } from "@/app/actions-seo-traffic";
import { capClass } from "@/components/seo/Fold";
import { HowToRead } from "@/components/seo/HowToRead";
import { ShowMore } from "@/components/seo/ShowMore";
import help from "@/components/seo/SeoHelp.module.css";
import { TrafficButton } from "@/components/seo/TrafficButton";
import { type ChartSeries, TrafficChart } from "@/components/seo/TrafficChart";
import styles from "@/components/seo/TrafficPanel.module.css";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { normalizeDomain, readCompetitorsReport } from "@/lib/seo/competitors";
import { dataForSeoEnabled, readZones } from "@/lib/seo/dataforseo";
import {
  hasData,
  latestMonth,
  pickTrafficCompetitors,
  readTrafficReport,
  TRAFFIC_KIND,
  trafficCostEstimate,
  trafficDelta,
  trafficSummary,
  trafficTimeline,
  visitsText,
  type TrafficDomain,
} from "@/lib/seo/traffic";
import { BUSINESS_TZ } from "@/lib/time";
import { latestReports } from "@/lib/seo/reports";

/** Cuántas páginas de cada competidor se ven antes de «Ver todas». */
const PAGES_SHOWN = 5;

/** Visitas de tu competencia e historial (estilo Traffic Analytics de Semrush): hoy, sus mejores páginas y 12 meses. */
export async function TrafficPanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const header = (
    <div className="stack" style={{ gap: 4 }}>
      <h2>{t("Visitas de tu competencia", "Your competitors' traffic")}</h2>
      <p className="small muted">
        {t(
          "Cuántas visitas les llegan desde Google a tu página y a la de tu competencia, cómo cambió en el último año y qué páginas les traen más clientes.",
          "How many visits Google sends to your website and your competitors', how that changed over the last year, and which pages bring them the most customers.",
        )}
      </p>
    </div>
  );
  const empty = (body: React.ReactNode) => (
    <section className={`card ${styles.root}`} id="trafico">
      {header}
      <p className="note">{body}</p>
    </section>
  );

  if (!dataForSeoEnabled())
    return empty(t("Para ver las visitas de tu competencia, primero conecta DataForSEO (en la pestaña «⚙ Ajustes»).", "To see your competitors' traffic, first connect DataForSEO (in the “⚙ Settings” tab)."));

  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true },
  });
  if (!b) return null;
  const self = normalizeDomain(b.website);
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  if (!self)
    return empty(
      <>
        {t("Para comparar tus visitas con las de tu competencia, primero agrega la dirección de tu página en ", "To compare your visits with your competitors', first add your website address in ")}
        <a href={`/b/${businessId}/negocio`}>{t("Ajustes del negocio", "Business settings")}</a>.
      </>,
    );
  if (!zones.length)
    return empty(t("Primero elige la zona donde buscan tus clientes (en la pestaña «⚙ Ajustes»).", "First pick the area where your customers search (in the “⚙ Settings” tab)."));

  const [[compRow], rows] = await Promise.all([
    latestReports(businessId, "competitors", 1),
    db.seoReport.findMany({ where: { businessId, kind: TRAFFIC_KIND }, orderBy: { createdAt: "desc" }, take: 1 }),
  ]);
  const row = rows[0] ?? null;
  const competitors = pickTrafficCompetitors(compRow ? readCompetitorsReport(compRow.data) : null, self).map((c) => c.domain);
  const report = row ? readTrafficReport(row.data) : null;

  const locale = intlLocale(lang);
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 3 });
  const dollars = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const n = (v: number | null) => (v === null ? "—" : number.format(v));
  const visits = (v: number | null) => visitsText(v, lang);
  const monthName = (m: string, long = false) => {
    const [y, mo] = m.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { month: long ? "long" : "short", year: long ? "numeric" : "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(y, mo - 1, 15)));
  };
  const write = (kw: string) => `/b/${businessId}/seo/escribir?kw=${encodeURIComponent(kw)}`;

  const rivalsInReport = report ? report.domains.filter((d) => !d.isYou).map((d) => d.domain) : [];
  const changed = report && competitors.length > 0 && (rivalsInReport.length !== competitors.length || competitors.some((c) => !rivalsInReport.includes(c)));
  // El color sigue al sitio: tú primero, luego los competidores en el orden del reporte.
  const slotOf = (d: TrafficDomain) => (report ? Math.min(3, report.domains.indexOf(d)) : 0);
  const end = report ? latestMonth(report.domains) : null;
  const timeline = report ? trafficTimeline(report.domains) : { months: [], series: [] };
  const label = (d: { domain: string; isYou: boolean }) => (d.isYou ? `${t("Tú", "You")} (${d.domain})` : d.domain);
  const series: ChartSeries[] = report
    ? timeline.series.map((s) => {
        const d = report.domains.find((x) => x.domain === s.domain) as TrafficDomain;
        return { domain: s.domain, label: label(d), slot: slotOf(d), values: s.values };
      })
    : [];
  const summary = report ? trafficSummary(report) : [];
  const country = report?.country || t("tu país", "your country");

  const change = (d: TrafficDomain, months: number, text: string) => {
    const delta = trafficDelta(d, months, end);
    if (!delta) return null;
    const dir = Math.round(delta.to) > Math.round(delta.from) ? styles.up : Math.round(delta.to) < Math.round(delta.from) ? styles.down : undefined;
    const arrow = dir === styles.up ? "↑" : dir === styles.down ? "↓" : "=";
    return (
      <span>
        {text}: {visits(delta.from)} → <span className={dir}>{visits(delta.to)} {arrow}</span>
      </span>
    );
  };

  return (
    <section className={`card ${styles.root}`} id="trafico">
      {header}
      <p className="small muted">
        {t("Tu página:", "Your website:")} <strong>{self}</strong>
        {competitors.length > 0 && (
          <>
            {" · "}
            {t("Competencia:", "Competitors:")} {competitors.join(", ")}
          </>
        )}
        {report?.country && <> · {t("País:", "Country:")} {report.country}</>}
        {row && (
          <>
            {" · "}
            {t("Última revisión:", "Last check:")} {fmt.format(row.createdAt)}
            {report && <> · {t("Costo:", "Cost:")} {money.format(report.cost)}</>}
          </>
        )}
      </p>

      {!competitors.length && (
        <p className="note">
          {compRow
            ? t("Tu última búsqueda de competencia no encontró competidores directos. ", "Your last competitor search found no direct competitors. ")
            : t("Todavía no has buscado a tu competencia. ", "You haven't looked up your competition yet. ")}
          <a href="#competencia">{t("Busca tu competencia primero", "Find your competition first")}</a>
          {t(" para compararte con ellos. Mientras tanto, puedes revisar solo las visitas de tu página.", " to compare yourself with them. Meanwhile, you can check just your own website's visits.")}
        </p>
      )}
      {changed && (
        <p className="note">
          {t(
            `Tu lista de competidores cambió (ahora: ${competitors.join(", ")}). Presiona «Actualizar visitas» para compararte con ellos.`,
            `Your competitor list changed (now: ${competitors.join(", ")}). Press “Update visits” to compare yourself with them.`,
          )}
        </p>
      )}

      <TrafficButton action={runTraffic.bind(null, businessId)} has={Boolean(row)} competitors={competitors.length} estimate={trafficCostEstimate(competitors.length)} />

      {!row && (
        <p className="small muted">
          {t(
            "Todavía no has revisado las visitas. Presiona el botón: buscamos cuántas visitas les llegan desde Google a tu página y a la de tu competencia, y cómo cambió en el último año.",
            "You haven't checked the visits yet. Press the button: we look up how many visits Google sends to your website and your competitors', and how that changed over the last year.",
          )}
        </p>
      )}
      {row && !report && <p className="note">{t("El último reporte tiene un formato viejo y no se puede mostrar. Presiona Actualizar.", "The last report is in an old format and can't be shown. Press Update.")}</p>}

      {report && (
        <>
          {report.notes.length > 0 && (
            <ul className="small muted comp-notes">
              {report.notes.map((x, i) => <li key={i}>{lang === "en" ? x.en : x.es}</li>)}
            </ul>
          )}

          {summary.length > 0 && (
            <ul className={help.lines}>
              {summary.map((s, i) => (
                <li key={i} className={`${help.line} ${help.info}`}>
                  <span className={help.icon} aria-hidden>
                    {i === 0 ? "👥" : "📈"}
                  </span>
                  <span className={help.text}>{lang === "en" ? s.en : s.es}</span>
                </li>
              ))}
            </ul>
          )}

          <h3>{t("Hoy", "Today")}{end && <span className="small muted"> · {monthName(end, true)}</span>}</h3>
          <div className={styles.tiles}>
            {report.domains.map((d) => (
              <div key={d.domain} className={`${styles.tile} ${d.isYou ? styles.you : ""}`} data-slot={slotOf(d)}>
                <div className={styles.tileHead}>
                  <a className={styles.domain} href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer">
                    {d.domain}
                  </a>
                  {d.isYou && <span className="pill scheduled">{t("Tú", "You")}</span>}
                </div>
                {d.failed ? (
                  <p className="small muted">{t("No se pudo leer esta vez. Vuelve a intentar más tarde.", "Couldn't read it this time. Try again later.")}</p>
                ) : !hasData(d) ? (
                  <>
                    <div className={styles.big}>{t("Sin datos", "No data")}</div>
                    <p className="small muted">
                      {t(
                        "DataForSEO todavía no mide esta página: es muy nueva o casi no sale en Google. No es un error.",
                        "DataForSEO doesn't measure this website yet: it's very new or barely shows up on Google. It's not an error.",
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    <div className={styles.big}>
                      {visits(d.now?.etv ?? 0)} <small>{t("visitas al mes", "visits a month")}</small>
                    </div>
                    <ul className={styles.facts}>
                      <li>
                        {t("Sale en", "Shows up for")} <strong>{n(d.now?.keywords ?? null)}</strong> {t("búsquedas de Google", "Google searches")}
                      </li>
                      <li>
                        <strong>{n(d.now?.top3 ?? null)}</strong> {t("en los 3 primeros", "in the top 3")} · <strong>{n(d.now?.top10 ?? null)}</strong> {t("en la primera página", "on page one")}
                      </li>
                      {d.now?.value != null && d.now.value >= 1 && (
                        <li>
                          {t("Valen", "Worth")} <strong>{dollars.format(d.now.value)}</strong> {t("al mes en anuncios", "a month in ads")}
                        </li>
                      )}
                    </ul>
                    <div className={`${styles.change} stack`} style={{ gap: 2 }}>
                      {change(d, 6, t("Hace 6 meses", "6 months ago"))}
                      {change(d, 12, t("Hace 1 año", "1 year ago"))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {series.length > 0 && timeline.months.length > 1 && (
            <div className="stack" style={{ gap: 10 }}>
              <h3>{t("Historial: visitas al mes en el último año", "History: visits a month over the last year")}</h3>
              <TrafficChart
                months={timeline.months.map((m) => monthName(m))}
                series={series}
                format={visits}
                unit={t("visitas/mes", "visits/mo")}
                title={t("Visitas al mes desde Google en los últimos 12 meses", "Monthly visits from Google over the last 12 months")}
              />
              <details>
                <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>
                  {t("Ver los números mes por mes", "See the numbers month by month")}
                </summary>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Mes", "Month")}</th>
                        {series.map((s) => <th key={s.domain}>{s.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {[...timeline.months].reverse().map((m) => {
                        const i = timeline.months.indexOf(m);
                        return (
                          <tr key={m}>
                            <td>{monthName(m, true)}</td>
                            {series.map((s) => <td key={s.domain}>{s.values[i] === null ? "—" : visits(s.values[i])}</td>)}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          )}

          {report.domains.some((d) => !d.isYou) && (
            <div className="stack" style={{ gap: 10 }}>
              <h3>{t("Sus mejores páginas", "Their best pages")}</h3>
              <p className="small muted">
                {t(
                  "Estas son las páginas que más clientes les traen: si no tienes una página parecida, créala.",
                  "These are the pages that bring them the most customers: if you don't have a similar page, create one.",
                )}
              </p>
              {report.domains
                .filter((d) => !d.isYou)
                .map((d, i) => (
                  <details key={d.domain} className={styles.compPages} open={i === 0 && d.pages.length > 0}>
                    <summary>
                      <span className={styles.swatch} data-slot={slotOf(d)} aria-hidden />
                      {d.domain}
                      <span className="small muted">
                        {d.pages.length ? t(`${d.pages.length} páginas`, `${d.pages.length} pages`) : t("sin datos", "no data")}
                      </span>
                    </summary>
                    {d.pages.length ? (
                      <ShowMore hidden={d.pages.length - PAGES_SHOWN} more={t(`Ver sus ${d.pages.length} páginas`, `See all ${d.pages.length} pages`)}>
                      <ol className={styles.pages}>
                        {d.pages.map((p, j) => {
                          const kw = p.topKeyword ?? p.topic;
                          return (
                            <li key={p.url} className={[styles.page, capClass(j, PAGES_SHOWN)].filter(Boolean).join(" ")}>
                              <a className={styles.pageUrl} href={p.url} target="_blank" rel="noopener noreferrer">
                                {p.url.replace(/^https?:\/\/(www\.)?/, "")}
                              </a>
                              <div className={styles.pageMeta}>
                                <span>
                                  <strong>{visits(p.etv ?? 0)}</strong> {t("visitas al mes", "visits a month")}
                                </span>
                                <span>
                                  {n(p.keywords)} {t("búsquedas", "searches")}
                                </span>
                                {p.topKeyword && (
                                  <span>
                                    {t("Búsqueda principal:", "Top search:")} «{p.topKeyword}»
                                  </span>
                                )}
                                {kw && <a href={write(kw)}>{t("Escribir artículo", "Write article")} →</a>}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                      </ShowMore>
                    ) : (
                      <p className="small muted">
                        {t(
                          "DataForSEO no encontró páginas de este sitio con visitas desde Google en tu país (puede ser muy chico o nuevo).",
                          "DataForSEO found no pages on this site with Google visits in your country (it may be very small or new).",
                        )}
                      </p>
                    )}
                  </details>
                ))}
            </div>
          )}

          <HowToRead title={t("Cómo leer esto", "How to read this")}>
            <ul>
              <li>
                {t(
                  `Son estimados de DataForSEO para todo ${country} en Google (no por ciudad), no visitas exactas: sirven para comparar quién recibe más y cómo va cambiando. Tus visitas reales están en Search Console.`,
                  `These are DataForSEO estimates for all of ${country} on Google (not by city), not exact visits: use them to compare who gets more and how it's changing. Your real visits are in Search Console.`,
                )}
              </li>
              <li>{t("«Visitas al mes»: cuántas personas llegan a esa página desde Google en un mes, calculado con cuánta gente busca cada palabra y en qué lugar sale. Es un estimado para comparar, no un conteo exacto.", "“Visits a month”: how many people reach that website from Google in a month, calculated from how many people search each keyword and where it ranks. It's an estimate for comparing, not an exact count.")}</li>
              <li>{t("«Sale en N búsquedas»: en cuántas búsquedas de Google aparece (en cualquier lugar). «En los 3 primeros» y «en la primera página» son las que de verdad traen visitas.", "“Shows up for N searches”: how many Google searches it appears for (anywhere). “Top 3” and “page one” are the ones that actually bring visits.")}</li>
              <li>{t("«Valen US$ al mes en anuncios»: lo que costaría conseguir esas mismas visitas pagando anuncios en Google.", "“Worth US$ a month in ads”: what it would cost to get those same visits by paying for Google ads.")}</li>
              <li>{t("La gráfica muestra cómo cambiaron las visitas cada mes. Si un competidor sube rápido, mira sus mejores páginas: ahí está lo que le funciona.", "The chart shows how visits changed each month. If a competitor grows fast, look at its best pages: that's what's working for it.")}</li>
              <li>{t("«Sin datos» no es un error: la página es muy nueva o chica para que DataForSEO la mida. Es normal en negocios locales.", "“No data” isn't an error: the site is too new or small for DataForSEO to measure. It's normal for local businesses.")}</li>
              <li>{t("Qué hacer: abre las mejores páginas de tu competencia y, si no tienes una parecida, usa «Escribir artículo» para crearla.", "What to do: open your competitors' best pages and, if you don't have a similar one, use “Write article” to create it.")}</li>
            </ul>
          </HowToRead>
        </>
      )}
    </section>
  );
}
