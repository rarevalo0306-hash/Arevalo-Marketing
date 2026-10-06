import Link from "next/link";
import { deleteArticle, improveArticle } from "@/app/actions-seo-writer";
import { CopyButton, DeleteArticleButton, ImproveButton } from "@/components/seo/ArticleTools";
import { TEXT_PROVIDERS } from "@/lib/ai";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { zoneLabel } from "@/lib/seo/dataforseo";
import { costText } from "@/lib/seo/keywords";
import { type ArticleReport, articleHtml, articleMarkdown, markdownText, markdownToHtml, scoreTone, stripH1, targetUsage } from "@/lib/seo/writer";
import { BUSINESS_TZ } from "@/lib/time";

const TONE_COLOR = { good: "var(--teal)", ok: "#e0a100", bad: "#d64545" } as const;

/** El puntaje en un círculo de color. */
export function ScoreDial({ score, size = 96 }: { score: number; size?: number }) {
  const tone = scoreTone(score);
  return (
    <span
      className="wr-dial"
      style={{ "--p": score, "--c": TONE_COLOR[tone], width: size, height: size } as React.CSSProperties}
      role="img"
      aria-label={`${score}/100`}
    >
      <span style={{ fontSize: Math.round(size * 0.3) }}>{score}</span>
    </span>
  );
}

