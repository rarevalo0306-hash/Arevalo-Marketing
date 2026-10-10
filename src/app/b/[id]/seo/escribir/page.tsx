import Link from "next/link";
import { suggestTopic } from "@/app/actions-seo-site";
import { deleteArticle, writeArticle } from "@/app/actions-seo-writer";
import { PageHead } from "@/components/PageHead";
import { DeleteArticleButton } from "@/components/seo/ArticleTools";
import { ArticleView, ScoreDial } from "@/components/seo/ArticleView";
import { WriterForm } from "@/components/seo/WriterForm";
import { aiEnabled } from "@/lib/ai";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readZones, zoneLabel } from "@/lib/seo/dataforseo";
import { cleanKeyword } from "@/lib/seo/keywords";
import { MAX_ARTICLES, readArticleReport, WRITER_SERP_COST } from "@/lib/seo/writer";
import { BUSINESS_TZ } from "@/lib/time";

// Mirar Google, leer las páginas que ganan y que la IA escriba el artículo puede tardar 1 a 2 minutos.
export const maxDuration = 300;

export default async function EscribirPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ kw?: string; a?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const { lang, t } = await getT();
  const b = await db.business.findUniqueOrThrow({
    where: { id },
    select: { name: true, color: true, seoLanguage: true, seoLocations: true, seoLocationCode: true, seoLocationName: true },
  });
  const rows = await db.seoReport.findMany({ where: { businessId: id, kind: "article" }, orderBy: { createdAt: "desc" }, take: MAX_ARTICLES });
  const list = rows.map((r) => ({ id: r.id, at: r.createdAt, report: readArticleReport(r.data) }));
  const selected = (q.a ? list.find((x) => x.id === q.a) : list.find((x) => x.report)) ?? null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const dfs = dataForSeoEnabled();
  const ai = aiEnabled();
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeZone: BUSINESS_TZ });
  const back = `/b/${id}/seo`;

  return (
    <>
      <PageHead
        business={b}
        prefix={t("SEO de", "SEO for")}
        title={t("Escribir un artículo para Google", "Write an article for Google")}
        subtitle={t(
          "Escribe la búsqueda para la que quieres salir. Miramos a los que ganan en Google, la IA escribe un artículo que cubre todo lo que ellos cubren y lo revisamos punto por punto.",
          "Enter the search you want to show up for. We look at who's winning on Google, the AI writes an article that covers everything they cover, and we check it point by point.",
        )}
        aside={<Link href={back} className="btn">{t("← SEO y visibilidad", "← SEO and visibility")}</Link>}
      />
      <div className="stack" style={{ gap: 22 }}>
        <section className="card">
          {!dfs || !ai ? (
            <div className="stack" style={{ gap: 10 }}>
              {!dfs && (
                <p className="note">
                  {t(
                    "Para mirar quién gana en Google hace falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel). Las instrucciones están en ",
                    "To see who's winning on Google, connect DataForSEO (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel). Instructions are in ",
                  )}
                  <Link href={back}>{t("SEO y visibilidad", "SEO and visibility")}</Link>.
                </p>
              )}
              {!ai && (
                <p className="note">
                  {t(
                    "Para escribir el artículo hace falta la clave de una IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en Vercel.",
                    "Writing the article needs an AI key (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY) in Vercel.",
                  )}
                </p>
              )}
            </div>
          ) : !zones.length ? (
            <p className="note">
              {t("Primero elige tu zona de Google en ", "First pick your Google area in ")}
              <Link href={`${back}?tab=ajustes`}>{t("SEO y visibilidad", "SEO and visibility")}</Link>
              {t(" (pestaña «⚙ Ajustes») y guarda. Así miramos lo que ven tus clientes.", " (“⚙ Settings” tab) and save. That way we see what your customers see.")}
            </p>
          ) : (
            <WriterForm
              businessId={id}
              action={writeArticle.bind(null, id)}
              defaultKeyword={cleanKeyword(q.kw ?? "").slice(0, 80)}
              defaultLanguage={b.seoLanguage === "en" ? "en" : "es"}
              zone={zoneLabel(zones[0].name) || zones[0].name}
              serpCost={WRITER_SERP_COST}
              suggest={suggestTopic.bind(null, id)}
            />
          )}
        </section>

        {q.a && !selected && <p className="note">{t("Ese artículo ya no existe. Abajo están los que tienes.", "That article no longer exists. Your articles are below.")}</p>}
        {selected && !selected.report && (
          <p className="note">{t("Ese artículo tiene un formato viejo y no se puede mostrar.", "That article is in an old format and can't be shown.")}</p>
        )}
        {selected?.report && <ArticleView businessId={id} id={selected.id} report={selected.report} />}

        {list.length > 0 && (
          <section className="card">
            <h2>{t(`Tus artículos (${list.length})`, `Your articles (${list.length})`)}</h2>
            <ul className="wr-list">
              {list.map((x) => (
                <li key={x.id} className={x.id === selected?.id ? "on" : undefined}>
                  {x.report ? <ScoreDial score={x.report.score} size={40} /> : <span className="wr-dial-empty">—</span>}
                  <span className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                    <Link href={`/b/${id}/seo/escribir?a=${x.id}`} scroll={false} style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                      {x.report?.keyword ?? t("(formato viejo)", "(old format)")}
                    </Link>
                    <span className="small muted" style={{ overflowWrap: "anywhere" }}>
                      {fmt.format(x.at)}
                      {x.report?.draft.title && ` · ${x.report.draft.title}`}
                    </span>
                  </span>
                  <DeleteArticleButton
                    action={deleteArticle.bind(null, id, x.id)}
                    keyword={x.report?.keyword ?? ""}
                    redirectTo={x.id === selected?.id ? `/b/${id}/seo/escribir` : undefined}
                  />
                </li>
              ))}
            </ul>
            <p className="small muted">{t(`Guardamos tus últimos ${MAX_ARTICLES} artículos.`, `We keep your last ${MAX_ARTICLES} articles.`)}</p>
          </section>
        )}
      </div>
    </>
  );
}
