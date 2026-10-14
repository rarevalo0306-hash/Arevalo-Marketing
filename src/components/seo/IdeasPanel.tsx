import Link from "next/link";
import { findIdeas } from "@/app/actions-seo-ideas";
import { HowToRead } from "@/components/seo/HowToRead";
import { IdeasForm } from "@/components/seo/IdeasForm";
import { IdeasTable } from "@/components/seo/IdeasTable";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readTrackedKeywords, readZones } from "@/lib/seo/dataforseo";
import { IDEAS_KIND, ideasCostEstimate, readIdeasReport } from "@/lib/seo/ideas";
import { costText, MAX_TRACKED } from "@/lib/seo/keywords";
import { latestReports } from "@/lib/seo/reports";
import { BUSINESS_TZ } from "@/lib/time";

/** «Ideas de palabras»: cientos de búsquedas a partir de una palabra, con filtros (como el Keyword Magic Tool). */
export async function IdeasPanel({ businessId, idea }: { businessId: string; idea?: string }) {
  if (!dataForSeoEnabled()) return null;
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { seoLocations: true, seoLocationCode: true, seoLocationName: true, seoKeywords: true } });
  if (!b) return null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const tracked = readTrackedKeywords(b.seoKeywords).map((k) => k.toLowerCase());
  const saved = await latestReports(businessId, IDEAS_KIND, 8);
  const reports = saved.map((r) => ({ id: r.id, at: r.createdAt, report: readIdeasReport(r.data) })).filter((x) => x.report);
  // ?idea=<id> abre una búsqueda guardada; si no, la más nueva.
  const current = reports.find((x) => x.id === idea) ?? reports[0] ?? null;
  const places = zones.flatMap((z) => z.name.split(",").slice(0, 1));
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeZone: BUSINESS_TZ });
  return (
    <section className="card" id="ideas">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{t("Ideas de palabras", "Keyword ideas")}</h2>
        <p className="small muted">
          {t(
            "Escribe lo que vendes y te damos cientos de búsquedas reales que lo contienen: cuánta gente las hace, qué tan difícil es salir y si quieren comprar. Filtra las preguntas (para artículos) o las fáciles, y sigue las mejores.",
            "Type what you sell and we'll give you hundreds of real searches that contain it: how many people make them, how hard it is to rank and whether they want to buy. Filter questions (for articles) or easy ones, and track the best.",
          )}
        </p>
      </div>
      {!zones.length ? (
        <p className="note">{t("Primero elige la zona donde buscan tus clientes en la pestaña «⚙ Ajustes».", "First pick the area where your customers search in the “⚙ Settings” tab.")}</p>
      ) : (
        <IdeasForm action={findIdeas.bind(null, businessId)} seed={current?.report?.seed ?? tracked[0]?.split(" ").slice(0, 2).join(" ") ?? ""} price={costText(ideasCostEstimate())} />
      )}
      {reports.length > 1 && (
        <div className="row small" style={{ gap: 8 }}>
          <span className="muted">{t("Búsquedas anteriores (sin costo):", "Earlier searches (free):")}</span>
          {reports.map((x) => (
            <Link key={x.id} href={`/b/${businessId}/seo?tab=google&idea=${x.id}#ideas`} scroll={false} className={x.id === current?.id ? "pill done" : "pill draft"}>
              {x.report?.seed} · {fmt.format(x.at)}
            </Link>
          ))}
        </div>
      )}
      {current?.report && (
        <>
          <p className="small muted">
            {t(`«${current.report.seed}» en ${current.report.country}`, `“${current.report.seed}” in ${current.report.country}`)}
            {current.report.total ? t(` · ${current.report.total.toLocaleString("es")} en total, se muestran las ${current.report.rows.length} más buscadas`, ` · ${current.report.total.toLocaleString("en-US")} in total, showing the ${current.report.rows.length} most searched`) : ""}
            {current.report.related ? t(" · incluye búsquedas del mismo tema", " · includes searches on the same topic") : ""} · {t("costó", "cost")} {costText(current.report.cost)}
          </p>
          <IdeasTable businessId={businessId} rows={current.report.rows} places={places} tracked={tracked} full={tracked.length >= MAX_TRACKED} />
          <HowToRead title={t("Cómo usar las ideas", "How to use the ideas")}>
            <ul>
              <li>{t("«Preguntas»: cada una puede ser un artículo o una pregunta frecuente en tu página.", "“Questions”: each one can be an article or an FAQ on your site.")}</li>
              <li>{t("«Fáciles»: dificultad menor a 30; con una buena página o artículo puedes salir en la primera página.", "“Easy”: difficulty under 30; a good page or article can get you onto page one.")}</li>
              <li>{t("«Para vender»: la gente quiere comprar o está comparando: son las que traen clientes.", "“To sell”: people want to buy or are comparing: these bring customers.")}</li>
              <li>{t("Las búsquedas al mes y la dificultad son de todo el país, no solo de tu ciudad.", "Monthly searches and difficulty are for the whole country, not just your city.")}</li>
            </ul>
          </HowToRead>
        </>
      )}
    </section>
  );
}
