import Link from "next/link";
import { capClass, Fold } from "@/components/seo/Fold";
import { HowToRead } from "@/components/seo/HowToRead";
import styles from "@/components/seo/QuestionsPanel.module.css";
import { ShowMore } from "@/components/seo/ShowMore";
import { intlLocale, type T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled } from "@/lib/seo/dataforseo";
import { loadQuestions, type QuestionGroup, type QuestionItem } from "@/lib/seo/questions";
import { BUSINESS_TZ } from "@/lib/time";

/** Cuántas palabras clave y cuántas preguntas de cada una se ven antes de «Ver todas». */
const SHOWN_GROUPS = 2;
const SHOWN_QUESTIONS = 3;

const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") || url;

function Question({ q, businessId, t, className }: { q: QuestionItem; businessId: string; t: T; className?: string }) {
  const writer = `/b/${businessId}/seo/escribir`;
  const where = q.answered?.where;
  return (
    <li className={`${styles.item} ${where === "site" ? styles.site : where === "article" ? styles.article : ""}${className ? ` ${className}` : ""}`}>
      <span className={styles.question}>{q.question}</span>
      {/* El estado y el botón de escribir en un mismo renglón: la tarjeta queda más corta. */}
      <div className={styles.status}>
        {where === "site" ? (
          <span className="pill done">{t("Ya la respondes", "Already answered")}</span>
        ) : where === "article" ? (
          <span className="pill scheduled">{t("En un artículo tuyo", "In one of your articles")}</span>
        ) : (
          <span className="pill partial">{t("Sin responder", "Not answered")}</span>
        )}
        {!q.answered && (
          <Link className={styles.write} href={`${writer}?${new URLSearchParams({ kw: q.topic })}`}>
            {t("Escribir artículo →", "Write article →")}
          </Link>
        )}
      </div>
      {q.answered?.where === "site" && (
        <span className={styles.meta}>
          {t("La responde: ", "Answered by: ")}
          {q.answered.url ? (
            <a href={q.answered.url} target="_blank" rel="noopener noreferrer">
              {q.answered.label || shortUrl(q.answered.url)}
            </a>
          ) : (
            q.answered.label
          )}
        </span>
      )}
      {q.answered?.where === "article" && (
        <span className={styles.meta}>
          {t("La responde tu artículo ", "Answered by your article ")}
          <Link href={`${writer}?a=${encodeURIComponent(q.answered.articleId ?? "")}`}>«{q.answered.label}»</Link>
          {t(". Si todavía no lo publicaste en tu web, publícalo para que Google lo vea.", ". If you haven't published it on your website yet, publish it so Google can see it.")}
        </span>
      )}
      {q.keywords.length > 1 && (
        <span className={styles.meta}>
          {t("También sale cuando buscan: ", "Also shows up for: ")}
          {q.keywords.slice(1).map((k) => `«${k}»`).join(", ")}
        </span>
      )}
    </li>
  );
}

function Group({ g, businessId, t, className }: { g: QuestionGroup; businessId: string; t: T; className?: string }) {
  const writer = `/b/${businessId}/seo/escribir`;
  return (
    <li className={`${styles.group}${className ? ` ${className}` : ""}`}>
      <span className={styles.keyword}>
        <span className="small muted" style={{ fontWeight: 500 }}>{t("Cuando buscan ", "When people search ")}</span>«{g.keyword}»
      </span>
      <ul className={styles.list}>
        {g.questions.map((q, i) => (
          <Question key={q.question} q={q} businessId={businessId} t={t} className={capClass(i, SHOWN_QUESTIONS)} />
        ))}
      </ul>
      {g.related.length > 0 && (
        <Fold inline summary={t(`También buscan (${g.related.length} búsquedas parecidas)`, `People also search (${g.related.length} similar searches)`)}>
        <div className={styles.related}>
          {g.related.map((r) => (
            <Link key={r} href={`${writer}?${new URLSearchParams({ kw: r })}`} className="tag" style={{ textDecoration: "none" }} title={t("Escribir un artículo para esta búsqueda", "Write an article for this search")}>
              {r}
            </Link>
          ))}
        </div>
        </Fold>
      )}
    </li>
  );
}

