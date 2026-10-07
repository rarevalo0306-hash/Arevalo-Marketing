import { runVisibility, suggestVisibilityQuestions } from "@/app/actions-seo-ai";
import { capClass, Fold } from "@/components/seo/Fold";
import { ShowMore } from "@/components/seo/ShowMore";
import { VisibilityForm } from "@/components/seo/VisibilityForm";
import { TEXT_PROVIDERS, type TextProvider } from "@/lib/ai";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { latestReports } from "@/lib/seo/reports";
import { HowToRead } from "@/components/seo/HowToRead";
import {
  customerLang,
  errorKind,
  explainError,
  type MentionSentiment,
  providerErrors,
  questionsFromStudy,
  readVisibilityReport,
  sentimentText,
  sourceDomain,
  visibilityProviders,
  type VisibilityResult,
} from "@/lib/seo/visibility";
import { readStudy } from "@/lib/study-shape";
import { BUSINESS_TZ } from "@/lib/time";

const SHORT: Record<TextProvider, string> = { gemini: "Gemini", claude: "Claude", openai: "ChatGPT" };
const ORDER = TEXT_PROVIDERS.map((p) => p.id);
/** Cuántos se ven antes de «Ver todos»: negocios recomendados, páginas citadas y consejos. */
const COMP_SHOWN = 5;
const DOMAINS_SHOWN = 6;
const RECS_SHOWN = 3;

