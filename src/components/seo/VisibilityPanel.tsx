import { runVisibility, suggestVisibilityQuestions } from "@/app/actions-seo-ai";
import { VisibilityForm } from "@/components/seo/VisibilityForm";
import { TEXT_PROVIDERS, type TextProvider } from "@/lib/ai";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { latestReports } from "@/lib/seo/reports";
import { customerLang, questionsFromStudy, readVisibilityReport, sourceDomain, visibilityProviders, type VisibilityResult } from "@/lib/seo/visibility";
import { readStudy } from "@/lib/study-shape";
import { BUSINESS_TZ } from "@/lib/time";

const SHORT: Record<TextProvider, string> = { gemini: "Gemini", claude: "Claude", openai: "ChatGPT" };
const ORDER = TEXT_PROVIDERS.map((p) => p.id);

/** Estilo de la píldora según el puntaje. */
const tone = (score: number | null) => (score === null ? "draft" : score >= 60 ? "done" : score >= 25 ? "partial" : "failed");

export async function VisibilityPanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const [b, rows] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: { name: true, study: true, studyInput: true } }),
    latestReports(businessId, "ai", 5).catch(() => []),
  ]);
  if (!b) return null;
  const reports = rows.map((r) => ({ at: r.createdAt, report: readVisibilityReport(r.data) })).filter((r) => r.report);
  const last = reports[0]?.report ?? null;
  const lastAt = reports[0]?.at ?? null;
  const providers = visibilityProviders();
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeStyle: "short", timeZone: BUSINESS_TZ });
  const fmtDay = new Intl.DateTimeFormat(intlLocale(lang), { day: "numeric", month: "short", timeZone: BUSINESS_TZ });

  const study = readStudy(b.study);
  const initial = last?.questions.length ? last.questions : study ? questionsFromStudy(study, customerLang(b) ?? lang) : [];

  const resultProviders = last ? ORDER.filter((p) => last.results.some((r) => r.provider === p)) : [];
  const cell = (question: string, provider: TextProvider) => last?.results.find((r) => r.question === question && r.provider === provider);
  const trend = [...reports].reverse().filter((r) => r.report!.score !== null);

  const mark = (r: VisibilityResult | undefined) => {
    if (!r) return <span className="muted">—</span>;
    if (r.error) return <span className="vis-mark warn" title={r.error}>⚠ <span className="small">{t("Error", "Error")}</span></span>;
    if (r.mentioned)
      return (
        <span className="vis-mark yes" title={t("Te menciona", "Mentions you")}>
          ✓ {r.position ? <span className="small">#{r.position}</span> : null}
        </span>
      );
    return <span className="vis-mark no" title={t("No te menciona", "Doesn't mention you")}>✗</span>;
  };

  return (
    <section className="card">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{t("Visibilidad en IA", "AI visibility")}</h2>
        <p className="small muted">
          {t(
            "Le hacemos a ChatGPT, Gemini y Claude las preguntas que hacen tus clientes (con búsqueda en internet, como lo haría cualquier persona) y vemos si te recomiendan, en qué lugar y a quién recomiendan en tu lugar.",
            "We ask ChatGPT, Gemini and Claude the questions your customers ask (with web search, like anyone would) and check whether they recommend you, in what position, and who they recommend instead.",
          )}
        </p>
      </div>

      {!providers.length ? (
        <p className="note">
          {t(
            "Para esta revisión hace falta la clave de al menos una IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en la configuración del servidor.",
            "This check needs the key of at least one AI (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY) in the server settings.",
          )}
        </p>
      ) : (
        <VisibilityForm
          action={runVisibility.bind(null, businessId)}
          suggest={suggestVisibilityQuestions.bind(null, businessId)}
          initial={initial}
          providers={providers.map((p) => SHORT[p])}
        />
      )}

      {!last ? (
        <p className="small muted">{t("Todavía no has hecho ninguna revisión.", "You haven't run a check yet.")}</p>
      ) : (
        <>
          <div className="grid-2" style={{ gap: 18 }}>
            <div className="stack" style={{ gap: 8 }}>
              <span className="lbl">
                {t("Última revisión", "Last check")}: {lastAt ? fmt.format(lastAt) : "—"}
              </span>
              <div className="row" style={{ alignItems: "baseline", gap: 10 }}>
                <strong className="vis-score">{last.score === null ? "—" : `${last.score}%`}</strong>
                <span className="small muted">{t("de las respuestas te mencionan", "of the answers mention you")}</span>
              </div>
              <span className="meter" aria-hidden><span style={{ width: `${Math.max(0, Math.min(100, last.score ?? 0))}%` }} /></span>
              <div className="tags" style={{ marginTop: 6 }}>
                {resultProviders.map((p) => {
                  const s = last.byProvider[p];
                  return (
                    <span key={p} className={`pill ${tone(s?.score ?? null)}`}>
                      {SHORT[p]}: {s?.score === null || !s ? "—" : `${s.score}%`}
                      {s && s.total ? <span style={{ fontWeight: 500 }}>({s.mentioned}/{s.total})</span> : null}
                    </span>
                  );
                })}
              </div>
            </div>
            {trend.length > 1 && (
              <div className="stack" style={{ gap: 8 }}>
                <span className="lbl">{t("Cómo has ido (últimas revisiones)", "How you're doing (recent checks)")}</span>
                <div className="vis-trend" role="img" aria-label={trend.map((r) => `${fmtDay.format(r.at)}: ${r.report!.score}%`).join(", ")}>
                  {trend.map((r, i) => (
                    <div key={i} className="vis-trend-col">
                      <span className="small">{r.report!.score}%</span>
                      <span className="vis-trend-bar"><span style={{ height: `${Math.max(3, r.report!.score ?? 0)}%` }} /></span>
                      <span className="small muted">{fmtDay.format(r.at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Pregunta", "Question")}</th>
                  {resultProviders.map((p) => <th key={p} style={{ textAlign: "center" }}>{SHORT[p]}</th>)}
                </tr>
              </thead>
              <tbody>
                {last.questions.map((q, i) => (
                  <tr key={i}>
                    <td className="small">{q}</td>
                    {resultProviders.map((p) => <td key={p} style={{ textAlign: "center" }}>{mark(cell(q, p))}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            {t(
              "✓ te menciona (#lugar entre los negocios que nombra) · ✗ no te menciona · ⚠ esa IA falló. Las respuestas de las IAs cambian de un día a otro y según quién pregunta: tómalo como una muestra, no como una garantía.",
              "✓ mentions you (#position among the businesses it names) · ✗ doesn't mention you · ⚠ that AI failed. AI answers change from day to day and depending on who asks: treat this as a sample, not a guarantee.",
            )}
          </p>

          <div className="grid-2" style={{ gap: 18 }}>
            <div className="stack" style={{ gap: 8 }}>
              <span className="lbl">{t("A quién recomiendan las IAs", "Who the AIs recommend")}</span>
              {last.topCompetitors.length ? (
                <ol className="study-list">
                  {last.topCompetitors.map((c, i) => (
                    <li key={i}>
                      <strong>{c.name}</strong>{" "}
                      <span className="small muted">
                        {t(`· en ${c.count} respuesta${c.count === 1 ? "" : "s"}`, `· in ${c.count} answer${c.count === 1 ? "" : "s"}`)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="small muted">{t("Las respuestas no nombraron otros negocios.", "The answers didn't name other businesses.")}</p>
              )}
              {last.topDomains.length > 0 && (
                <>
                  <span className="lbl" style={{ marginTop: 8 }}>{t("Páginas que más citan", "Websites they cite most")}</span>
                  <div className="tags">
                    {last.topDomains.map((d) => <span key={d.domain} className="tag">{d.domain} · {d.count}</span>)}
                  </div>
                </>
              )}
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <span className="lbl">{t("Qué puedes hacer para aparecer más", "What you can do to show up more")}</span>
              {last.recommendations.length ? (
                <ul className="study-list">
                  {last.recommendations.map((r, i) => (
                    <li key={i}>
                      <strong>{r.title}</strong>
                      {r.detail ? <span className="small" style={{ display: "block" }}>{r.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small muted">{t("No hay recomendaciones en esta revisión.", "There are no recommendations in this check.")}</p>
              )}
            </div>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <span className="lbl">{t("Lo que contestó cada IA", "What each AI answered")}</span>
            {last.results.map((r, i) => (
              <details key={i} className="vis-answer">
                <summary className="row between" style={{ cursor: "pointer", flexWrap: "nowrap" }}>
                  <span className="small">
                    <strong>{SHORT[r.provider]}</strong> · {r.question}
                  </span>
                  {mark(r)}
                </summary>
                <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                  {r.error ? (
                    <p className="note error">{r.error}</p>
                  ) : (
                    <p className="small vis-answer-text">{r.answer || "—"}</p>
                  )}
                  {r.competitors.length > 0 && (
                    <span className="small muted">
                      {t("Negocios que nombra:", "Businesses it names:")} {r.competitors.join(", ")}
                    </span>
                  )}
                  {r.sources.length > 0 && (
                    <ul className="study-list small">
                      {r.sources.map((s, j) => (
                        <li key={j}>
                          <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || sourceDomain(s) || s.url}</a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