/** "Preguntas que hace la gente": ideas de artículos con las preguntas que Google ya muestra (sin costo extra). */
export async function QuestionsPanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const data = await loadQuestions(businessId);
  if (!data) return null;
  // Sin DataForSEO y sin nada guardado no hay de dónde sacar preguntas.
  if (!dataForSeoEnabled() && !data.total && !data.rankReports) return null;

  const header = (
    <div className="stack" style={{ gap: 4 }}>
      <h2>{t("Preguntas que hace la gente", "Questions people ask")}</h2>
      <p className="small muted">
        {t(
          "Son las preguntas del cuadro «La gente también pregunta» que Google muestra cuando buscan tus palabras clave. Cada una que no respondes en tu web es una idea de artículo: si la contestas bien, puedes salir en ese cuadro.",
          "These are the questions from the “People also ask” box Google shows when people search your keywords. Each one your website doesn't answer is an article idea: answer it well and you can show up in that box.",
        )}
      </p>
    </div>
  );
  const help = (
    <HowToRead title={t("Cómo leer esto", "How to read this")}>
      <ul>
        <li>
          {t(
            "Las preguntas salen de tu revisión de posiciones (y de los artículos que ya escribiste). No cuestan nada extra: vienen en la misma búsqueda.",
            "The questions come from your rankings check (and the articles you already wrote). They cost nothing extra: they come with the same search.",
          )}
        </li>
        <li>
          {t(
            "«Ya la respondes» = una página de tu web tiene un título o subtítulo que contesta esa pregunta. «En un artículo tuyo» = un artículo que escribiste aquí la contesta; si no lo has publicado, publícalo.",
            "“Already answered” = a page on your website has a title or subheading that answers that question. “In one of your articles” = an article you wrote here answers it; if you haven't published it, do it.",
          )}
        </li>
        <li>
          {t(
            "«Sin responder» = nadie en tu web la contesta. Toca «Escribir artículo» y el escritor arma uno con esa pregunta como tema. Pon la pregunta tal cual como subtítulo y contéstala en las primeras 2 o 3 líneas.",
            "“Not answered” = nothing on your website answers it. Tap “Write article” and the writer drafts one with that question as the topic. Use the question as a subheading and answer it in the first 2 or 3 lines.",
          )}
        </li>
        <li>
          {t(
            "Para saber qué responde tu web usamos la última «Auditoría del sitio» y «Revisión de tus páginas». Si no las has corrido, todas pueden salir como «Sin responder».",
            "To know what your website answers we use the latest “Site audit” and “Your pages check”. If you haven't run them, everything may show as “Not answered”.",
          )}
        </li>
        <li>
          {t("Ocultamos las preguntas que no tienen que ver con lo que vendes.", "We hide questions that have nothing to do with what you sell.")}
        </li>
      </ul>
    </HowToRead>
  );

  if (!data.total) {
    const msg = !data.rankReports
      ? t(
          "Todavía no hay preguntas. Aparecen después de la próxima revisión de tus posiciones en Google.",
          "No questions yet. They show up after your next Google rankings check.",
        )
      : !data.rankHasQuestions
        ? t(
            "Todavía no hay preguntas: tu última revisión de posiciones es de antes de que empezáramos a guardarlas. Aparecen después de la próxima revisión.",
            "No questions yet: your last rankings check is from before we started saving them. They show up after the next check.",
          )
        : data.hidden
          ? t(
              "Google mostró preguntas para tus palabras clave, pero ninguna tiene que ver con lo que vendes. Prueba con palabras clave más específicas de tus productos o servicios.",
              "Google showed questions for your keywords, but none of them relate to what you sell. Try keywords that are more specific to your products or services.",
            )
          : t(
              "Google no mostró el cuadro «La gente también pregunta» para tus palabras clave. Prueba con búsquedas más generales (por ejemplo, el nombre de tu producto sin la ciudad).",
              "Google didn't show the “People also ask” box for your keywords. Try broader searches (for example, your product name without the city).",
            );
    return (
      <section className="card" id="preguntas">
        {header}
        <p className="note">
          {msg}{" "}
          <a href="#posiciones">{t("Ir a tus posiciones", "Go to your rankings")}</a>
        </p>
        {help}
      </section>
    );
  }

  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeZone: BUSINESS_TZ });
  const listed = data.groups.reduce((n, g) => n + g.questions.length, 0);
  const visible = data.groups.slice(0, SHOWN_GROUPS).reduce((n, g) => n + Math.min(SHOWN_QUESTIONS, g.questions.length), 0);
  const hiddenGroups = Math.max(0, data.groups.length - SHOWN_GROUPS);
  const answered = data.answeredSite + data.answeredArticle;

  return (
    <section className="card" id="preguntas">
      {header}
      <div className={styles.summary} aria-label={t("Resumen", "Summary")}>
        <span>
          <strong>{data.total}</strong> {t(data.total === 1 ? "pregunta" : "preguntas", data.total === 1 ? "question" : "questions")}
        </span>
        <span>
          <strong>{data.unanswered}</strong> {t("sin responder", "not answered")}
        </span>
        <span>
          <strong>{answered}</strong> {t("ya respondidas", "already answered")}
        </span>
      </div>
      {help}
      {!data.siteChecked && (
        <p className="note">
          {t(
            "Todavía no sabemos qué contesta tu web: corre la «Auditoría del sitio» para marcar las preguntas que ya respondes.",
            "We don't know yet what your website answers: run the “Site audit” to mark the questions you already answer.",
          )}
        </p>
      )}
      <ShowMore
        hidden={listed - visible}
        more={
          hiddenGroups > 0
            ? t(
                `Ver todas (${listed} preguntas de ${data.groups.length} palabras clave)`,
                `See all (${listed} questions from ${data.groups.length} keywords)`,
              )
            : t(`Ver todas (${listed} preguntas)`, `See all (${listed} questions)`)
        }
      >
        <ul className={styles.groups}>
          {data.groups.map((g, i) => (
            <Group key={g.keyword} g={g} businessId={businessId} t={t} className={capClass(i, SHOWN_GROUPS)} />
          ))}
        </ul>
      </ShowMore>
      <p className="small muted" style={{ margin: 0 }}>
        {data.checkedAt && Date.parse(data.checkedAt) > 0
          ? t(`Preguntas de la revisión de posiciones del ${fmt.format(new Date(data.checkedAt))}.`, `Questions from the rankings check on ${fmt.format(new Date(data.checkedAt))}.`)
          : t("Preguntas de tus artículos guardados.", "Questions from your saved articles.")}
        {data.hidden > 0 &&
          ` ${t(
            `Ocultamos ${data.hidden} ${data.hidden === 1 ? "pregunta que no tiene" : "preguntas que no tienen"} que ver con lo que vendes.`,
            `We hid ${data.hidden} ${data.hidden === 1 ? "question" : "questions"} unrelated to what you sell.`,
          )}`}
      </p>
    </section>
  );
}
