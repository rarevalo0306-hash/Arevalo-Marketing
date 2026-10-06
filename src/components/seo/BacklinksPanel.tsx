import Link from "next/link";
import { runBacklinks } from "@/app/actions-seo-backlinks";
import styles from "@/components/seo/Backlinks.module.css";
import { BacklinksButton } from "@/components/seo/BacklinksButton";
import { HowToRead } from "@/components/seo/HowToRead";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import {
  BACKLINKS_ACTIVATE_URL,
  BACKLINKS_KIND,
  BACKLINKS_LOCKED_KIND,
  BACKLINKS_PRICING_URL,
  BACKLINKS_TASK_COST,
  HINT_EASY,
  hintText,
  backlinksCostEstimate,
  pickBacklinkCompetitors,
  readBacklinksLocked,
  readBacklinksReport,
  type GapDomain,
  type ReferringDomain,
} from "@/lib/seo/backlinks";
import { normalizeDomain, readCompetitorsReport } from "@/lib/seo/competitors";
import { dataForSeoEnabled } from "@/lib/seo/dataforseo";
import { BUSINESS_TZ } from "@/lib/time";

/** Enlaces hacia tu página (estilo Backlink Analytics + Backlink Gap). */
export async function BacklinksPanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const header = (
    <div className="stack" style={{ gap: 4 }}>
      <h2>{t("Enlaces hacia tu página", "Links to your site")}</h2>
      <p className="small muted">
        {t(
          "Cada sitio que pone un enlace a tu página es como una recomendación para Google: mientras más y mejores, más arriba sales.",
          "Every site that links to your website is like a recommendation for Google: the more (and better) they are, the higher you show up.",
        )}
      </p>
    </div>
  );
  const empty = (body: React.ReactNode) => (
    <section className="card" id="enlaces">
      {header}
      <p className="note">{body}</p>
    </section>
  );

  if (!dataForSeoEnabled())
    return empty(t("Para ver tus enlaces, primero conecta DataForSEO (arriba, en Datos reales de Google).", "To see your links, first connect DataForSEO (above, in Real Google data)."));

  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true } });
  if (!b) return null;
  const self = normalizeDomain(b.website);
  if (!self)
    return empty(
      <>
        {t("Para revisar los enlaces hacia tu página, primero agrega su dirección en ", "To check the links to your website, first add its address in ")}
        <Link href={`/b/${businessId}/negocio`}>{t("Ajustes del negocio", "Business settings")}</Link>.
      </>,
    );

  const [[row], [lockedRow], [compRow]] = await Promise.all([
    db.seoReport.findMany({ where: { businessId, kind: BACKLINKS_KIND }, orderBy: { createdAt: "desc" }, take: 1 }),
    db.seoReport.findMany({ where: { businessId, kind: BACKLINKS_LOCKED_KIND }, orderBy: { createdAt: "desc" }, take: 1 }),
    db.seoReport.findMany({ where: { businessId, kind: "competitors" }, orderBy: { createdAt: "desc" }, take: 1 }),
  ]);
  const report = row ? readBacklinksReport(row.data) : null;
  const locked = lockedRow && readBacklinksLocked(lockedRow.data) && (!row || lockedRow.createdAt > row.createdAt);
  const competitors = pickBacklinkCompetitors(compRow ? readCompetitorsReport(compRow.data) : null, self);
  const estimate = backlinksCostEstimate(competitors.length);

  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  const monthYear = new Intl.DateTimeFormat(intlLocale(lang), { month: "short", year: "numeric", timeZone: BUSINESS_TZ });
  const number = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 0 });
  const pct = new Intl.NumberFormat(intlLocale(lang), { style: "percent", maximumFractionDigits: 0 });
  const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 3 });
  const n = (v: number | null) => (v === null ? "—" : number.format(v));
  const date = (iso: string | null) => {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? monthYear.format(d) : "—";
  };
  const href = (d: string) => `https://${d}`;
  const hints = hintText(t);
  const button = <BacklinksButton action={runBacklinks.bind(null, businessId)} has={Boolean(report)} competitors={competitors.length} estimate={estimate} />;

  const lockedBox = (
    <div className={styles.locked}>
      <p>
        <strong>{t("Para ver esto falta activar «Backlinks API» en tu cuenta de DataForSEO.", "To see this, “Backlinks API” needs to be turned on in your DataForSEO account.")}</strong>
      </p>
      <ul>
        <li>
          {t(
            "Qué es: la parte de DataForSEO que cuenta qué sitios ponen enlaces a tu página y a la de tu competencia.",
            "What it is: the part of DataForSEO that counts which sites link to your website and to your competitors'.",
          )}
        </li>
        <li>
          {t(
            `Cuánto cuesta: se paga por uso, como lo demás. Cada revisión cuesta unos ${money.format(estimate)} (${money.format(BACKLINKS_TASK_COST)} por consulta). Antes DataForSEO pedía un mínimo de US$100 al mes; desde julio de 2026 ya no.`,
            `What it costs: pay as you go, like everything else. Each check costs about ${money.format(estimate)} (${money.format(BACKLINKS_TASK_COST)} per request). DataForSEO used to require a US$100 monthly minimum; since July 2026 it no longer does.`,
          )}{" "}
          <a href={BACKLINKS_PRICING_URL} target="_blank" rel="noopener noreferrer">{t("Ver precios", "See pricing")}</a>
        </li>
        <li>
          {t("Cómo activarla: entra a tu cuenta de DataForSEO en ", "How to turn it on: go to your DataForSEO account at ")}
          <a href={BACKLINKS_ACTIVATE_URL} target="_blank" rel="noopener noreferrer">app.dataforseo.com</a>
          {t(
            " y activa Backlinks API. Si no ves cómo, escríbele a su soporte (chat las 24 horas) y pide que te la activen.",
            " and turn on Backlinks API. If you can't find it, write to their support (24/7 chat) and ask them to turn it on.",
          )}
        </li>
        <li>
          {t(
            "Todo lo demás de esta página (palabras clave, posiciones, competencia, mapa) funciona igual sin esto.",
            "Everything else on this page (keywords, rankings, competitors, map) works the same without it.",
          )}
        </li>
      </ul>
    </div>
  );

  if (locked && !report)
    return (
      <section className="card" id="enlaces">
        {header}
        {lockedBox}
        {button}
        <p className="small muted">{t("Cuando la actives, presiona el botón para revisar de nuevo.", "Once it's on, press the button to check again.")}</p>
      </section>
    );

  const s = report?.summary;
  const all = report ? [{ domain: report.domain, rank: s?.rank ?? null, backlinks: s?.backlinks ?? null, referringDomains: s?.referringDomains ?? null, you: true }, ...report.competitors.map((c) => ({ ...c, you: false }))] : [];
  const maxDomains = Math.max(1, ...all.map((d) => d.referringDomains ?? 0));
  const change = (gained: number | null, lost: number | null) =>
    gained === null && lost === null ? (
      "—"
    ) : (
      <>
        <span className={styles.up}>+{n(gained ?? 0)}</span> / <span className={styles.down}>−{n(lost ?? 0)}</span>
      </>
    );

  const refTable = (rows: ReferringDomain[]) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t("Sitio", "Website")}</th>
            <th className={styles.num}>{t("Fuerza", "Strength")}</th>
            <th className={styles.num}>{t("Enlaces", "Links")}</th>
            <th>{t("Desde", "Since")}</th>
            <th>{t("¿Pasa fuerza?", "Passes strength?")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.domain}>
              <td className={`small ${styles.dom}`}>
                <a href={href(r.domain)} target="_blank" rel="noopener noreferrer">{r.domain}</a>
              </td>
              <td className={styles.num}>{n(r.rank)}</td>
              <td className={styles.num}>{n(r.backlinks)}</td>
              <td className="small" style={{ whiteSpace: "nowrap" }}>{date(r.firstSeen)}</td>
              <td className="small">{r.dofollow === null ? "—" : r.dofollow ? t("Sí", "Yes") : t("No (nofollow)", "No (nofollow)")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const whereList = (rows: GapDomain[]) => (
    <ul className={styles.where}>
      {rows.map((g) => (
        <li key={g.domain}>
          <div className={styles.whereTop}>
            <a className={styles.whereDomain} href={href(g.domain)} target="_blank" rel="noopener noreferrer">{g.domain}</a>
            <span className={`pill ${HINT_EASY[g.hint] ? "done" : "scheduled"}`}>{hints[g.hint].label}</span>
          </div>
          <span className={styles.whereHow}>{hints[g.hint].how}</span>
          <span className={styles.whereMeta}>
            {t("Fuerza", "Strength")} {n(g.rank)} · {t("enlaza a", "links to")} {g.linksTo.join(", ")}
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="card" id="enlaces">
      {header}
      <p className="small muted">
        {t("Tu página:", "Your website:")} <a href={href(self)} target="_blank" rel="noopener noreferrer">{self}</a>
        {row && (
          <>
            {" · "}
            {t("Última revisión:", "Last check:")} {fmt.format(row.createdAt)}
            {report && <> · {t("Costo:", "Cost:")} {money.format(report.cost)}</>}
          </>
        )}
      </p>
      {locked && lockedBox}
      {!competitors.length && (
        <p className="note">
          {t(
            'Todavía no sabemos quién es tu competencia: igual puedes revisar tus enlaces. Para compararte y ver dónde consiguen enlaces ellos, primero usa "Buscar mi competencia" (arriba).',
            'We don\'t know your competitors yet: you can still check your links. To compare yourself and see where they get links, first use "Find my competition" (above).',
          )}
        </p>
      )}

      {button}

      {!row && !locked && (
        <p className="small muted">
          {t(
            `Todavía no has revisado tus enlaces. Usa la parte «Backlinks API» de DataForSEO (pago por uso${competitors.length ? `; te comparamos con ${competitors.join(", ")}` : ""}). Si tu cuenta no la tiene activada, no se cobra nada y te explicamos cómo activarla.`,
            `You haven't checked your links yet. This uses DataForSEO's “Backlinks API” (pay as you go${competitors.length ? `; we compare you with ${competitors.join(", ")}` : ""}). If your account doesn't have it turned on, nothing is charged and we explain how to turn it on.`,
          )}
        </p>
      )}
      {row && !report && <p className="note">{t("El último reporte tiene un formato viejo y no se puede mostrar. Presiona Actualizar.", "The last report is in an old format and can't be shown. Press Update.")}</p>}

      {report && s && (
        <>
          {report.notes.length > 0 && (
            <ul className="small muted comp-notes">
              {report.notes.map((x, i) => <li key={i}>{lang === "en" ? x.en : x.es}</li>)}
            </ul>
          )}

          <div className={styles.kpis}>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>{t("Fuerza de tu página", "Your site's strength")}</span>
              <span className={styles.kpiValue}>
                {n(s.rank)} <small>/ 1000</small>
              </span>
              <span className={styles.kpiNote}>{t("Más alto = Google le da más peso", "Higher = more weight on Google")}</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>{t("Sitios que te enlazan", "Sites linking to you")}</span>
              <span className={styles.kpiValue}>{n(s.referringDomains ?? report.referringTotal)}</span>
              <span className={styles.kpiNote}>
                {s.referringIps !== null && t(`desde ${n(s.referringIps)} servidores distintos`, `from ${n(s.referringIps)} different servers`)}
              </span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>{t("Enlaces en total", "Total links")}</span>
              <span className={styles.kpiValue}>{n(s.backlinks)}</span>
              <span className={styles.kpiNote}>{t("Un sitio puede enlazarte muchas veces", "One site can link to you many times")}</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>{t("Enlaces que pasan fuerza", "Links that pass strength")}</span>
              <span className={styles.kpiValue}>{s.dofollowShare === null ? "—" : pct.format(s.dofollowShare)}</span>
              <span className={styles.kpiNote}>
                {s.nofollowLinks !== null && t(`${n(s.nofollowLinks)} son «nofollow» (no cuentan tanto)`, `${n(s.nofollowLinks)} are “nofollow” (count less)`)}
              </span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>{t("Sitios nuevos / perdidos", "Sites gained / lost")}</span>
              <span className={styles.kpiValue}>{change(s.newDomains1m, s.lostDomains1m)}</span>
              <span className={styles.kpiNote}>
                {t("último mes", "last month")}
                {(s.newDomains3m !== null || s.lostDomains3m !== null) && (
                  <>
                    {" · "}
                    {t("3 meses:", "3 months:")} +{n(s.newDomains3m ?? 0)} / −{n(s.lostDomains3m ?? 0)}
                  </>
                )}
              </span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>{t("Enlaces rotos", "Broken links")}</span>
              <span className={styles.kpiValue}>{n(s.brokenBacklinks)}</span>
              <span className={styles.kpiNote}>{t("Apuntan a una página tuya que ya no existe", "They point to a page of yours that no longer exists")}</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>{t("Spam en tus enlaces", "Spam in your links")}</span>
              <span className={styles.kpiValue}>
                {n(s.spamScore)} <small>/ 100</small>
              </span>
              <span className={styles.kpiNote}>{t("Menos de 30 está bien", "Under 30 is fine")}</span>
            </div>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <span className="lbl">{t("Sitios que te enlazan", "Sites that link to you")}</span>
            {report.referring.length === 0 ? (
              <p className="small muted">
                {t(
                  "Todavía no encontramos sitios que te enlacen. Es normal en páginas nuevas: empieza por los directorios de la lista de abajo.",
                  "We didn't find sites linking to you yet. That's normal for new websites: start with the directories in the list below.",
                )}
              </p>
            ) : (
              <>
                {refTable(report.referring.slice(0, 10))}
                {report.referring.length > 10 && (
                  <details>
                    <summary className="btn link" style={{ display: "inline-flex", minHeight: 0, padding: 0 }}>
                      {t(`Ver los otros ${report.referring.length - 10}`, `See the other ${report.referring.length - 10}`)}
                    </summary>
                    {refTable(report.referring.slice(10))}
                  </details>
                )}
                {report.referringTotal !== null && report.referringTotal > report.referring.length && (
                  <span className="small muted">
                    {t(`Mostramos los ${report.referring.length} más fuertes de ${n(report.referringTotal)}.`, `Showing the ${report.referring.length} strongest of ${n(report.referringTotal)}.`)}
                  </span>
                )}
              </>
            )}
          </div>

          {report.competitors.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <span className="lbl">{t("Comparación con tu competencia", "Compared with your competitors")}</span>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Sitio", "Website")}</th>
                      <th className={styles.num}>{t("Fuerza", "Strength")}</th>
                      <th>{t("Sitios que lo enlazan", "Sites linking to it")}</th>
                      <th className={styles.num}>{t("Enlaces", "Links")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {all.map((d) => (
                      <tr key={d.domain} className={d.you ? styles.you : undefined}>
                        <td className={`small ${styles.dom}`}>{d.you ? <strong>{t("Tú", "You")} · {d.domain}</strong> : d.domain}</td>
                        <td className={styles.num}>{n(d.rank)}</td>
                        <td>
                          <span className={styles.meterCell}>
                            <span className="meter"><span style={{ width: `${Math.round(((d.referringDomains ?? 0) / maxDomains) * 100)}%` }} /></span>
                            <span className={styles.num}>{n(d.referringDomains)}</span>
                          </span>
                        </td>
                        <td className={styles.num}>{n(d.backlinks)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {report.competitors.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <span className="lbl">{t("Dónde conseguir enlaces", "Where to get links")}</span>
              <span className="small muted">
                {t(
                  "Sitios que ya enlazan a tu competencia y a ti no. Arriba los que enlazan a más de tus competidores y los más fuertes.",
                  "Sites that already link to your competitors but not to you. On top: the ones linking to more of your competitors and the strongest.",
                )}
              </span>
              {report.gap.length === 0 ? (
                <p className="small muted">
                  {t(
                    "No encontramos sitios que enlacen a tu competencia y a ti no. ¡Bien! Revisa de nuevo en unos meses.",
                    "We didn't find sites that link to your competitors but not to you. Nice! Check again in a few months.",
                  )}
                </p>
              ) : (
                <>
                  {whereList(report.gap.slice(0, 15))}
                  {report.gap.length > 15 && (
                    <details>
                      <summary className="btn link" style={{ display: "inline-flex", minHeight: 0, padding: 0 }}>
                        {t(`Ver los ${report.gap.length - 15} restantes`, `See the other ${report.gap.length - 15}`)}
                      </summary>
                      {whereList(report.gap.slice(15))}
                    </details>
                  )}
                </>
              )}
              {report.gapSpamHidden > 0 && (
                <span className="small muted">
                  {t(
                    `Quitamos ${report.gapSpamHidden} ${report.gapSpamHidden === 1 ? "sitio que parece" : "sitios que parecen"} spam: un enlace de ahí no te ayuda.`,
                    `We removed ${report.gapSpamHidden} ${report.gapSpamHidden === 1 ? "site that looks" : "sites that look"} like spam: a link from there won't help you.`,
                  )}
                </span>
              )}
            </div>
          )}

          <HowToRead title={t("Cómo leer esto", "How to read this")}>
            <ul>
              <li>
                {t(
                  "«Fuerza» (0 a 1000) es un puntaje de DataForSEO parecido al que usa Google: sube cuando sitios importantes te enlazan. No hay un número ideal: lo útil es compararte con tu competencia.",
                  "“Strength” (0 to 1000) is a DataForSEO score similar to what Google uses: it goes up when important sites link to you. There's no ideal number: what matters is how you compare with your competitors.",
                )}
              </li>
              <li>
                {t(
                  "Importa más cuántos sitios distintos te enlazan que el total de enlaces: 10 sitios con 1 enlace valen más que 1 sitio con 100.",
                  "How many different sites link to you matters more than the total number of links: 10 sites with 1 link each beat 1 site with 100.",
                )}
              </li>
              <li>
                {t(
                  "«Nofollow» es un enlace que le pide a Google no contarlo como recomendación. Trae visitas, pero casi no da fuerza.",
                  "“Nofollow” is a link that asks Google not to count it as a recommendation. It brings visits but gives almost no strength.",
                )}
              </li>
              <li>
                {t(
                  "Qué hacer: empieza por los «fácil» de «Dónde conseguir enlaces» (directorios, redes) y luego busca 1 o 2 por mes de noticias, asociaciones o proveedores. Nunca compres enlaces: Google lo castiga.",
                  "What to do: start with the “easy” ones in “Where to get links” (directories, social) and then go after 1 or 2 a month from news, associations or suppliers. Never buy links: Google penalizes it.",
                )}
              </li>
              <li>
                {t(
                  "Los datos son de DataForSEO y se actualizan cada pocos días; un enlace nuevo puede tardar unas semanas en aparecer.",
                  "The data comes from DataForSEO and refreshes every few days; a new link can take a few weeks to show up.",
                )}
              </li>
            </ul>
          </HowToRead>
        </>
      )}
    </section>
  );
}
