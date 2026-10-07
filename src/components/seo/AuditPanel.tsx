import Link from "next/link";
import { runSiteAudit } from "@/app/actions-seo-audit";
import { AiPromptButton } from "@/components/seo/AiPromptButton";
import { AuditButton } from "@/components/seo/AuditButton";
import { capClass } from "@/components/seo/Fold";
import { HowToRead } from "@/components/seo/HowToRead";
import { ScoreVerdict } from "@/components/seo/ScoreVerdict";
import { ShowMore } from "@/components/seo/ShowMore";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { ISSUE_TEXT, readAuditReport, type Issue, type Severity } from "@/lib/seo/audit";
import { loadPromptContext } from "@/lib/seo/prompt-context";
import { auditPrompt } from "@/lib/seo/prompts";
import { latestReports } from "@/lib/seo/reports";
import { AUDIT_WEIGHT, auditDeductions } from "@/lib/seo/verdict";
import { BUSINESS_TZ } from "@/lib/time";

/** Cuántos problemas se ven antes de «Ver todos» (van primero los más graves). */
const ISSUES_SHOWN = 5;

const PILL: Record<Severity, string> = { error: "failed", warning: "partial", notice: "scheduled" };

/** La dirección corta para mostrar: solo la ruta si es del mismo sitio. */
function short(url: string, home: string): string {
  try {
    const u = new URL(url);
    const h = new URL(home);
    return u.host === h.host ? `${u.pathname}${u.search}` || "/" : url.replace(/^https?:\/\//, "");
  } catch {
    return url;
  }
}

export async function AuditPanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true } });
  const website = b?.website.trim() ?? "";
  const rows = website ? await latestReports(businessId, "audit", 5) : [];
  const report = rows[0] ? readAuditReport(rows[0].data) : null;
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  const number = new Intl.NumberFormat(intlLocale(lang));

  const sevLabel: Record<Severity, string> = {
    error: t("Error", "Error"),
    warning: t("Advertencia", "Warning"),
    notice: t("Sugerencia", "Notice"),
  };
  const one = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 1 });

  // Tendencia: los últimos puntajes, del más viejo al más nuevo.
  const trend = rows
    .map((r) => ({ at: r.createdAt, score: readAuditReport(r.data)?.score }))
    .filter((r): r is { at: Date; score: number } => typeof r.score === "number")
    .reverse();
  const prev = trend.length > 1 ? trend[trend.length - 2].score : null;

  const header = (
    <div className="stack" style={{ gap: 4 }}>
      <h2>{t("Auditoría del sitio", "Site audit")}</h2>
      <p className="small muted">
        {t(
          "Revisamos tu página web como lo hace Google: títulos, descripciones, fotos, enlaces rotos, velocidad en el celular y más. Te decimos qué arreglar primero.",
          "We check your website the way Google does: titles, descriptions, photos, broken links, mobile speed and more. We tell you what to fix first.",
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
  const counts = (s: Severity) => report?.issues.filter((i) => i.severity === s).length ?? 0;
  const ps = report?.pagespeed;
  const home = report?.site.home || website;

  const issueCount = (i: Issue) => {
    if (i.id === "broken-links") return t(`${i.count} ${i.count === 1 ? "enlace" : "enlaces"}`, `${i.count} ${i.count === 1 ? "link" : "links"}`);
    if (["no-sitemap", "no-robots", "no-structured-data"].includes(i.id)) return t("Todo el sitio", "Whole site");
    return t(`${i.count} ${i.count === 1 ? "página" : "páginas"}`, `${i.count} ${i.count === 1 ? "page" : "pages"}`);
  };

  return (
    <section className="card" id="auditoria">
      {header}
      <p className="small muted">
        {t("Página:", "Website:")} <a href={website.startsWith("http") ? website : `https://${website}`} target="_blank" rel="noopener noreferrer">{website}</a>
        {rows[0] && <> · {t("Última revisión:", "Last check:")} {fmt.format(rows[0].createdAt)}</>}
      </p>
      <AuditButton action={action} has={rows.length > 0} />
      {report && (
        <HowToRead title={t("Cómo leer esto", "How to read this")}>
          <ul>
            <li>{t("La nota de 0 a 100 dice qué tan bien está armada tu página para Google: 90 o más es excelente, de 70 a 89 está bien, de 50 a 69 es regular y menos de 50 es urgente.", "The 0-100 score says how well your website is built for Google: 90 or more is excellent, 70 to 89 is good, 50 to 69 is fair and under 50 is urgent.")}</li>
            <li>{t("Arregla primero los errores (rojo), después las advertencias (amarillo). Las sugerencias son detalles.", "Fix the errors (red) first, then the warnings (yellow). Notices are details.")}</li>
            <li>{t("La velocidad importa sobre todo en el celular: si tu página tarda, la gente se va antes de verla.", "Speed matters most on phones: if your page is slow, people leave before seeing it.")}</li>
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
              {prev !== null && (
                <span className="small muted">
                  {report.score === prev
                    ? t(`Igual que la vez anterior (${prev}).`, `Same as last time (${prev}).`)
                    : report.score > prev
                      ? t(`Subió ${report.score - prev} desde la vez anterior (${prev}).`, `Up ${report.score - prev} since last time (${prev}).`)
                      : t(`Bajó ${prev - report.score} desde la vez anterior (${prev}).`, `Down ${prev - report.score} since last time (${prev}).`)}
                </span>
              )}
              {trend.length > 1 && (
                <div className="row" style={{ gap: 10, alignItems: "flex-end" }}>
                  <div className="seo-trend" role="img" aria-label={t(`Últimos puntajes: ${trend.map((x) => x.score).join(", ")}`, `Recent scores: ${trend.map((x) => x.score).join(", ")}`)}>
                    {trend.map((x, i) => (
                      <span key={i} className={i === trend.length - 1 ? "last" : ""} style={{ height: `${Math.max(8, x.score)}%` }} title={`${fmt.format(x.at)}: ${x.score}`} />
                    ))}
                  </div>
                  <span className="small muted">{trend.map((x) => x.score).join(" → ")}</span>
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
                {report.site.stoppedEarly && t(" · se paró por tiempo antes de leerlo todo", " · stopped early because of the time limit")}
              </span>
              <HowToRead title={t("¿Cómo se calcula la nota?", "How is the score calculated?")}>
                <p>
                  {t(
                    `Empezamos en 100 y cada problema resta puntos. Un error resta hasta ${AUDIT_WEIGHT.error}, una advertencia hasta ${AUDIT_WEIGHT.warning} y una sugerencia hasta ${AUDIT_WEIGHT.notice}. Si el problema está en una sola página resta la mitad; si está en todas las páginas revisadas (o es de todo el sitio, como el sitemap), resta completo. La nota nunca baja de 0.`,
                    `We start at 100 and each problem takes points off. An error takes up to ${AUDIT_WEIGHT.error}, a warning up to ${AUDIT_WEIGHT.warning} and a notice up to ${AUDIT_WEIGHT.notice}. If the problem is on just one page it takes half; if it's on every page checked (or affects the whole site, like the sitemap), it takes the full amount. The score never goes below 0.`,
                  )}
                </p>
                {report.issues.length > 0 && (
                  <>
                    <p>
                      <strong>{t(`Tu nota: 100 − lo que restó cada problema = ${report.score}`, `Your score: 100 − what each problem took off = ${report.score}`)}</strong>
                    </p>
                    <ul>
                      {auditDeductions(report.issues, report.pages.length).map((d) => (
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
            </div>
          </div>

          <div className="stack" style={{ gap: 10 }}>
            <span className="lbl">{t("Qué arreglar", "What to fix")}</span>
            {report.issues.length === 0 ? (
              <p className="note ok">{t("¡No encontramos problemas! Tu página está en muy buena forma.", "We didn't find any problems! Your website is in great shape.")}</p>
            ) : (
              <ShowMore hidden={report.issues.length - ISSUES_SHOWN} more={t(`Ver los ${report.issues.length} problemas`, `See all ${report.issues.length} problems`)}>
              <ul className="seo-issues">
                {report.issues.map((i, n) => {
                  const copy = ISSUE_TEXT[i.id][lang];
                  const broken = i.id === "broken-links" ? report.site.brokenLinks : [];
                  const shown = broken.length > 0 ? Math.min(broken.length, 10) : i.pages.length;
                  return (
                    <li key={i.id} className={["seo-issue", capClass(n, ISSUES_SHOWN)].filter(Boolean).join(" ")}>
                      <div className="row between">
                        <span className="row" style={{ gap: 8 }}>
                          <span className={`pill ${PILL[i.severity]}`}>{sevLabel[i.severity]}</span>
                          <strong>{copy.title}</strong>
                        </span>
                        <span className="small muted">{issueCount(i)}</span>
                      </div>
                      <span className="small">{copy.fix}</span>
                      {i.pages.length > 0 && (
                        <details>
                          <summary className="btn link" style={{ display: "inline-flex", minHeight: 0, padding: 0 }}>
                            {i.id === "broken-links" ? t("Ver enlaces", "See links") : t("Ver páginas", "See pages")}
                          </summary>
                          <ul className="seo-urls">
                            {broken.length > 0
                              ? broken.slice(0, 10).map((l) => (
                                  <li key={l.url}>
                                    <a href={l.url} target="_blank" rel="noopener noreferrer">{short(l.url, home)}</a> <span className="muted">({l.status})</span>
                                    {l.from.length > 0 && (
                                      <span className="muted">
                                        {" "}
                                        · {t("está en", "found on")} {l.from.map((f) => short(f, home)).join(", ")}
                                      </span>
                                    )}
                                  </li>
                                ))
                              : i.pages.map((u) => (
                                  <li key={u}>
                                    <a href={u} target="_blank" rel="noopener noreferrer">{short(u, home)}</a>
                                  </li>
                                ))}
                            {i.count > shown && <li className="muted">{t(`y ${i.count - shown} más`, `and ${i.count - shown} more`)}</li>}
                          </ul>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
              </ShowMore>
            )}
          </div>

          <p className="small muted">
            {t("¿Quieres ideas página por página, comparadas con los que ganan en Google? Ve a ", "Want page-by-page ideas, compared with the pages winning on Google? Go to ")}
            <a href="#paginas">{t("Revisión de tus páginas", "Your pages check")}</a>.
          </p>

          {report.pages.length > 0 && (
            <details>
              <summary className="btn link" style={{ display: "inline-flex", padding: 0 }}>
                {t(`Ver las ${report.pages.length} páginas revisadas`, `See the ${report.pages.length} pages checked`)}
              </summary>
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>{t("Página", "Page")}</th>
                      <th>{t("Estado", "Status")}</th>
                      <th>{t("Título (letras)", "Title (characters)")}</th>
                      <th>{t("Palabras", "Words")}</th>
                      <th>{t("Tiempo", "Time")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.pages.map((p, i) => {
                      const ok = !p.error && p.status >= 200 && p.status < 400;
                      return (
                        <tr key={`${p.url}-${i}`}>
                          <td className="small" style={{ wordBreak: "break-all" }}>
                            <a href={p.finalUrl || p.url} target="_blank" rel="noopener noreferrer">{short(p.finalUrl || p.url, home)}</a>
                            {p.title && <span className="muted" style={{ display: "block" }}>{p.title}</span>}
                          </td>
                          <td>
                            <span className={`pill ${ok ? "done" : "failed"}`}>{p.error ? t("Sin respuesta", "No response") : p.status}</span>
                          </td>
                          <td className="small">{ok ? p.title.length : "—"}</td>
                          <td className="small">{ok ? number.format(p.words) : "—"}</td>
                          <td className="small">{p.ms ? `${number.format(Math.round(p.ms) / 1000)} s` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {ctx && <AiPromptButton text={auditPrompt(ctx, report, lang)} />}
        </>
      )}
    </section>
  );
}