/** Estilo de la píldora según el tono de la mención. */
const TONE_PILL: Record<MentionSentiment, string> = { positiva: "done", neutral: "scheduled", negativa: "failed" };

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

  const why = (r: VisibilityResult) => {
    const x = explainError(r.provider, r.error ?? "");
    return lang === "en" ? x.en : x.es;
  };
  const errors = last ? providerErrors(last.results) : [];
  const toneLabel = (s: MentionSentiment) => ({ positiva: t("Positiva", "Positive"), neutral: t("Neutral", "Neutral"), negativa: t("Negativa", "Negative") })[s];
  const badge = (r: VisibilityResult) =>
    r.sentiment ? (
      <span className={`pill ${TONE_PILL[r.sentiment.sentiment]}`} title={r.sentiment.reason || undefined}>
        {toneLabel(r.sentiment.sentiment)}
      </span>
    ) : null;
  const sent = last?.sentiment;
  const mentionedCount = last ? last.results.filter((r) => r.mentioned && !r.error).length : 0;
  const mark = (r: VisibilityResult | undefined) => {
    if (!r) return <span className="muted">—</span>;
    if (r.error)
      return (
        <span className="vis-mark warn" title={why(r)}>
          ⚠ <span className="small">{errorKind(r.error) === "limit" ? t("Límite", "Limit") : t("No contestó", "No answer")}</span>
        </span>
      );
    if (r.mentioned)
      return (
        <span className="vis-mark yes" title={t("Te menciona", "Mentions you")}>
          ✓ {r.position ? <span className="small">#{r.position}</span> : null}
        </span>
      );
    return <span className="vis-mark no" title={t("No te menciona", "Doesn't mention you")}>✗</span>;
  };

  return (
    <section className="card" id="ia">
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
          collapsed={Boolean(last)}
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
                    <span key={p} className={`pill ${s && s.total === 0 ? "partial" : tone(s?.score ?? null)}`} title={s && s.errors ? t(`${s.errors} pregunta(s) sin respuesta`, `${s.errors} question(s) without an answer`) : undefined}>
                      {SHORT[p]}: {!s || s.total === 0 ? t("no se pudo revisar", "couldn't be checked") : s.score === null ? "—" : `${s.score}%`}
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

          {sent && mentionedCount > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <span className="lbl">{t("Cómo hablan de ti", "How they talk about you")}</span>
              {sent.status === "ok" && sent.total > 0 ? (
                <>
                  <p className="small" style={{ margin: 0 }}>
                    <strong>{lang === "en" ? sentimentText(sent).en : sentimentText(sent).es}</strong>
                  </p>
                  <div className="tags">
                    {(["positiva", "neutral", "negativa"] as const).map((k) =>
                      sent[k] ? (
                        <span key={k} className={`pill ${TONE_PILL[k]}`}>
                          {toneLabel(k)}: {sent[k]}
                        </span>
                      ) : null,
                    )}
                  </div>
                  {sent.attributes.length > 0 && (
                    <>
                      <span className="lbl" style={{ marginTop: 4 }}>{t("Lo que dicen de ti", "What they say about you")}</span>
                      <div className="tags">
                        {sent.attributes.map((a) => (
                          <span key={a.name} className="tag" title={t(`En ${a.count} respuesta(s)`, `In ${a.count} answer(s)`)}>
                            {a.name} · {a.count}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                  {sent.negativa > 0 && (
                    <p className="note" style={{ margin: 0 }}>
                      {t(
                        "Alguna IA habla mal de ti: abre esa respuesta abajo para ver la cita. Casi siempre sale de reseñas o quejas en internet; responde esas reseñas con calma y pide reseñas a tus clientes contentos.",
                        "An AI says something negative about you: open that answer below to see the quote. It usually comes from reviews or complaints online; reply to those reviews calmly and ask happy customers for reviews.",
                      )}
                    </p>
                  )}
                </>
              ) : (
                <p className="small muted" style={{ margin: 0 }}>
                  {sent.status === "skipped"
                    ? t("No alcanzó el tiempo para leer el tono de las menciones en esta revisión. Vuelve a revisar para verlo.", "There wasn't time to read the tone of the mentions in this check. Run it again to see it.")
                    : t("No se pudo leer el tono de las menciones en esta revisión (la IA no contestó). El resto de la revisión sí está completo; vuelve a revisar para verlo.", "We couldn't read the tone of the mentions in this check (the AI didn't answer). The rest of the check is complete; run it again to see it.")}
                </p>
              )}
            </div>
          )}

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
          {errors.length > 0 && (
            <div className="note">
              {errors.map((e) => (
                <span key={e.provider} style={{ display: "block" }}>
                  ⚠{" "}
                  {e.failed === e.total
                    ? t(`${SHORT[e.provider]} no se pudo revisar (no contestó ninguna pregunta): `, `${SHORT[e.provider]} couldn't be checked (it didn't answer any question): `)
                    : t(`${SHORT[e.provider]} no contestó ${e.failed} de ${e.total} preguntas: `, `${SHORT[e.provider]} didn't answer ${e.failed} of ${e.total} questions: `)}
                  {lang === "en" ? e.reason.en : e.reason.es}
                </span>
              ))}
              <span className="small" style={{ display: "block", marginTop: 4 }}>
                {t("Esas preguntas no cuentan en tu porcentaje (ni a favor ni en contra).", "Those questions don't count in your percentage (neither for nor against you).")}
              </span>
            </div>
          )}
          <HowToRead title={t("Cómo leer esto", "How to read this")}>
            <p>
              {t(
                "✓ te menciona (#lugar entre los negocios que nombra) · ✗ no te menciona · ⚠ esa IA no contestó (pasa el dedo o el mouse para ver por qué). Las respuestas de las IAs cambian de un día a otro y según quién pregunta: tómalo como una muestra, no como una garantía.",
                "✓ mentions you (#position among the businesses it names) · ✗ doesn't mention you · ⚠ that AI didn't answer (hover or tap to see why). AI answers change from day to day and depending on who asks: treat this as a sample, not a guarantee.",
              )}
            </p>
            <p>
              {t(
                "El porcentaje es en cuántas respuestas te nombran las IAs cuando un cliente pregunta por lo que vendes. 60 % o más es muy bueno; menos de 25 % quiere decir que casi nunca te recomiendan.",
                "The percentage is how many answers name you when a customer asks the AIs for what you sell. 60% or more is very good; under 25% means they almost never recommend you.",
              )}
            </p>
            <p>
              {t(
                "«#1» quiere decir que fuiste el primer negocio que nombró. «Páginas que más citan» son los sitios de donde sacan la información: estar bien en esos sitios (directorios, reseñas) ayuda a que te nombren.",
                "“#1” means you were the first business it named. “Websites they cite most” are where they get their information: being listed well on those sites (directories, reviews) helps them name you.",
              )}
            </p>
            <p>
              {t(
                "«Cómo hablan de ti» dice si cada IA que te nombra lo hace bien (positiva: te recomienda o te elogia), solo te lista (neutral) o habla mal (negativa: quejas o advertencias). «Lo que dicen de ti» son las cualidades que te asocian, como precio o garantía: si no ves las que te importan, ponlas claras en tu página y en tu Perfil de Google.",
                "“How they talk about you” says whether each AI that names you does it well (positive: it recommends or praises you), just lists you (neutral) or speaks badly (negative: complaints or warnings). “What they say about you” are the qualities they link to you, like price or warranty: if the ones you care about are missing, make them clear on your website and your Google Business Profile.",
              )}
            </p>
          </HowToRead>

          <div className="grid-2" style={{ gap: 18 }}>
            <div className="stack" style={{ gap: 8 }}>
              <span className="lbl">{t("A quién recomiendan las IAs", "Who the AIs recommend")}</span>
              {last.topCompetitors.length ? (
                <ShowMore
                  hidden={last.topCompetitors.length - COMP_SHOWN}
                  more={t(`Ver los ${last.topCompetitors.length} negocios`, `See all ${last.topCompetitors.length} businesses`)}
                >
                <ol className="study-list">
                  {last.topCompetitors.map((c, i) => (
                    <li key={i} className={capClass(i, COMP_SHOWN)}>
                      <strong>{c.name}</strong>{" "}
                      <span className="small muted">
                        {t(`· en ${c.count} respuesta${c.count === 1 ? "" : "s"}`, `· in ${c.count} answer${c.count === 1 ? "" : "s"}`)}
                      </span>
                    </li>
                  ))}
                </ol>
                </ShowMore>
              ) : (
                <p className="small muted">{t("Las respuestas no nombraron otros negocios.", "The answers didn't name other businesses.")}</p>
              )}
              {last.topDomains.length > 0 && (
                <>
                  <span className="lbl" style={{ marginTop: 8 }}>{t("Páginas que más citan", "Websites they cite most")}</span>
                  <ShowMore
                    hidden={last.topDomains.length - DOMAINS_SHOWN}
                    more={t(`Ver las ${last.topDomains.length} páginas`, `See all ${last.topDomains.length} websites`)}
                  >
                    <div className="tags">
                      {last.topDomains.map((d, i) => (
                        <span key={d.domain} className={["tag", capClass(i, DOMAINS_SHOWN)].filter(Boolean).join(" ")}>
                          {d.domain} · {d.count}
                        </span>
                      ))}
                    </div>
                  </ShowMore>
                </>
              )}
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <span className="lbl">{t("Qué puedes hacer para aparecer más", "What you can do to show up more")}</span>
              {last.recommendations.length ? (
                <ShowMore
                  hidden={last.recommendations.length - RECS_SHOWN}
                  more={t(`Ver los ${last.recommendations.length} consejos`, `See all ${last.recommendations.length} tips`)}
                >
                <ul className="study-list">
                  {last.recommendations.map((r, i) => (
                    <li key={i} className={capClass(i, RECS_SHOWN)}>
                      <strong>{r.title}</strong>
                      {r.detail ? <span className="small" style={{ display: "block" }}>{r.detail}</span> : null}
                    </li>
                  ))}
                </ul>
                </ShowMore>
              ) : (
                <p className="small muted">{t("No hay recomendaciones en esta revisión.", "There are no recommendations in this check.")}</p>
              )}
            </div>
          </div>

          <Fold
            summary={t(`Lo que contestó cada IA (${last.results.length} respuestas)`, `What each AI answered (${last.results.length} answers)`)}
            note={t("El texto de cada respuesta, los negocios que nombra y de dónde sacó la información", "Each answer's text, the businesses it names and where it got the information")}
          >
            {last.results.map((r, i) => (
              <details key={i} className="vis-answer">
                <summary className="row between" style={{ cursor: "pointer", flexWrap: "nowrap" }}>
                  <span className="small">
                    <strong>{SHORT[r.provider]}</strong> · {r.question}
                  </span>
                  <span className="row" style={{ gap: 6, flexWrap: "nowrap", flexShrink: 0 }}>
                    {badge(r)}
                    {mark(r)}
                  </span>
                </summary>
                <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                  {r.error ? (
                    <p className="note error">
                      {why(r)}
                      {why(r) !== r.error && <span className="small" style={{ display: "block", fontWeight: 400, marginTop: 4 }}>{t("Mensaje original:", "Original message:")} {r.error}</span>}
                    </p>
                  ) : (
                    <>
                      {r.sentiment && (
                        <div className="stack" style={{ gap: 4 }}>
                          {r.sentiment.quote && (
                            <blockquote className="small" style={{ margin: 0, paddingLeft: 10, borderLeft: "3px solid var(--line-strong)", fontStyle: "italic", overflowWrap: "anywhere" }}>
                              «{r.sentiment.quote}»
                            </blockquote>
                          )}
                          <span className="small">
                            {badge(r)} {r.sentiment.reason}
                          </span>
                          {r.sentiment.attributes.length > 0 && (
                            <span className="small muted">
                              {t("Te asocia con:", "Links you with:")} {r.sentiment.attributes.join(", ")}
                            </span>
                          )}
                        </div>
                      )}
                      <p className="small vis-answer-text">{r.answer || "—"}</p>
                    </>
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
          </Fold>
        </>
      )}
    </section>
  );
}