/** Un artículo escrito: puntaje, revisión, metas, textos para copiar y el artículo. */
export async function ArticleView({ businessId, id, report }: { businessId: string; id: string; report: ArticleReport }) {
  const { lang, t } = await getT();
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  const number = new Intl.NumberFormat(intlLocale(lang));
  const { draft, targets, research } = report;
  const usage = targetUsage(draft, targets);
  const words = markdownText(stripH1(draft.markdown)).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const failing = report.checklist.filter((c) => !c.ok);
  const provider = TEXT_PROVIDERS.find((p) => p.id === report.provider)?.name;
  const tone = scoreTone(report.score);
  const verdict = tone === "good" ? t("Listo para publicar", "Ready to publish") : tone === "ok" ? t("Casi listo", "Almost there") : t("Necesita mejoras", "Needs work");
  const idea = t(
    `Escribe una publicación para promocionar el artículo "${draft.title}" de mi página (búsqueda: ${report.keyword}). Basado en esto:\n\n${draft.socialPost}`,
    `Write a post promoting the article "${draft.title}" on my website (search: ${report.keyword}). Based on this:\n\n${draft.socialPost}`,
  ).slice(0, 2000);
  const post = `/b/${businessId}/publicar?${new URLSearchParams({ idea, magic: "1" })}`;
  const mark = (ok: boolean) => <span className={`vis-mark ${ok ? "yes" : "no"}`} aria-label={ok ? t("cumple", "done") : t("falta", "missing")}>{ok ? "✓" : "✗"}</span>;
  const chars = (s: string, min: number, max: number) => {
    const n = s.trim().length;
    return <span className={`small ${n >= min && n <= max ? "muted" : "kw-error"}`}>{t(`${n} letras`, `${n} characters`)}</span>;
  };

  return (
    <>
      <section className="card">
        <div className="row between" style={{ alignItems: "flex-start", gap: 16 }}>
          <div className="row" style={{ gap: 16, alignItems: "center", flexWrap: "nowrap", minWidth: 0 }}>
            <ScoreDial score={report.score} />
            <div className="stack" style={{ gap: 4, minWidth: 0 }}>
              <span className="lbl" style={{ overflowWrap: "anywhere" }}>“{report.keyword}”</span>
              <strong>{verdict}</strong>
              <span className="small muted">
                {report.previousScore !== undefined && t(`Antes: ${report.previousScore} · `, `Before: ${report.previousScore} · `)}
                {fmt.format(new Date(report.improvedAt ?? report.createdAt))}
              </span>
            </div>
          </div>
          <DeleteArticleButton action={deleteArticle.bind(null, businessId, id)} keyword={report.keyword} redirectTo={`/b/${businessId}/seo/escribir`} />
        </div>
        <p className="small muted">
          {zoneLabel(report.zone.name) || report.zone.name} · {report.language === "en" ? t("Inglés", "English") : t("Español", "Spanish")}
          {provider && ` · ${t("Escrito por", "Written by")} ${provider}`} · DataForSEO {costText(report.cost)}
        </p>

        <div className="stack" style={{ gap: 8 }}>
          <span className="lbl">{t("Revisión", "Checklist")}</span>
          <ul className="wr-check">
            {report.checklist.map((c) => (
              <li key={c.id}>
                {mark(c.ok)}
                <span>{t(c.es, c.en)}</span>
              </li>
            ))}
          </ul>
        </div>
        {failing.length > 0 && <ImproveButton action={improveArticle.bind(null, businessId, id)} failing={failing.length} />}
      </section>

      <section className="card">
        <div className="stack" style={{ gap: 4 }}>
          <h2>{t("Lo que hacen los que ganan", "What the winners do")}</h2>
          <p className="small muted">
            {t(
              `Lo que tienen en común las páginas que salen primero en Google para “${report.keyword}”. ✓ = tu artículo ya lo tiene.`,
              `What the pages ranking first on Google for “${report.keyword}” have in common. ✓ = your article already has it.`,
            )}
          </p>
        </div>
        <div className="seo-tiles">
          <div className="seo-tile">
            <span className="small muted">{t("Largo recomendado", "Recommended length")}</span>
            <strong>{number.format(targets.wordCount)}</strong>
            <span className="small muted">{t("palabras", "words")}</span>
          </div>
          <div className="seo-tile">
            <span className="small muted">{t("Tu artículo", "Your article")}</span>
            <strong>{number.format(words)}</strong>
            <span className="small muted">{t("palabras", "words")}</span>
          </div>
          <div className="seo-tile">
            <span className="small muted">{t("Páginas leídas", "Pages read")}</span>
            <strong>{targets.competitorWords.length}</strong>
            <span className="small muted">{targets.competitorWords.length ? targets.competitorWords.map((n) => number.format(n)).join(" · ") : t("ninguna se pudo leer", "none could be read")}</span>
          </div>
        </div>
        {(research.localPack || research.aiOverview || research.featuredSnippet) && (
          <div className="tags">
            {research.localPack && <span className="tag">{t("Google muestra un mapa con negocios", "Google shows a map with businesses")}</span>}
            {research.aiOverview && <span className="tag">{t("Google muestra un resumen con IA", "Google shows an AI overview")}</span>}
            {research.featuredSnippet && <span className="tag">{t("Google muestra una respuesta destacada", "Google shows a featured snippet")}</span>}
          </div>
        )}
        <div className="grid-2" style={{ gap: 18 }}>
          {targets.headings.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="lbl">{t("Temas que tocan", "Topics they cover")}</span>
              <ul className="wr-check">
                {targets.headings.map((h, i) => (
                  <li key={i}>
                    {mark(usage.headings[i])}
                    <span>
                      {h.text}
                      {h.pages > 1 && <span className="small muted"> · {t(`${h.pages} páginas`, `${h.pages} pages`)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {targets.questions.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="lbl">{t("Preguntas que hace la gente", "Questions people ask")}</span>
              <ul className="wr-check">
                {targets.questions.map((q, i) => (
                  <li key={i}>
                    {mark(usage.questions[i])}
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {targets.terms.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="lbl">{t("Palabras relacionadas", "Related terms")}</span>
            <div className="tags">
              {targets.terms.map((term, i) => (
                <span key={i} className={`tag ${usage.terms[i] ? "wr-used" : "wr-unused"}`}>
                  {usage.terms[i] ? "✓ " : ""}
                  {term}
                </span>
              ))}
            </div>
          </div>
        )}
        {research.organic.length > 0 && (
          <details>
            <summary className="btn link" style={{ display: "inline-flex", padding: 0 }}>{research.organic.length === 1 ? t("Ver el primero de Google", "See Google's top result") : t(`Ver los ${research.organic.length} primeros de Google`, `See Google's top ${research.organic.length}`)}</summary>
            <ol className="wr-serp">
              {research.organic.map((o) => {
                const page = research.pages.find((p) => p.position === o.position);
                return (
                  <li key={o.position}>
                    <a href={o.url} target="_blank" rel="noopener noreferrer nofollow">{o.title || o.url}</a>
                    <span className="small muted">
                      {o.domain}
                      {page && !page.error && ` · ${t(`${number.format(page.words)} palabras`, `${number.format(page.words)} words`)}`}
                      {page?.error && ` · ${t("no se pudo leer", "couldn't be read")}`}
                    </span>
                  </li>
                );
              })}
            </ol>
          </details>
        )}
      </section>

      <section className="card">
        <h2>{t("Para Google", "For Google")}</h2>
        <div className="stack" style={{ gap: 14 }}>
          <div className="wr-field">
            <div className="row between">
              <span className="lbl">{t("Título SEO", "SEO title")}</span>
              {chars(draft.title, 1, 60)}
            </div>
            <p className="wr-value">{draft.title}</p>
            <CopyButton text={draft.title} label={t("Copiar", "Copy")} className="btn link" />
          </div>
          <div className="wr-field">
            <div className="row between">
              <span className="lbl">{t("Descripción (meta)", "Description (meta)")}</span>
              {chars(draft.metaDescription, 120, 160)}
            </div>
            <p className="wr-value">{draft.metaDescription}</p>
            <CopyButton text={draft.metaDescription} label={t("Copiar", "Copy")} className="btn link" />
          </div>
          <div className="wr-field">
            <span className="lbl">{t("Dirección (slug)", "Address (slug)")}</span>
            <p className="wr-value mono-text">/{draft.slug}</p>
            <CopyButton text={draft.slug} label={t("Copiar", "Copy")} className="btn link" />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="row between">
          <h2>{t("Tu artículo", "Your article")}</h2>
          <div className="row" style={{ gap: 8 }}>
            <CopyButton text={articleMarkdown(draft)} label={t("Copiar artículo", "Copy article")} className="btn on" />
            <CopyButton text={articleHtml(draft)} label={t("Copiar como HTML", "Copy as HTML")} />
          </div>
        </div>
        <article className="wr-article">
          {draft.h1 && <h1>{draft.h1}</h1>}
          <div dangerouslySetInnerHTML={{ __html: markdownToHtml(stripH1(draft.markdown)) }} />
        </article>
      </section>

      {draft.socialPost.trim() && (
        <section className="card">
          <div className="stack" style={{ gap: 4 }}>
            <h2>{t("Post para promocionarlo", "Post to promote it")}</h2>
            <p className="small muted">{t("Para Facebook o Instagram cuando publiques el artículo en tu página.", "For Facebook or Instagram once the article is on your website.")}</p>
          </div>
          <div className="preview">
            <div className="preview-body">{draft.socialPost}</div>
          </div>
          <div className="row">
            <Link href={post} className="btn on">{t("Crear post", "Create post")}</Link>
            <CopyButton text={draft.socialPost} label={t("Copiar texto", "Copy text")} />
          </div>
        </section>
      )}
    </>
  );
}
