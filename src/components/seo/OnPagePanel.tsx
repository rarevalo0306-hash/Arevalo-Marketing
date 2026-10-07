import Link from "next/link";
import { runOnPage, suggestPageFix } from "@/app/actions-seo-onpage";
import { AiPromptButton } from "@/components/seo/AiPromptButton";
import { CopyButton } from "@/components/seo/ArticleTools";
import { extra, Fold } from "@/components/seo/Fold";
import { HowToRead } from "@/components/seo/HowToRead";
import { ShowMore } from "@/components/seo/ShowMore";
import { ScoreDial } from "@/components/seo/ArticleView";
import { ScoreVerdict } from "@/components/seo/ScoreVerdict";
import { KeywordPicker, OnPageRunButton, RecheckButton, SuggestButton } from "@/components/seo/OnPageTools";
import { aiEnabled, TEXT_PROVIDERS } from "@/lib/ai";
import { intlLocale, type T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { db } from "@/lib/db";
import { readAuditReport } from "@/lib/seo/audit";
import { dataForSeoEnabled, readTrackedKeywords, readZones, zoneLabel } from "@/lib/seo/dataforseo";
import { costText, uniqueKeywords } from "@/lib/seo/keywords";
import {
  candidatePages,
  type IdeaCategory,
  type IdeaPriority,
  type KeywordSource,
  ONPAGE_COST_PER_PAGE,
  ONPAGE_MAX_PAGES,
  ONPAGE_WEIGHTS,
  type OnPageIdea,
  type OnPagePage,
  pathOf,
  readOnPageReport,
  sortPages,
  topIdeas,
  urlKey,
} from "@/lib/seo/onpage";
import { loadPromptContext } from "@/lib/seo/prompt-context";
import { onPagePrompt } from "@/lib/seo/prompts";
import { latestReports } from "@/lib/seo/reports";
import { BUSINESS_TZ } from "@/lib/time";
import { readStudy, topKeywords } from "@/lib/study-shape";

const PRIORITIES: IdeaPriority[] = ["alta", "media", "baja"];
/** Cuántas páginas se ven antes de «Ver todas» (las de «Empieza por aquí» siempre se ven). */
const PAGES_SHOWN = 3;

/** id de la tarjeta de una página (para los enlaces de "Empieza por aquí"). */
const anchor = (url: string) => `op-${urlKey(url).replace(/[^a-z0-9]+/gi, "-").slice(0, 120)}`;

const sourceLabel = (s: KeywordSource | null, t: T) =>
  s === "gsc"
    ? t("de Search Console", "from Search Console")
    : s === "rank"
      ? t("de tus posiciones", "from your rankings")
      : s === "match"
        ? t("parecido al título", "similar to the title")
        : s === "owner"
          ? t("elegida por ti", "chosen by you")
          : "";

const categoryLabel = (c: IdeaCategory, t: T) =>
  ({
    contenido: t("Contenido", "Content"),
    titulos: t("Títulos", "Titles"),
    preguntas: t("Preguntas", "Questions"),
    enlaces: t("Enlaces", "Links"),
    tecnico: t("Técnico", "Technical"),
    competencia: t("Competencia", "Competition"),
  })[c];

const CATEGORY_ICON: Record<IdeaCategory, string> = { contenido: "¶", titulos: "H", preguntas: "?", enlaces: "↗", tecnico: "⚙", competencia: "★" };

const priorityLabel = (p: IdeaPriority, t: T) => ({ alta: t("Prioridad alta", "High priority"), media: t("Prioridad media", "Medium priority"), baja: t("Prioridad baja", "Low priority") })[p];
const PRIORITY_PILL: Record<IdeaPriority, string> = { alta: "failed", media: "partial", baja: "scheduled" };

function IdeaItem({ idea, t }: { idea: OnPageIdea; t: T }) {
  return (
    <li className="op-idea">
      <span className={`op-cat op-cat-${idea.category}`} title={categoryLabel(idea.category, t)}>
        <span aria-hidden="true">{CATEGORY_ICON[idea.category]}</span> {categoryLabel(idea.category, t)}
      </span>
      <span>{t(idea.es, idea.en)}</span>
      {idea.detail && idea.detail.length > 0 && (
        <ul className="op-detail">
          {idea.detail.map((d) => <li key={d}>{d}</li>)}
        </ul>
      )}
    </li>
  );
}

/** Revisión de tus páginas: la palabra clave de cada página, cómo se compara con los que ganan y qué arreglar primero. */
export async function OnPagePanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const header = (
    <div className="stack" style={{ gap: 4 }}>
      <h2>{t("Revisión de tus páginas", "Your pages check")}</h2>
      <p className="small muted">
        {t(
          "Para cada página importante de tu sitio elegimos la búsqueda por la que debería salir, la comparamos con las que ganan en Google y te decimos qué cambiar, empezando por lo que más ayuda.",
          "For each important page on your site we pick the search it should show up for, compare it with the pages winning on Google and tell you what to change, starting with what helps most.",
        )}
      </p>
    </div>
  );
  const shell = (body: React.ReactNode) => (
    <section className="card" id="paginas">
      {header}
      {body}
    </section>
  );

  if (!dataForSeoEnabled())
    return shell(
      <p className="note">
        {t(
          "Esta revisión usa DataForSEO, el servicio que nos trae los resultados reales de Google. Todavía no está conectado: pídele a quien instaló la app que lo conecte (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).",
          "This check uses DataForSEO, the service that brings us Google's real results. It isn't connected yet: ask whoever set up the app to connect it (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).",
        )}
      </p>,
    );

  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, seoKeywords: true, study: true },
  });
  if (!b) return null;
  if (!b.website.trim())
    return shell(
      <p className="note">
        {t("Primero agrega la dirección de tu página web en ", "First add your website address in ")}
        <Link href={`/b/${businessId}/negocio`}>{t("Ajustes del negocio", "Business settings")}</Link>.
      </p>,
    );
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  if (!zones.length)
    return shell(
      <div className="note stack" style={{ gap: 8 }}>
        <span>
          {t(
            "Para comparar tus páginas con las que salen primero en Google, necesitamos saber dónde buscan tus clientes (tu país o tu ciudad): Google muestra resultados distintos en cada lugar.",
            "To compare your pages with the ones ranking first on Google, we need to know where your customers search (your country or city): Google shows different results in each place.",
          )}
        </span>
        <span>
          <a href="#dataforseo" style={{ fontWeight: 700 }}>
            {t("Elegir mi zona en «⚙ Ajustes» →", "Pick my area in “⚙ Settings” →")}
          </a>
        </span>
      </div>,
    );

  const [auditRows, rows] = await Promise.all([latestReports(businessId, "audit", 1), latestReports(businessId, "onpage", 1)]);
  const audit = auditRows[0] ? readAuditReport(auditRows[0].data) : null;
  if (!audit)
    return shell(
      <p className="note">
        {t("Primero revisa tu sitio con el botón «Revisar mi página» en la ", "First check your site with the \"Check my website\" button in the ")}
        <a href="#auditoria">{t("Auditoría del sitio", "Site audit")}</a>
        {t(". Es gratis y de ahí salen las páginas a revisar.", ". It's free, and that's where the pages to check come from.")}
      </p>,
    );

  const report = rows[0] ? readOnPageReport(rows[0].data) : null;
  const planned = Math.max(1, Math.min(ONPAGE_MAX_PAGES, candidatePages(audit).length));
  const action = runOnPage.bind(null, businessId);
  const study = readStudy(b.study);
  const options = uniqueKeywords([...readTrackedKeywords(b.seoKeywords), ...(study ? topKeywords(study, 20) : [])], 60);
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  const number = new Intl.NumberFormat(intlLocale(lang));
  const ai = aiEnabled();

  const runButton = <OnPageRunButton action={action} pages={planned} estimate={planned * ONPAGE_COST_PER_PAGE} has={!!report} />;
  if (!report)
    return shell(
      <>
        {runButton}
        <p className="small muted">
          {t(
            "Todavía no has revisado tus páginas. Usamos las páginas de tu última auditoría y tus palabras clave.",
            "You haven't checked your pages yet. We use the pages from your last audit and your keywords.",
          )}
        </p>
      </>,
    );

  const pages = sortPages(report.pages);
  const scored = pages.filter((p) => p.score !== null && !p.needsRecheck);
  const avg = scored.length ? Math.round(scored.reduce((s, p) => s + (p.score ?? 0), 0) / scored.length) : null;
  const high = scored.reduce((s, p) => s + p.ideas.filter((i) => i.priority === "alta").length, 0);
  const start = topIdeas(scored);
  const ctx = scored.some((p) => p.ideas.length > 0 || p.suggestion) ? await loadPromptContext(businessId) : null;
  const shortTitle = (p: Pick<OnPagePage, "url" | "title">) => p.title.trim() || pathOf(p.url);
  // Las páginas que pasan del tope quedan en «Ver todas», salvo las que nombra «Empieza por aquí» (sus enlaces bajan a ellas).
  const startUrls = new Set(start.map((x) => x.url));
  const folded = new Set(pages.filter((p, i) => i >= PAGES_SHOWN && !startUrls.has(p.url)).map((p) => p.url));

  return shell(
    <>
      <HowToRead title={t("Cómo leer esto", "How to read this")}>
        <ul>
          <li>{t("Cada página de tu sitio tiene una búsqueda por la que debería salir. La nota de 0 a 100 compara tu página con las que salen primero en Google para esa búsqueda: 90 o más es excelente, de 70 a 89 está bien, de 50 a 69 es regular y menos de 50 es urgente.", "Each page on your site has a search it should show up for. The 0-100 score compares your page with the ones ranking first on Google for that search: 90 or more is excellent, 70 to 89 is good, 50 to 69 is fair and under 50 is urgent.")}</li>
          <li>{t("Los cambios van en orden: arriba los que más ayudan. Empieza por el título y el primer párrafo.", "Changes are in order: the most helpful first. Start with the title and the first paragraph.")}</li>
          <li>{t("Si la búsqueda elegida no es la correcta, cámbiala antes de seguir los consejos.", "If the chosen search isn't the right one, change it before following the advice.")}</li>
        </ul>
      </HowToRead>
      <p className="small muted">
        {t("Última revisión:", "Last check:")} {fmt.format(new Date(report.createdAt))} · {zoneLabel(report.zone.name) || report.zone.name} · DataForSEO {costText(report.cost)}
        {report.stoppedEarly && t(" · se acabó el tiempo antes de revisar todas", " · ran out of time before checking them all")}
      </p>
      {runButton}

      {scored.length > 0 && (
        <div className="seo-tiles">
          <div className="seo-tile">
            <span className="small muted">{t("Puntaje promedio", "Average score")}</span>
            <strong>{avg ?? "—"}</strong>
            <span className="small muted">{t(`de ${scored.length} ${scored.length === 1 ? "página" : "páginas"}`, `across ${scored.length} ${scored.length === 1 ? "page" : "pages"}`)}</span>
          </div>
          <div className="seo-tile">
            <span className="small muted">{t("Ideas urgentes", "Urgent ideas")}</span>
            <strong>{high}</strong>
            <span className="small muted">{t("de prioridad alta", "high priority")}</span>
          </div>
        </div>
      )}
      {avg !== null && <ScoreVerdict score={avg} lang={lang} what={t("El promedio de tus páginas", "Your pages' average")} />}
      {scored.length > 0 && (
        <HowToRead title={t("¿Cómo se calcula la nota?", "How is the score calculated?")}>
          <p>
            {t(
              "Cada página empieza en 0 y gana puntos por hacer lo mismo que las páginas que salen primero en Google para su búsqueda. Lo que no se puede medir da los puntos completos. Salir o no en Google no suma: eso es el resultado.",
              "Each page starts at 0 and earns points for doing what the pages ranking first on Google do for its search. Anything we can't measure gets full points. Ranking or not on Google doesn't add points: that's the result.",
            )}
          </p>
          <ul>
            {(
              [
                ["titleKeyword", t("La búsqueda en el título", "The search in the title")],
                ["titleLength", t("Título de 30 a 60 letras", "Title of 30-60 characters")],
                ["h1", t("La búsqueda en el título grande (H1)", "The search in the main heading (H1)")],
                ["meta", t("Descripción para Google (largo y búsqueda)", "Google description (length and search)")],
                ["url", t("La búsqueda en la dirección", "The search in the URL")],
                ["intro", t("La búsqueda en las primeras 100 palabras", "The search in the first 100 words")],
                ["h2", t("La búsqueda en un subtítulo", "The search in a subheading")],
                ["length", t("Texto tan largo como el de los que ganan", "Text as long as the winners'")],
                ["topics", t("Los temas que tocan los que ganan", "The topics the winners cover")],
                ["questions", t("Las preguntas que hace la gente", "The questions people ask")],
                ["terms", t("Palabras relacionadas", "Related words")],
                ["images", t("Fotos con descripción", "Photos with a description")],
                ["inbound", t("Enlaces desde tus otras páginas", "Links from your other pages")],
                ["outbound", t("Enlaces hacia tus otras páginas", "Links to your other pages")],
                ["schema", t("Datos del negocio para Google (inicio o contacto)", "Business details for Google (home or contact)")],
                ["speed", t("Velocidad en el celular", "Speed on mobile")],
              ] as [keyof typeof ONPAGE_WEIGHTS, string][]
            ).map(([id, label]) => (
              <li key={id}>
                {label}: <strong>{ONPAGE_WEIGHTS[id]}</strong> {t("puntos", "points")}
              </li>
            ))}
          </ul>
          <p className="muted">{t("Todo suma 100. El promedio de arriba es el de las páginas que se pudieron revisar.", "It all adds up to 100. The average above covers the pages we could check.")}</p>
        </HowToRead>
      )}

      {start.length > 0 && (
        <div className="stack op-start">
          <span className="lbl">{t("Empieza por aquí", "Start here")}</span>
          <ol className="op-start-list">
            {start.map((x) => (
              <li key={`${x.url}-${x.idea.id}`}>
                <a href={`#${anchor(x.url)}`} className="small" style={{ fontWeight: 700 }}>{shortTitle(x)}</a>
                <span>{t(x.idea.es, x.idea.en)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <ShowMore hidden={folded.size} more={t(`Ver las ${pages.length} páginas`, `See all ${pages.length} pages`)}>
      <div className="stack" style={{ gap: 14 }}>
        {pages.map((p) => {
          const provider = p.suggestion ? TEXT_PROVIDERS.find((x) => x.id === p.suggestion?.provider)?.name : undefined;
          const s = p.stats;
          return (
            <article key={p.url} className={folded.has(p.url) ? `op-page ${extra}` : "op-page"} id={anchor(p.url)}>
              <div className="op-head">
                {p.score !== null && !p.needsRecheck ? <ScoreDial score={p.score} size={56} /> : <span className="wr-dial-empty op-dial-empty">—</span>}
                <div className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                  <strong className="op-title">{shortTitle(p)}</strong>
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="small op-url">{p.url.replace(/^https?:\/\/(www\.)?/, "")}</a>
                </div>
              </div>

              <div className="op-kw">
                {p.keyword ? (
                  <>
                    <span className="tag op-kw-tag">“{p.keyword}”</span>
                    <span className="small muted">{sourceLabel(p.keywordSource, t)}</span>
                  </>
                ) : (
                  <span className="tag wr-unused">{t("sin palabra clave", "no keyword")}</span>
                )}
                <KeywordPicker businessId={businessId} url={p.url} current={p.keyword} options={options} />
              </div>

              {p.needsRecheck && (
                <p className="note">
                  {p.keyword
                    ? t("Cambiaste la palabra clave: vuelve a revisar esta página para ver sus ideas.", "You changed the keyword: check this page again to see its ideas.")
                    : t("La próxima revisión elige la palabra clave sola.", "The next check will pick the keyword automatically.")}
                </p>
              )}
              {!p.keyword && !p.needsRecheck && !p.error && (
                <p className="small muted">
                  {t(
                    "No encontramos una búsqueda que encaje con esta página. Elige una para compararla con los que ganan en Google.",
                    "We didn't find a search that fits this page. Pick one to compare it with the winners on Google.",
                  )}
                </p>
              )}
              {p.error && (
                <p className="note error">
                  {p.skipped ? t("No se revisó: se acabó el tiempo. ", "Not checked: we ran out of time. ") : t("No se pudo revisar: ", "Couldn't check it: ")}
                  {!p.skipped && t(p.error.es, p.error.en)}
                </p>
              )}

              {!p.needsRecheck && p.score !== null && p.ideas.length === 0 && (
                <p className="note ok">{t("¡Esta página ya cumple todo lo que revisamos!", "This page already ticks every box we check!")}</p>
              )}
              {!p.needsRecheck &&
                PRIORITIES.map((prio) => {
                  const list = p.ideas.filter((i) => i.priority === prio);
                  if (!list.length) return null;
                  // Las de prioridad baja quedan cerradas: primero lo urgente.
                  if (prio === "baja")
                    return (
                      <Fold key={prio} inline summary={t(`${list.length} ${list.length === 1 ? "idea" : "ideas"} de prioridad baja`, `${list.length} low-priority ${list.length === 1 ? "idea" : "ideas"}`)}>
                        <ul className="op-ideas">
                          {list.map((idea, i) => <IdeaItem key={`${idea.id}-${i}`} idea={idea} t={t} />)}
                        </ul>
                      </Fold>
                    );
                  return (
                    <div key={prio} className="stack" style={{ gap: 6 }}>
                      <span className={`pill ${PRIORITY_PILL[prio]}`} style={{ alignSelf: "flex-start" }}>{priorityLabel(prio, t)}</span>
                      <ul className="op-ideas">
                        {list.map((idea, i) => <IdeaItem key={`${idea.id}-${i}`} idea={idea} t={t} />)}
                      </ul>
                    </div>
                  );
                })}

              {s && !p.needsRecheck && (
                <p className="small muted op-stats">
                  {[
                    s.targetWords ? t(`${number.format(s.words)} palabras (los que ganan: ~${number.format(s.targetWords)})`, `${number.format(s.words)} words (winners: ~${number.format(s.targetWords)})`) : t(`${number.format(s.words)} palabras`, `${number.format(s.words)} words`),
                    s.linksIn !== null ? t(`${s.linksIn} ${s.linksIn === 1 ? "enlace" : "enlaces"} desde tus páginas principales`, `${s.linksIn} ${s.linksIn === 1 ? "link" : "links"} from your main pages`) : "",
                    s.position !== null ? t(`lugar ${s.position} en Google`, `position ${s.position} on Google`) : "",
                    s.loadSeconds !== null
                      ? s.loadSource === "pagespeed"
                        ? t(`carga en celular: ${number.format(Math.round(s.loadSeconds * 10) / 10)} s`, `mobile load: ${number.format(Math.round(s.loadSeconds * 10) / 10)} s`)
                        : t(`responde en ${number.format(Math.round(s.loadSeconds * 10) / 10)} s`, `responds in ${number.format(Math.round(s.loadSeconds * 10) / 10)} s`)
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}

              {p.winners.length > 0 && !p.needsRecheck && (
                <details className="op-winners">
                  <summary className="btn link">{t("Los que ganan en Google", "Who wins on Google")}</summary>
                  <div className="table-wrap" style={{ marginTop: 8 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>{t("Sitio", "Site")}</th>
                          <th className="kw-num">{t("Palabras", "Words")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.winners.map((w) => (
                          <tr key={`${w.position}-${w.url}`}>
                            <td className="small">{w.position}</td>
                            <td className="small op-win">
                              <a href={w.url} target="_blank" rel="noopener noreferrer nofollow">{w.domain || w.url}</a>
                              {w.title && <span className="muted" style={{ display: "block" }}>{w.title}</span>}
                            </td>
                            <td className="small kw-num">{w.words !== null ? number.format(w.words) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              {p.suggestion && !p.needsRecheck && (
                <div className="stack op-suggest">
                  <span className="lbl">
                    {t("Sugerencia de la IA", "AI suggestion")}
                    {provider && <span className="small muted"> · {provider}</span>}
                  </span>
                  {(
                    [
                      [t("Título SEO", "SEO title"), p.suggestion.title, `${p.suggestion.title.length}/60`],
                      [t("Descripción para Google", "Google description"), p.suggestion.metaDescription, `${p.suggestion.metaDescription.length}/160`],
                      [t("Título principal (H1)", "Main heading (H1)"), p.suggestion.h1, ""],
                      [t("Subtítulos (H2)", "Subheadings (H2)"), p.suggestion.h2s.join("\n"), ""],
                    ] as [string, string, string][]
                  )
                    .filter(([, v]) => v.trim())
                    .map(([label, value, count]) => (
                      <div key={label} className="wr-field">
                        <div className="row between">
                          <span className="small muted">
                            {label}
                            {count && ` · ${count}`}
                          </span>
                          <CopyButton text={value} label={t("Copiar", "Copy")} className="btn link" />
                        </div>
                        <span className="wr-value" style={{ whiteSpace: "pre-line" }}>{value}</span>
                      </div>
                    ))}
                  <span className="small muted">{t("Revisa que todo sea cierto antes de publicarlo.", "Check that everything is true before you publish it.")}</span>
                </div>
              )}

              {p.keyword && (
                <div className="op-actions">
                  <RecheckButton action={action} url={p.url} primary={p.needsRecheck} />
                  {ai && !p.needsRecheck && p.score !== null && <SuggestButton action={suggestPageFix.bind(null, businessId, p.url)} has={!!p.suggestion} />}
                </div>
              )}
              <span className="small muted">{t("Revisada:", "Checked:")} {fmt.format(new Date(p.checkedAt))}</span>
            </article>
          );
        })}
      </div>
      </ShowMore>
      {ctx && <AiPromptButton text={onPagePrompt(ctx, report, lang)} />}
    </>,
  );
}
