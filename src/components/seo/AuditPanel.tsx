import Link from "next/link";
import { runSiteAudit } from "@/app/actions-seo-audit";
import { AiPromptButton } from "@/components/seo/AiPromptButton";
import { AuditButton } from "@/components/seo/AuditButton";
import { AuditIssues, issueUrls, shortUrl } from "@/components/seo/AuditIssues";
import styles from "@/components/seo/AuditPanel.module.css";
import { Fold } from "@/components/seo/Fold";
import { HowToRead } from "@/components/seo/HowToRead";
import { ScoreVerdict } from "@/components/seo/ScoreVerdict";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { auditBreakdown, ISSUE_TEXT, MAX_PAGES, readAuditReport, type AuditReport, type Severity } from "@/lib/seo/audit";
import { compareAudits } from "@/lib/seo/audit-compare";
import { loadPromptContext } from "@/lib/seo/prompt-context";
import { auditPrompt } from "@/lib/seo/prompts";
import { latestReports } from "@/lib/seo/reports";
import { AUDIT_WEIGHT } from "@/lib/seo/verdict";
import { BUSINESS_TZ } from "@/lib/time";
import { SITE_CHANNEL } from "@/lib/webfix-shape";
import webfix from "@/components/webfix/WebFix.module.css";

/** Cuántas revisiones se leen para el historial de la nota. */
const HISTORY = 8;

