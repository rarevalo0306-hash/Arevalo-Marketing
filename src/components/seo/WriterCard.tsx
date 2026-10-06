import Form from "next/form";
import Link from "next/link";
import { ScoreDial } from "@/components/seo/ArticleView";
import { aiEnabled } from "@/lib/ai";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readTrackedKeywords } from "@/lib/seo/dataforseo";
import { readArticleReport } from "@/lib/seo/writer";
import { BUSINESS_TZ } from "@/lib/time";

/** Tarjeta en SEO y visibilidad: escribir un artículo para Google y los últimos 3 que se escribieron. */
export async function WriterCard({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const [b, rows] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: { seoKeywords: true } }),
    db.seoReport.findMany({ where: { businessId, kind: "article" }, orderBy: { createdAt: "desc" }, take: 3 }),
  ]);
  const latest = rows.map((r) => ({ id: r.id, at: r.createdAt, report: readArticleReport(r.data) })).filter((x) => x.report);
  const tracked = readTrackedKeywords(b?.seoKeywords).slice(0, 5);
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeZone: BUSINESS_TZ });
  const page = `/b/${businessId}/seo/escribir`;
  const ready = dataForSeoEnabled() && aiEnabled();

  return (
    <section className="card">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{t("Escribir un artículo para Google", "Write an article for Google")}</h2>
        <p className="small muted">
          {t(
            "Dinos para qué búsqueda quieres salir. Miramos los 10 primeros de Google, la IA escribe un artículo que cubre lo mismo que ellos (y más) y te damos un puntaje con lo que falta.",
            "Tell us which search you want to show up for. We look at Google's top 10, the AI writes an article covering what they cover (and more), and we score it with what's missing.",
          )}
        </p>
      </div>
      {ready ? (
        <Form action={page} className="wr-start">
          <input
            name="kw"
            className="field"
            required
            minLength={2}
            maxLength={80}
            placeholder={t("Ej.: reparación de techos en Miami", "E.g. roof repair in Miami")}
            aria-label={t("Búsqueda", "Search")}
            autoComplete="off"
          />
          <button type="submit" className="btn ai">{t("Empezar", "Start")}</button>
        </Form>
      ) : (
        <p className="note">
          {t(
            "Hace falta conectar DataForSEO y tener la clave de una IA. ",
            "You need DataForSEO connected and an AI key. ",
          )}
          <Link href={page}>{t("Ver qué falta", "See what's missing")}</Link>
        </p>
      )}
      {ready && tracked.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small muted">{t("O empieza con una de tus palabras clave:", "Or start with one of your keywords:")}</span>
          <div className="tags">
            {tracked.map((k) => (
              <Link key={k} href={`${page}?${new URLSearchParams({ kw: k })}`} className="tag" style={{ textDecoration: "none" }}>
                {k}
              </Link>
            ))}
          </div>
        </div>
      )}
      {latest.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="lbl">{t("Tus últimos artículos", "Your latest articles")}</span>
          <ul className="wr-list">
            {latest.map((x) => (
              <li key={x.id}>
                <ScoreDial score={x.report!.score} size={40} />
                <span className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                  <Link href={`${page}?a=${x.id}`} style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{x.report!.keyword}</Link>
                  <span className="small muted">{fmt.format(x.at)}</span>
                </span>
              </li>
            ))}
          </ul>
          <Link href={page} className="btn link" style={{ alignSelf: "flex-start", padding: 0 }}>{t("Ver todos", "See all")}</Link>
        </div>
      )}
    </section>
  );
}
