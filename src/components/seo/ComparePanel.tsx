import { compareSites } from "@/app/actions-seo-compare";
import { CompareForm } from "@/components/seo/CompareForm";
import { HowToRead } from "@/components/seo/HowToRead";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { bestIn, COMPARE_MAX, type CompareMetric, compareCostEstimate, compareSummary, readCompareReport } from "@/lib/seo/compare";
import { normalizeDomain, readCompetitorsReport, sameSite, withoutDirectories } from "@/lib/seo/competitors";
import { dataForSeoEnabled, readZones } from "@/lib/seo/dataforseo";
import { costText } from "@/lib/seo/keywords";
import { latestReports } from "@/lib/seo/reports";
import { BUSINESS_TZ } from "@/lib/time";

/** «Comparar páginas»: tu página y hasta 4 más, lado a lado (visitas de Google, búsquedas, top 3, enlaces). */
export async function ComparePanel({ businessId, comparar }: { businessId: string; comparar?: string }) {
  if (!dataForSeoEnabled()) return null;
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true } });
  if (!b) return null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const own = normalizeDomain(b.website);
  const [[saved], [compRow]] = await Promise.all([latestReports(businessId, "compare", 1), latestReports(businessId, "competitors", 1)]);
  const report = saved ? readCompareReport(saved.data) : null;
  const comp = compRow ? readCompetitorsReport(compRow.data) : null;

  // Para empezar: la que llegó desde el buscador, las de la última comparación y tu competencia.
  const defaults: string[] = [];
  const add = (d: string | null | undefined) => {
    const x = d ? normalizeDomain(d) : null;
    if (x && x !== own && !defaults.some((y) => sameSite(x, y)) && defaults.length < COMPARE_MAX - (own ? 1 : 0)) defaults.push(x);
  };
  add(comparar);
  for (const r of report?.rows ?? []) if (!r.own) add(r.domain);
  for (const c of comp ? withoutDirectories(comp).report.competitors : []) add(c.domain);

  const number = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 0 });
  const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  const cols: { key: CompareMetric; label: string; hint: string; money?: boolean; links?: boolean }[] = [
    { key: "traffic", label: t("Visitas de Google al mes", "Google visits a month"), hint: t("Visitas estimadas que le llegan desde Google sin pagar", "Estimated free visits from Google") },
    { key: "keywords", label: t("Búsquedas donde sale", "Searches it shows up for"), hint: t("En cuántas búsquedas aparece en los primeros 100", "How many searches it appears for in the top 100") },
    { key: "top3", label: t("En el top 3", "In the top 3"), hint: t("Búsquedas donde sale 1°, 2° o 3°: ahí se van casi todos los clics", "Searches where it's #1–#3: almost all clicks go there") },
    { key: "top10", label: t("En la 1ª página", "On page one"), hint: t("Búsquedas donde sale en los primeros 10", "Searches where it's in the top 10") },
    { key: "trafficValue", label: t("Valor en anuncios", "Value in ads"), hint: t("Lo que costaría pagar anuncios para tener esas mismas visitas, al mes", "What it would cost to buy those same visits with ads, per month"), money: true },
    { key: "rank", label: t("Fuerza (0-1000)", "Strength (0-1000)"), hint: t("Fuerza de la página por los enlaces que recibe", "Website strength from the links it gets"), links: true },
    { key: "referringDomains", label: t("Sitios que la enlazan", "Sites linking to it"), hint: t("Páginas distintas que ponen un enlace hacia ella", "Different websites that link to it"), links: true },
  ];
  const shown = report ? cols.filter((c) => !c.links || !report.linksLocked) : [];
  const summary = report ? compareSummary(report) : null;

  return (
    <section className="card" id="comparar">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{t("Comparar páginas", "Compare websites")}</h2>
        <p className="small muted">
          {t(
            "Tu página y hasta 4 más, lado a lado: cuántas visitas les da Google, en cuántas búsquedas salen arriba y qué tan fuertes son por sus enlaces.",
            "Your website and up to 4 more, side by side: how many visits Google sends them, how many searches they rank high for, and how strong their links make them.",
          )}
        </p>
      </div>
      {!zones.length ? (
        <p className="note">{t("Primero elige la zona donde buscan tus clientes en la pestaña «⚙ Ajustes».", "First pick the area where your customers search in the “⚙ Settings” tab.")}</p>
      ) : (
        <CompareForm action={compareSites.bind(null, businessId)} own={own} defaults={defaults} price={costText(compareCostEstimate(COMPARE_MAX))} has={Boolean(report)} />
      )}
      {report && saved && (
        <>
          <p className="small muted">
            {t(`Datos de Google en ${report.country || "tu país"}`, `Google data for ${report.country || "your country"}`)} · {fmt.format(saved.createdAt)} · {t("costó", "cost")} {costText(report.cost)}
          </p>
          {summary && <p className="note info">{lang === "en" ? summary.en : summary.es}</p>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Página", "Website")}</th>
                  {shown.map((c) => (
                    <th key={c.key} className="kw-num" title={c.hint}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.domain} className={r.own ? "compare-mine" : undefined}>
                    <td>
                      <strong>{r.domain}</strong>
                      {r.own && <span className="small muted"> · {t("tú", "you")}</span>}
                    </td>
                    {shown.map((c) => {
                      const v = r[c.key];
                      const best = bestIn(report.rows, c.key) === r.domain;
                      return (
                        <td key={c.key} className="kw-num">
                          {typeof v === "number" ? (
                            <span className={best ? "compare-best" : undefined} title={best ? t("El mejor de la tabla", "The best in the table") : undefined}>
                              {c.money ? money.format(v) : number.format(v)}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.linksLocked && (
            <p className="small muted">
              {t(
                "Los enlaces no se muestran porque tu cuenta de DataForSEO no tiene activada la parte de Enlaces (Backlinks API). Puedes activarla en app.dataforseo.com.",
                "Links aren't shown because your DataForSEO account doesn't have the Links part (Backlinks API) turned on. You can turn it on at app.dataforseo.com.",
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
          <HowToRead title={t("Cómo leer la comparación", "How to read the comparison")}>
            <ul>
              <li>{t("En negrita: el mejor de la tabla en esa columna.", "In bold: the best in the table for that column.")}</li>
              <li>{t("Las visitas y las búsquedas son estimados de DataForSEO para todo el país, no solo tu ciudad: sirven para comparar, no como número exacto.", "Visits and searches are DataForSEO estimates for the whole country, not just your city: use them to compare, not as exact numbers.")}</li>
              <li>{t("«Valor en anuncios» dice cuánto valen esas visitas: si un competidor tiene mucho, Google le manda clientes que a ti te costarían en anuncios.", "“Value in ads” says what those visits are worth: if a competitor has a lot, Google sends them customers that would cost you in ads.")}</li>
              <li>{t("Para ver qué búsquedas tiene un competidor y tú no, mira «Lo que tu competencia tiene y tú no» más abajo.", "To see which searches a competitor has and you don't, see “What your competitors have that you don't” below.")}</li>
            </ul>
          </HowToRead>
        </>
      )}
    </section>
  );
}