export async function AuditPanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true } });
  const website = b?.website.trim() ?? "";
  const rows = website ? await latestReports(businessId, "audit", HISTORY) : [];
  // Las revisiones que se pueden leer, de la más nueva a la más vieja (la primera es la que se muestra).
  const parsed = rows.map((r) => ({ at: r.createdAt, report: readAuditReport(r.data) })).filter((r): r is { at: Date; report: AuditReport } => !!r.report);
  const report = rows[0] && parsed[0]?.at === rows[0].createdAt ? parsed[0].report : null;
  const previous = report ? (parsed[1] ?? null) : null;
  const compare = report ? compareAudits(report, previous?.report ?? null) : null;
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  const day = new Intl.DateTimeFormat(intlLocale(lang), { day: "numeric", month: "short", timeZone: BUSINESS_TZ });
  const number = new Intl.NumberFormat(intlLocale(lang));
  const one = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 1 });

  const sevLabel: Record<Severity, string> = {
    error: t("Error", "Error"),
    warning: t("Advertencia", "Warning"),
    notice: t("Sugerencia", "Notice"),
  };

  // Historial: las últimas notas, de la más vieja a la más nueva.
  const trend = parsed.map((r) => ({ at: r.at, score: r.report.score })).reverse();

  const header = (
    <div className="stack" style={{ gap: 4 }}>
      <h2>{t("Auditoría del sitio", "Site audit")}</h2>
      <p className="small muted">
        {t(
          "Revisamos tu página web como lo hace Google y como la leen las IAs: títulos, textos, fotos, enlaces rotos, datos para Google, páginas viejas de WordPress, el archivo para IAs, velocidad en el celular y más. Te decimos qué arreglar primero.",
          "We check your website the way Google does and the way AIs read it: titles, text, photos, broken links, data for Google, old WordPress pages, the AI file, mobile speed and more. We tell you what to fix first.",
        )}
      </p>
    </div>
  );

  if (!website) {
    return (
      <section className="card" id="auditoria">
        {header}
        <p className="note">
          {t("Para revisar tu página, primero agrega su dirección en ", "To check your website, first add its address in ")}
          <Link href={`/b/${businessId}/negocio`}>{t("Ajustes del negocio", "Business settings")}</Link>.
        </p>
      </section>
    );
  }

  const action = runSiteAudit.bind(null, businessId);
  const ctx = report?.issues.length ? await loadPromptContext(businessId) : null;
  // «Arréglalo por mí» necesita la web conectada (Conexiones → Sitio web); si no, un enlace pequeño para conectarla.
  const siteConnected = report?.issues.length ? Boolean(await db.connection.findUnique({ where: { businessId_channel: { businessId, channel: SITE_CHANNEL } }, select: { id: true } })) : true;
  const counts = (s: Severity) => report?.issues.filter((i) => i.severity === s).length ?? 0;
  const ps = report?.pagespeed;
  const home = report?.site.home || website;
  const depth = report?.site.depthCounts;
  const depthKeys = depth ? Object.keys(depth).filter((k) => k !== "none").sort((a, b) => parseInt(a) - parseInt(b)) : [];

  return (
    <section className="card" id="auditoria">
      {header}
      <p className="small muted">
        {t("Página:", "Website:")} <a href={website.startsWith("http") ? website : `https://${website}`} target="_blank" rel="noopener noreferrer">{website}</a>
        {rows[0] && <> · {t("Última revisión:", "Last check:")} {fmt.format(rows[0].createdAt)}</>}
      </p>
      <AuditButton action={action} has={rows.length > 0} maxPages={MAX_PAGES} />
      {report && (
        <HowToRead title={t("Cómo leer esto", "How to read this")}>
          <ul>
            <li>{t("La nota de 0 a 100 dice qué tan bien está armada tu página para Google: 90 o más es excelente, de 70 a 89 está bien, de 50 a 69 es regular y menos de 50 es urgente.", "The 0-100 score says how well your website is built for Google: 90 or more is excellent, 70 to 89 is good, 50 to 69 is fair and under 50 is urgent.")}</li>
            <li>{t("Arregla primero los errores (rojo), después las advertencias (amarillo). Las sugerencias son detalles.", "Fix the errors (red) first, then the warnings (yellow). Notices are details.")}</li>
            <li>{t("Cada problema dice cómo arreglarlo y, al abrir la lista, la página exacta y lo que está mal (por ejemplo, el título que es muy largo).", "Each problem says how to fix it and, when you open the list, the exact page and what's wrong (for example, the title that's too long).")}</li>
            <li>{t("«Arregladas» y «Nuevas» comparan con la revisión anterior, para que veas si vas avanzando.", "\"Fixed\" and \"New\" compare with the previous check, so you can see your progress.")}</li>
          </ul>
        </HowToRead>
      )}

      {rows.length === 0 && (
        <p className="small muted">{t("Todavía no has revisado tu página. Presiona el botón: es gratis y no necesita claves.", "You haven't checked your website yet. Press the button: it's free and needs no keys.")}</p>
      )}
      {rows.length > 0 && !report && (
        <p className="note">{t("El último reporte tiene un formato viejo y no se puede mostrar. Vuelve a revisar tu página.", "The last report is in an old format and can't be shown. Check your website again.")}</p>
      )}

      {report && (
        <>
          <div className="grid-2" style={{ gap: 18 }}>
            <div className="stack" style={{ gap: 8 }}>
              <span className="lbl">{t("Puntaje de salud", "Health score")}</span>
              <div className="seo-score">
                {report.score}
                <small>/100</small>
              </div>
              <span className="meter" style={{ display: "block" }}><span style={{ width: `${report.score}%` }} /></span>
              <ScoreVerdict score={report.score} lang={lang} />
              {compare && previous && (
                <div className={styles.compare}>
                  <span className="small">
                    {compare.scoreDelta === 0
                      ? t(`Igual que en la revisión del ${day.format(previous.at)} (${compare.prevScore}).`, `Same as the check on ${day.format(previous.at)} (${compare.prevScore}).`)
                      : compare.scoreDelta > 0
                        ? t(`Subió ${compare.scoreDelta} desde la revisión del ${day.format(previous.at)} (${compare.prevScore}).`, `Up ${compare.scoreDelta} since the check on ${day.format(previous.at)} (${compare.prevScore}).`)
                        : t(`Bajó ${-compare.scoreDelta} desde la revisión del ${day.format(previous.at)} (${compare.prevScore}).`, `Down ${-compare.scoreDelta} since the check on ${day.format(previous.at)} (${compare.prevScore}).`)}
                  </span>
                  <div className={styles.chips}>
                    <span className={`${styles.chip} ${compare.totals.fixed ? styles.chipOk : ""}`}>{t(`Arregladas: ${compare.totals.fixed}`, `Fixed: ${compare.totals.fixed}`)}</span>
                    <span className={`${styles.chip} ${compare.totals.added ? styles.chipBad : ""}`}>{t(`Nuevas: ${compare.totals.added}`, `New: ${compare.totals.added}`)}</span>
                  </div>
                  {(previous.report.maxPages ?? 30) < (report.maxPages ?? 30) && (
                    <span className="small muted">
                      {t(
                        `Ahora leemos hasta ${report.maxPages} páginas (antes ${previous.report.maxPages ?? 30}): por eso pueden salir más páginas con el mismo problema.`,
                        `We now read up to ${report.maxPages} pages (before: ${previous.report.maxPages ?? 30}), so more pages may show the same problem.`,
                      )}
                    </span>
                  )}
                  {compare.newChecks.length > 0 && (
                    <span className="small muted">
                      {t(
                        `Esta revisión es más completa: ahora miramos ${compare.newChecks.length} cosas más (datos para Google, IAs, WordPress viejo, enlaces internos…). Si la nota bajó, puede ser por eso y no porque algo se haya dañado.`,
                        `This check is more complete: we now look at ${compare.newChecks.length} more things (data for Google, AIs, old WordPress, internal links…). If the score went down, that may be why, not because something broke.`,
                      )}
                    </span>
                  )}
                </div>
              )}
              {trend.length > 1 && (
                <div className="row" style={{ gap: 10, alignItems: "flex-end" }}>
                  <div className="seo-trend" role="img" aria-label={t(`Últimas notas: ${trend.map((x) => x.score).join(", ")}`, `Recent scores: ${trend.map((x) => x.score).join(", ")}`)}>
                    {trend.map((x, i) => (
                      <span key={i} className={i === trend.length - 1 ? "last" : ""} style={{ height: `${Math.max(8, x.score)}%` }} title={`${fmt.format(x.at)}: ${x.score}`} />
                    ))}
                  </div>
                  <span className="small muted">
                    {t("Historial:", "History:")} {trend.map((x) => x.score).join(" → ")}
                  </span>
                </div>
              )}
              <div className="row" style={{ gap: 8 }}>
                <span className="pill failed">{counts("error")} {t(counts("error") === 1 ? "error" : "errores", counts("error") === 1 ? "error" : "errors")}</span>
                <span className="pill partial">{counts("warning")} {t(counts("warning") === 1 ? "advertencia" : "advertencias", counts("warning") === 1 ? "warning" : "warnings")}</span>
                <span className="pill scheduled">{counts("notice")} {t(counts("notice") === 1 ? "sugerencia" : "sugerencias", counts("notice") === 1 ? "notice" : "notices")}</span>
              </div>
              <span className="small muted">
                {t(
                  `${report.pages.length} páginas revisadas · ${report.site.checkedLinks} enlaces probados`,
                  `${report.pages.length} pages checked · ${report.site.checkedLinks} links tested`,
                )}
                {report.site.checkedImages ? t(` · ${report.site.checkedImages} fotos probadas`, ` · ${report.site.checkedImages} images tested`) : ""}
                {report.site.stoppedEarly && t(" · se paró por tiempo antes de leerlo todo", " · stopped early because of the time limit")}
                {!report.site.stoppedEarly &&
                  report.site.crawlComplete === false &&
                  t(` · tu sitio tiene más páginas; revisamos las primeras ${report.maxPages ?? report.pages.length}`, ` · your site has more pages; we checked the first ${report.maxPages ?? report.pages.length}`)}
              </span>
              <HowToRead title={t("¿Cómo se calcula la nota?", "How is the score calculated?")}>
                <p>
                  {t(
                    `Empezamos en 100 y cada problema resta puntos. Un error resta hasta ${AUDIT_WEIGHT.error}, una advertencia hasta ${AUDIT_WEIGHT.warning} y una sugerencia hasta ${AUDIT_WEIGHT.notice}. Si el problema está en una sola página resta la mitad; si está en todas las páginas revisadas (o es de todo el sitio, como el sitemap o el archivo para IAs), resta completo. La nota nunca baja de 0.`,
                    `We start at 100 and each problem takes points off. An error takes up to ${AUDIT_WEIGHT.error}, a warning up to ${AUDIT_WEIGHT.warning} and a notice up to ${AUDIT_WEIGHT.notice}. If the problem is on just one page it takes half; if it's on every page checked (or affects the whole site, like the sitemap or the AI file), it takes the full amount. The score never goes below 0.`,
                  )}
                </p>
                {report.issues.length > 0 && (
                  <>
                    <p>
                      <strong>{t(`Tu nota: 100 − lo que restó cada problema = ${report.score}`, `Your score: 100 − what each problem took off = ${report.score}`)}</strong>
                    </p>
                    <ul>
                      {auditBreakdown(report.issues, report.pages.length).map((d) => (
                        <li key={d.id}>
                          −{one.format(d.points)} · {ISSUE_TEXT[d.id][lang].title} <span className="muted">({sevLabel[d.severity].toLowerCase()})</span>
                        </li>
                      ))}
                    </ul>
                    <p className="muted">{t("Los decimales se suman y al final se redondea.", "Decimals are added up and rounded at the end.")}</p>
                  </>
                )}
                <p className="muted">
                  {t(
                    "La velocidad de Google (PageSpeed) se muestra aparte y no cambia esta nota.",
                    "Google's speed test (PageSpeed) is shown separately and doesn't change this score.",
                  )}
                </p>
              </HowToRead>
            </div>

            <div className="stack" style={{ gap: 8 }}>
              <span className="lbl">{t("Google PageSpeed (celular)", "Google PageSpeed (mobile)")}</span>
              {ps && "error" in ps ? (
                <p className="note">
                  {t("Esta vez no se pudo medir con Google", "Google's test didn't work this time")}
                  {/quota|rate|429/i.test(ps.error)
                    ? t(" (Google llegó a su límite de pruebas gratis por hoy).", " (Google hit its free test limit for today).")
                    : /timeout|abort/i.test(ps.error)
                      ? t(" (tu página tardó demasiado en responder).", " (your page took too long to respond).")
                      : "."}{" "}
                  {t(
                    "Vuelve a intentarlo más tarde. Si pasa seguido, agrega PAGESPEED_API_KEY en Vercel (es gratis en Google Cloud).",
                    "Try again later. If it keeps happening, add PAGESPEED_API_KEY in Vercel (it's free in Google Cloud).",
                  )}
                </p>
              ) : ps ? (
                <>
                  <div className="seo-tiles">
                    {(
                      [
                        [t("Rendimiento", "Performance"), ps.performance],
                        ["SEO", ps.seo],
                        [t("Accesibilidad", "Accessibility"), ps.accessibility],
                        [t("Buenas prácticas", "Best practices"), ps.bestPractices],
                      ] as [string, number | null][]
                    ).map(([label, v]) => (
                      <div key={label} className="seo-tile">
                        <span className="small muted">{label}</span>
                        <strong>{v ?? "—"}</strong>
                        <span className="meter" style={{ display: "block" }}><span style={{ width: `${v ?? 0}%` }} /></span>
                      </div>
                    ))}
                  </div>
                  <span className="small muted">
                    {[
                      ps.lcp && `${t("Carga lo principal (LCP)", "Main content loads (LCP)")}: ${ps.lcp}`,
                      ps.cls && `${t("Movimiento al cargar (CLS)", "Layout shift (CLS)")}: ${ps.cls}`,
                      ps.tbt && `${t("Tiempo bloqueado (TBT)", "Blocking time (TBT)")}: ${ps.tbt}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </>
              ) : null}

              {depth && depthKeys.length > 0 && (
                <>
                  <span className="lbl" style={{ marginTop: 6 }}>{t("A cuántos clics están tus páginas", "How many clicks away your pages are")}</span>
                  <ul className={styles.depth} aria-label={t("Páginas por clics desde el inicio", "Pages by clicks from the home page")}>
                    {depthKeys.map((k) => (
                      <li key={k} className={`${styles.depthTile} ${k.endsWith("+") ? styles.depthDeep : ""}`}>
                        <strong>{number.format(depth[k])}</strong>
                        <span>
                          {k === "0"
                            ? t("inicio", "home")
                            : k.endsWith("+")
                              ? t(`a ${k.replace("+", "")} clics o más`, `${k.replace("+", "")}+ clicks away`)
                              : t(`a ${k} ${k === "1" ? "clic" : "clics"}`, `${k} ${k === "1" ? "click" : "clicks"} away`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <span className="small muted">
                    {t("Lo ideal es que cada página esté a 3 clics o menos desde el inicio.", "Ideally every page is 3 clicks or less from the home page.")}
                    {(depth.none ?? 0) > 0 && t(` ${depth.none} no tienen enlaces desde las páginas que leímos.`, ` ${depth.none} have no links from the pages we read.`)}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="stack" style={{ gap: 10 }}>
            <span className="lbl">{t("Qué arreglar", "What to fix")}</span>
            {!siteConnected && (
              <p className={webfix.connect}>
                {t("¿Tu web está en GitHub? Matya puede arreglarla por ti: ", "Is your website on GitHub? Matya can fix it for you: ")}
                <Link href={`/b/${businessId}/conexiones#c-seo`}>{t("Conectar tu web", "Connect your website")}</Link>
              </p>
            )}
            {report.issues.length === 0 ? (
              <p className="note ok">{t("¡No encontramos problemas! Tu página está en muy buena forma.", "We didn't find any problems! Your website is in great shape.")}</p>
            ) : (
              <AuditIssues report={report} compare={compare} ctx={ctx} lang={lang} />
            )}
            {compare && compare.gone.length > 0 && (
              <div className={styles.gone}>
                <span className="lbl">{t("Ya arreglaste", "Already fixed")}</span>
                <ul>
                  {compare.gone.map((g) => (
                    <li key={g.id}>
                      <span aria-hidden="true">✓</span> {ISSUE_TEXT[g.id][lang].title} <span className="muted">({t(`la vez anterior: ${g.count}`, `last time: ${g.count}`)})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <p className="small muted">
            {t("¿Quieres ideas página por página, comparadas con los que ganan en Google? Ve a ", "Want page-by-page ideas, compared with the pages winning on Google? Go to ")}
            <a href="#paginas">{t("Revisión de tus páginas", "Your pages check")}</a>.
          </p>

          {report.pages.length > 0 && (
            <Fold summary={t(`Ver las ${report.pages.length} páginas revisadas`, `See the ${report.pages.length} pages checked`)}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Página", "Page")}</th>
                      <th>{t("Estado", "Status")}</th>
                      <th>{t("Título (letras)", "Title (characters)")}</th>
                      <th>{t("Palabras", "Words")}</th>
                      <th>{t("Clics desde el inicio", "Clicks from home")}</th>
                      <th>{t("Tiempo", "Time")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.pages.map((p, i) => {
                      const ok = !p.error && p.status >= 200 && p.status < 400;
                      return (
                        <tr key={`${p.url}-${i}`}>
                          <td className="small" style={{ wordBreak: "break-all" }}>
                            <a href={p.finalUrl || p.url} target="_blank" rel="noopener noreferrer">{shortUrl(p.finalUrl || p.url, home)}</a>
                            {p.title && <span className="muted" style={{ display: "block" }}>{p.title}</span>}
                          </td>
                          <td>
                            <span className={`pill ${ok ? "done" : "failed"}`}>{p.error ? t("Sin respuesta", "No response") : p.status}</span>
                          </td>
                          <td className="small">{ok ? p.title.length : "—"}</td>
                          <td className="small">{ok ? number.format(p.words) : "—"}</td>
                          <td className="small">{typeof p.depth === "number" ? p.depth : "—"}</td>
                          <td className="small">{p.ms ? `${number.format(Math.round(p.ms) / 1000)} s` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Fold>
          )}

          {ctx && (
            <AiPromptButton
              text={auditPrompt(ctx, report, lang)}
              hint={t("Todos los problemas juntos, con cada página y cómo arreglarlo, listo para pegar.", "All the problems together, with each page and how to fix it, ready to paste.")}
              fix={{ kind: "audit", title: t("Todos los problemas de la auditoría", "All the audit problems"), issueIds: report.issues.map((i) => i.id), urls: issueUrls(report.issues) }}
            />
          )}
        </>
      )}
    </section>
  );
}
