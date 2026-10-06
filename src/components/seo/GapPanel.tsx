import Link from "next/link";
import { trackGapKeyword } from "@/app/actions-seo-competitors";
import { runGap } from "@/app/actions-seo-gap";
import { GapButton } from "@/components/seo/GapButton";
import { GapTable } from "@/components/seo/GapTable";
import { HowToRead } from "@/components/seo/HowToRead";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { normalizeDomain, readCompetitorsReport } from "@/lib/seo/competitors";
import { dataForSeoEnabled, readTrackedKeywords, readZones } from "@/lib/seo/dataforseo";
import { businessTopicVocab, gapCostEstimate, gbpCategory, pickGapCompetitors, readGapReport, splitGapRows } from "@/lib/seo/gap";
import { latestReports } from "@/lib/seo/reports";
import { BUSINESS_TZ } from "@/lib/time";

/** Palabras que tu competencia tiene y tú no (estilo Keyword Gap): las que te faltan y donde estás más abajo. */
export async function GapPanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const header = (
    <div className="stack" style={{ gap: 4 }}>
      <h2>{t("Palabras que tu competencia tiene y tú no", "Keywords your competitors have and you don't")}</h2>
      <p className="small muted">
        {t(
          "Búsquedas de Google que ya le traen clientes a tu competencia: escribe sobre ellas para empezar a salir tú también.",
          "Google searches that already bring customers to your competitors: write about them so you start showing up too.",
        )}
      </p>
    </div>
  );
  const empty = (body: React.ReactNode) => (
    <section className="card" id="gap">
      {header}
      <p className="note">{body}</p>
    </section>
  );

  if (!dataForSeoEnabled())
    return empty(t("Para ver estas palabras, primero conecta DataForSEO (arriba, en Datos reales de Google).", "To see these keywords, first connect DataForSEO (above, in Real Google data)."));

  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, seoKeywords: true, study: true },
  });
  if (!b) return null;
  const self = normalizeDomain(b.website);
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  if (!self)
    return empty(
      <>
        {t("Para comparar tus palabras con las de tu competencia, primero agrega la dirección de tu página en ", "To compare your keywords with your competitors', first add your website address in ")}
        <Link href={`/b/${businessId}/negocio`}>{t("Ajustes del negocio", "Business settings")}</Link>.
      </>,
    );
  if (!zones.length)
    return empty(t("Primero elige la zona donde buscan tus clientes (arriba, en Datos reales de Google).", "First pick the area where your customers search (above, in Real Google data)."));

  const [[compRow], [row], [gbpRow]] = await Promise.all([latestReports(businessId, "competitors", 1), latestReports(businessId, "gap", 1), latestReports(businessId, "gbp", 1)]);
  const competitors = pickGapCompetitors(compRow ? readCompetitorsReport(compRow.data) : null);
  if (!competitors.length)
    return empty(
      t(
        'Primero busca a tu competencia con el botón "Buscar mi competencia" (en el panel de arriba). Después vuelve aquí para ver qué palabras tienen ellos y tú no.',
        'First find your competition with the "Find my competition" button (in the panel above). Then come back here to see which keywords they have and you don\'t.',
      ),
    );

  const report = row ? readGapReport(row.data) : null;
  // Solo las búsquedas que tienen que ver con lo que vende el negocio; las demás se pueden ver con un botón.
  const vocab = businessTopicVocab({ ...b, category: gbpRow ? gbpCategory(gbpRow.data) : null });
  const split = report ? splitGapRows(report.rows, vocab) : { relevant: [], hidden: [] };
  const offTopic = [...split.hidden, ...(report?.offTopic ?? [])];
  const tracked = readTrackedKeywords(b.seoKeywords).map((k) => k.toLowerCase());
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 3 });
  // Si cambió la competencia desde la última corrida, se avisa para que actualice.
  const changed = report && (report.competitors.length !== competitors.length || competitors.some((c) => !report.competitors.includes(c)));

  return (
    <section className="card" id="gap">
      {header}
      <p className="small muted">
        {t("Comparando", "Comparing")} <strong>{self}</strong> {t("con", "with")} {(report?.competitors ?? competitors).join(", ")}
        {report?.location.countryName && <> · {t("País:", "Country:")} {report.location.countryName}</>}
        {row && (
          <>
            {" · "}
            {t("Última búsqueda:", "Last search:")} {fmt.format(row.createdAt)}
            {report && <> · {t("Costo:", "Cost:")} {money.format(report.cost)}</>}
          </>
        )}
      </p>
      {changed && (
        <p className="note">
          {t(
            `Tu lista de competidores cambió (ahora: ${competitors.join(", ")}). Presiona Actualizar para compararte con ellos.`,
            `Your competitor list changed (now: ${competitors.join(", ")}). Press Update to compare yourself with them.`,
          )}
        </p>
      )}

      <GapButton action={runGap.bind(null, businessId)} has={Boolean(row)} competitors={competitors.length} estimate={gapCostEstimate(competitors.length)} />

      {!row && (
        <p className="small muted">
          {t(
            "Todavía no has buscado estas palabras. Presiona el botón: comparamos tu página con la de tu competencia en todo tu país.",
            "You haven't looked up these keywords yet. Press the button: we compare your website with your competitors' across your country.",
          )}
        </p>
      )}
      {row && !report && <p className="note">{t("El último reporte tiene un formato viejo y no se puede mostrar. Presiona Actualizar.", "The last report is in an old format and can't be shown. Press Update.")}</p>}

      {report && (
        <>
          {report.notes.length > 0 && (
            <ul className="small muted comp-notes">
              {report.notes.map((x, i) => <li key={i}>{lang === "en" ? x.en : x.es}</li>)}
            </ul>
          )}
          {split.relevant.length + offTopic.length === 0 ? (
            <p className="small muted">
              {t(
                "No encontramos búsquedas donde tu competencia te gane. Vuelve a revisar en unas semanas o agrega otros competidores arriba.",
                "We didn't find searches where your competitors beat you. Check again in a few weeks or add other competitors above.",
              )}
            </p>
          ) : (
            <GapTable businessId={businessId} rows={split.relevant} offTopic={offTopic} tracked={tracked} track={trackGapKeyword.bind(null, businessId)} />
          )}
          <p className="small muted">
            {t(
              `Las búsquedas, posiciones y la dificultad son estimados de DataForSEO para ${report.location.countryName || "tu país"} en Google (no por ciudad). La dificultad va de 0 a 100: menos de 30 es fácil.`,
              `Searches, rankings and difficulty are DataForSEO estimates for ${report.location.countryName || "your country"} on Google (not by city). Difficulty goes from 0 to 100: under 30 is easy.`,
            )}
          </p>
          <HowToRead title={t("Cómo leer esto", "How to read this")}>
            <ul>
              <li>{t("«Te faltan»: búsquedas donde tu competencia sale en Google y tú no. Escribir un artículo sobre ellas es la forma más directa de empezar a salir.", "“You're missing”: searches where your competitors show up on Google and you don't. Writing an article about them is the most direct way to start showing up.")}</li>
              <li>{t("«Estás más abajo»: sí sales, pero ellos están más arriba. Mejora la página que ya tienes.", "“You rank lower”: you do show up, but they're higher. Improve the page you already have.")}</li>
              <li>{t("Dificultad de 0 a 100: qué tan difícil es llegar a la primera página. Fácil (menos de 30) primero.", "Difficulty from 0 to 100: how hard it is to reach page one. Start with easy ones (under 30).")}</li>
              <li>{t("Solo mostramos búsquedas que tienen que ver con lo que vendes (según tus palabras clave y tu estudio). Las demás las puedes ver con «Mostrarlas igual».", "We only show searches related to what you sell (based on your keywords and your study). You can see the rest with “Show them anyway”.")}</li>
            </ul>
          </HowToRead>
        </>
      )}
    </section>
  );
}
