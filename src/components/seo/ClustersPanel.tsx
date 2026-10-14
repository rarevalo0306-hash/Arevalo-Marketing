import Link from "next/link";
import { buildTopicClusters } from "@/app/actions-seo-clusters";
import { capClass } from "@/components/seo/Fold";
import { HowToRead } from "@/components/seo/HowToRead";
import { RunButton } from "@/components/seo/RunButton";
import { ShowMore } from "@/components/seo/ShowMore";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { type Cluster, clusterNext, type PageKind, readClustersReport } from "@/lib/seo/clusters";
import { DIFFICULTY_LABEL, difficultyLevel, INTENT_LABEL } from "@/lib/seo/labs-shared";
import { latestReports } from "@/lib/seo/reports";
import { BUSINESS_TZ } from "@/lib/time";

/** Cuántos temas se ven antes de «Ver todos». */
const SHOWN = 6;
/** Cuántas búsquedas de cada tema se ven. */
const WORDS = 6;

/** «Tus temas»: las búsquedas agrupadas por tema, cada una con la página que ya la cubre o la que falta. */
export async function ClustersPanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const [row] = await latestReports(businessId, "clusters", 1);
  const report = row ? readClustersReport(row.data) : null;
  const number = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 0 });
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  const KIND: Record<PageKind, [string, string]> = {
    service: [t("Página de servicio", "Service page"), "partial"],
    area: [t("Página de zona", "Area page"), "draft"],
    article: [t("Artículo", "Article"), "done"],
  };
  const writeHref = (kw: string) => `/b/${businessId}/seo/escribir?${new URLSearchParams({ kw })}`;

  const card = (c: Cluster, i: number) => {
    const level = difficultyLevel(c.difficulty);
    const next = clusterNext(c);
    return (
      <article key={`${c.main}-${i}`} className={["topic-card", capClass(i, SHOWN)].filter(Boolean).join(" ")}>
        <div className="topic-head">
          <h3>{lang === "en" ? c.name.en : c.name.es}</h3>
          <span className={`pill ${KIND[c.kind][1]}`}>{KIND[c.kind][0]}</span>
        </div>
        <p className="small muted">
          {t(`${c.keywords.length} ${c.keywords.length === 1 ? "búsqueda" : "búsquedas"}`, `${c.keywords.length} ${c.keywords.length === 1 ? "search" : "searches"}`)}
          {c.volume > 0 && t(` · ${number.format(c.volume)} al mes`, ` · ${number.format(c.volume)} a month`)}
          {level && t(` · ${DIFFICULTY_LABEL[level][1]}`, ` · ${DIFFICULTY_LABEL[level][2]}`)}
          {c.intent && ` · ${t(INTENT_LABEL[c.intent].es, INTENT_LABEL[c.intent].en)}`}
          {c.bestPosition !== null && t(` · tu mejor lugar: #${c.bestPosition}`, ` · your best spot: #${c.bestPosition}`)}
        </p>
        <div className="tags">
          {c.keywords.slice(0, WORDS).map((k) => (
            <span key={k.keyword} className="tag" title={k.volume != null ? t(`${number.format(k.volume)} búsquedas al mes`, `${number.format(k.volume)} searches a month`) : undefined}>
              {k.keyword}
              {k.volume ? <small className="muted"> · {number.format(k.volume)}</small> : null}
            </span>
          ))}
          {c.keywords.length > WORDS && <span className="small muted">{t(`+${c.keywords.length - WORDS} más`, `+${c.keywords.length - WORDS} more`)}</span>}
        </div>
        <div className="topic-next small">
          {next === "keep" ? (
            <span className="rank-up">{t(`✓ Ya sales en el lugar ${c.bestPosition}: cuida esa página.`, `✓ You're already #${c.bestPosition}: look after that page.`)}</span>
          ) : next === "improve" ? (
            <>
              <span>
                {c.page ? (
                  <>
                    {t("Ya lo cubre tu página ", "Already covered by your page ")}
                    <a href={c.page.url} target="_blank" rel="noopener noreferrer">
                      {c.page.label || c.page.url}
                    </a>
                    {t(": agrégale estas búsquedas para subir.", ": add these searches to it to move up.")}
                  </>
                ) : (
                  t(`Ya lo cubre tu artículo «${c.article}»: agrégale estas búsquedas para subir.`, `Already covered by your article “${c.article}”: add these searches to it to move up.`)
                )}
              </span>
            </>
          ) : (
            <>
              <strong className="rank-down">
                {next === "write"
                  ? t("Falta un artículo sobre este tema.", "An article on this topic is missing.")
                  : c.kind === "area"
                    ? t("Falta una página para esta zona.", "A page for this area is missing.")
                    : t("Falta una página para este servicio.", "A page for this service is missing.")}
              </strong>{" "}
              <Link href={writeHref(c.main)}>{next === "write" ? t("Escribir el artículo →", "Write the article →") : t("Escribir el texto de la página →", "Write the page text →")}</Link>
            </>
          )}
        </div>
      </article>
    );
  };

  return (
    <section className="card" id="temas">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{t("Tus temas: qué página hace falta", "Your topics: which page is missing")}</h2>
        <p className="small muted">
          {t(
            "Juntamos todas tus búsquedas (las que sigues, las ideas, lo que tiene tu competencia, Search Console y las preguntas de la gente) y las agrupamos por tema. Cada tema debe tener UNA página en tu web: así Google sabe qué página mostrar.",
            "We gather all your searches (the ones you track, ideas, what your competitors have, Search Console and people's questions) and group them by topic. Each topic should have ONE page on your website: that way Google knows which page to show.",
          )}
        </p>
      </div>
      <RunButton
        action={buildTopicClusters.bind(null, businessId)}
        label={report ? t("Volver a agrupar", "Group again") : t("Agrupar mis búsquedas", "Group my searches")}
        busy={t("Agrupando tus búsquedas…", "Grouping your searches…")}
        note={t("No gasta saldo de DataForSEO: usa lo que ya tienes guardado.", "It doesn't use DataForSEO balance: it uses what you already have saved.")}
        ai
      />
      {report && row && (
        <>
          <p className="small muted">
            {t(`${report.total} búsquedas en ${report.clusters.length} temas`, `${report.total} searches in ${report.clusters.length} topics`)} · {fmt.format(row.createdAt)}
            {report.by === "words" && t(" · agrupadas por palabras en común (sin IA)", " · grouped by shared words (no AI)")}
          </p>
          <ShowMore hidden={report.clusters.length - SHOWN} more={t(`Ver los ${report.clusters.length} temas`, `See all ${report.clusters.length} topics`)}>
            <div className="topic-grid">{report.clusters.map(card)}</div>
          </ShowMore>
          <HowToRead title={t("Cómo usar tus temas", "How to use your topics")}>
            <ul>
              <li>{t("Empieza por los temas con más búsquedas al mes que dicen «Falta una página».", "Start with the topics with the most monthly searches that say “A page is missing”.")}</li>
              <li>{t("Página de servicio: vende un servicio (precio, cómo trabajas, zona, botón para llamar). Página de zona: el mismo servicio para una ciudad. Artículo: responde preguntas y lleva a tu servicio.", "Service page: sells one service (price, how you work, area, call button). Area page: the same service for one city. Article: answers questions and leads to your service.")}</li>
              <li>{t("No hagas dos páginas del mismo tema: compiten entre sí y Google no sabe cuál mostrar.", "Don't make two pages on the same topic: they compete with each other and Google doesn't know which to show.")}</li>
            </ul>
          </HowToRead>
        </>
      )}
    </section>
  );
}
