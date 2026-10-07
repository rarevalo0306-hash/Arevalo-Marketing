import Link from "next/link";
import { HowToRead } from "@/components/seo/HowToRead";
import styles from "@/components/seo/SeoHelp.module.css";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { readAuditReport } from "@/lib/seo/audit";
import { readBacklinksReport } from "@/lib/seo/backlinks";
import { buildCannibal } from "@/lib/seo/cannibal";
import { dataForSeoEnabled, readTrackedKeywords, readZones } from "@/lib/seo/dataforseo";
import { businessTopicVocab, gbpCategory, readGapReport, relevantGapRows } from "@/lib/seo/gap";
import { asGscReport } from "@/lib/seo/gsc";
import { readKeywordsReport } from "@/lib/seo/keywords";
import { readMapReport } from "@/lib/seo/maprank";
import { plainSummary } from "@/lib/seo/plain";
import { readRankReport } from "@/lib/seo/rank";
import { latestReports, type SeoKind } from "@/lib/seo/reports";
import { mapGroups, marketSummary } from "@/lib/seo/sov";
import { readTrafficReport } from "@/lib/seo/traffic";
import { readVisibilityReport } from "@/lib/seo/visibility";
import { latestByZone } from "@/lib/seo/zones";

/** Mapas guardados que se leen para "tu parte del mapa" (el último de cada búsqueda). */
const MAPS_TAKE = 10;

/**
 * Arriba de la página de SEO: un resumen en palabras simples armado con los últimos reportes guardados (sin IA,
 * sin costo), qué quiere decir cada número de la página y en qué orden usarla.
 */
export async function SeoGuide({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, website: true, seoKeywords: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, study: true },
  });
  if (!b) return null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const canRank = dataForSeoEnabled();
  const per = Math.max(1, zones.length);
  // Todo en una sola tanda (consultas en paralelo, solo los datos guardados): nada llama a una API.
  const latest = (kind: SeoKind, take = 1) =>
    db.seoReport.findMany({ where: { businessId, kind }, orderBy: { createdAt: "desc" }, take, select: { data: true } }).catch(() => []);
  const [rankRows, kwRows, aiRows, gapRows, gbpRows, mapRows, gscRows, auditRows, linkRows, trafficRows] = await Promise.all([
    latestReports(businessId, "rank", 3 * per),
    latestReports(businessId, "keywords", 3 * per),
    latest("ai"),
    latest("gap"),
    latest("gbp"),
    latest("maprank", MAPS_TAKE),
    latest("gsc"),
    latest("audit"),
    latest("backlinks"),
    latest("traffic"),
  ]);

  // La zona principal (la primera), como en los paneles de posiciones y búsquedas.
  const main = zones[0]?.code;
  const rankByZone = latestByZone(rankRows.map((r) => readRankReport(r.data)), zones);
  const kwByZone = latestByZone(kwRows.map((r) => readKeywordsReport(r.data)), zones);
  const rank = main === undefined ? null : (rankByZone.get(main) ?? null);
  const keywords = main === undefined ? null : (kwByZone.get(main) ?? null);
  const ai = aiRows[0] ? readVisibilityReport(aiRows[0].data) : null;
  const gap = gapRows[0] ? readGapReport(gapRows[0].data) : null;
  const vocab = businessTopicVocab({ ...b, category: gbpRows[0] ? gbpCategory(gbpRows[0].data) : null });

  // Tu parte del mercado: el último reporte de cada zona (los sin código cuentan como de la principal), el último
  // mapa de cada búsqueda y la última revisión de las IAs.
  const market = marketSummary({
    website: b.website,
    rankByZone: [...rankByZone.entries()].map(([code, r]) => [{ ...r, locationCode: code }]),
    keywords: [...kwByZone.entries()].sort(([a], [c]) => Number(c === main) - Number(a === main)).map(([code, k]) => ({ ...k, locationCode: code })),
    maps: mapGroups(mapRows.flatMap((r) => readMapReport(r.data) ?? [])),
    ai: [ai],
  });

  // Páginas que compiten entre sí: solo Search Console puede marcar una búsqueda como urgente, así que basta con el
  // último reporte de Search Console y la revisión de la página (para los títulos), igual que el panel.
  const gsc = gscRows[0] ? asGscReport(gscRows[0].data) : null;
  const cannibal = gsc?.pageQueries.length
    ? buildCannibal({
        businessName: b.name,
        website: b.website,
        zones,
        gsc: { pageQueries: gsc.pageQueries, range: gsc.range },
        ranks: [],
        audit: auditRows[0] ? readAuditReport(auditRows[0].data) : null,
      })
    : null;

  const lines = plainSummary({
    businessId,
    rank: zones.length ? rank : null,
    keywords,
    tracked: readTrackedKeywords(b.seoKeywords),
    ai,
    gap: gap ? relevantGapRows(gap.rows, vocab) : null,
    canRank: canRank && zones.length > 0,
    market,
    cannibal,
    backlinks: linkRows[0] ? readBacklinksReport(linkRows[0].data) : null,
    traffic: trafficRows[0] ? readTrafficReport(trafficRows[0].data) : null,
  });
  const pick = (x: { es: string; en: string }) => (lang === "en" ? x.en : x.es);

  const glossary: [string, string, string, string][] = [
    [
      "Posición",
      "El lugar en que sale tu página cuando alguien busca en Google: 1 = el primero. 1 a 3: excelente, ahí se van la mayoría de los clics. 4 a 10: primera página. 11 a 20: segunda página, casi nadie llega. «—» o «No sales»: no estás en los primeros 20.",
      "Position",
      "Where your page shows up when someone searches on Google: 1 = first. 1 to 3: excellent, most clicks go there. 4 to 10: page one. 11 to 20: page two, almost nobody gets there. “—” or “Not showing”: you're not in the top 20.",
    ],
    [
      "Mapa de Google",
      "Los 3 negocios con mapa que Google muestra arriba de todo cuando la búsqueda es local. De ahí la gente llama directo. Depende de tu Perfil de Google y tus reseñas.",
      "Google's map",
      "The 3 businesses with a map that Google shows above everything when the search is local. People call straight from there. It depends on your Google profile and reviews.",
    ],
    [
      "Búsquedas al mes",
      "Cuántas veces buscan esa frase en Google al mes en tu zona (promedio del último año, dato de Google Ads).",
      "Monthly searches",
      "How many times that phrase is searched on Google per month in your area (last year's average, from Google Ads).",
    ],
    [
      "«—» en búsquedas",
      "Google dice que se busca muy poco (menos de unas 10 veces al mes) o no tiene datos. No es un error: conviene seguir también frases que la gente sí usa.",
      "“—” in searches",
      "Google says it's barely searched (fewer than about 10 times a month) or has no data. It's not an error: also track phrases people do use.",
    ],
    [
      "Competencia en anuncios",
      "Cuántos negocios pagan anuncios en Google por esa búsqueda (baja, media o alta). No dice qué tan difícil es salir gratis.",
      "Ad competition",
      "How many businesses pay for Google ads on that search (low, medium or high). It doesn't say how hard it is to show up for free.",
    ],
    [
      "CPC",
      "Lo que paga un anunciante por cada clic en Google. Si es alto, esa búsqueda trae clientes que valen dinero: vale la pena salir gratis con artículos.",
      "CPC",
      "What an advertiser pays for each click on Google. If it's high, that search brings customers worth money: it's worth showing up for free with articles.",
    ],
    [
      "Visibilidad %",
      "Qué parte de los clics posibles te llegan con tus posiciones. 100 % = primer lugar en todas tus palabras; pesa más salir arriba.",
      "Visibility %",
      "How much of the possible clicks reach you with your rankings. 100% = first place on all your keywords; higher spots weigh more.",
    ],
    [
      "Dificultad",
      "De 0 a 100, qué tan difícil es llegar a la primera página de Google. Menos de 30 es fácil; 60 o más, difícil.",
      "Difficulty",
      "From 0 to 100, how hard it is to reach Google's first page. Under 30 is easy; 60 or more, hard.",
    ],
    [
      "Nota de 0 a 100",
      "El puntaje de salud de tu página web o de tu Perfil de Google: 80 o más está bien; menos de 50 tiene cosas importantes que arreglar.",
      "Score from 0 to 100",
      "The health score of your website or Google profile: 80 or more is good; under 50 has important things to fix.",
    ],
  ];

  const steps: [string, string, string, string, string][] = [
    ["#dataforseo", "Elige tu zona y tus palabras clave", "en la pestaña «⚙ Ajustes»: lo que tus clientes escriben en Google (ej.: lo que vendes + tu ciudad).", "Pick your area and keywords", "in the “⚙ Settings” tab: what your customers type on Google (e.g. what you sell + your city)."],
    ["#palabras", "Mira cuánta gente las busca", "y sigue las ideas que sí se buscan.", "See how many people search them", "and track the ideas people do search."],
    ["#posiciones", "Revisa tus posiciones", "en Google y en el mapa: ahí sabes dónde estás parado.", "Check your rankings", "on Google and on the map: that's where you stand."],
    ["#perfil", "Mejora tu Perfil de Google", "(fotos, horario, reseñas): es lo que más ayuda para salir en el mapa.", "Improve your Google profile", "(photos, hours, reviews): it's what helps most to show up on the map."],
    ["#competencia", "Busca a tu competencia", "y las palabras que ellos tienen y tú no.", "Find your competition", "and the keywords they have and you don't."],
    ["#auditoria", "Arregla tu página web", "con la auditoría y la revisión de tus páginas.", "Fix your website", "with the audit and the pages check."],
    ["#ia", "Escribe artículos y revisa las IAs", "para lo que te falta, y mira si ChatGPT, Gemini y Claude te recomiendan.", "Write articles and check the AIs", "for what you're missing, and see whether ChatGPT, Gemini and Claude recommend you."],
  ];

  return (
    <section className="card" id="resumen">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{t("Tu resumen en palabras simples", "Your summary in plain words")}</h2>
        <p className="small muted">
          {t(
            "Lo armamos con tus últimas revisiones guardadas: qué va bien, qué urge y qué hacer. No usa IA ni cuesta nada.",
            "Built from your latest saved checks: what's going well, what's urgent and what to do. It uses no AI and costs nothing.",
          )}
        </p>
      </div>

      {lines.length > 0 ? (
        <ul className={styles.lines}>
          {lines.map((l) => (
            <li key={l.id} className={`${styles.line} ${styles[l.tone]}`}>
              <span className={styles.icon} aria-hidden="true">{l.icon}</span>
              <span className={styles.text}>
                {pick(l.text)}{" "}
                {l.action && (
                  <>
                    <Link href={l.action.href}>{pick(l.action.label)} →</Link>
                    {" · "}
                  </>
                )}
                <a href={l.link.href}>{pick(l.link.label)} ↓</a>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">
          {t(
            "Todavía no hay datos para resumir. Sigue los pasos de abajo: empieza por elegir tu zona y tus palabras clave.",
            "There's no data to summarize yet. Follow the steps below: start by picking your area and keywords.",
          )}
        </p>
      )}

      <HowToRead title={t("¿Cómo leer esta página?", "How to read this page?")}>
        <dl className={styles.glossary}>
          {glossary.map(([es, esText, en, enText]) => (
            <div key={es}>
              <dt>{t(es, en)}</dt>
              <dd>{t(esText, enText)}</dd>
            </div>
          ))}
        </dl>
      </HowToRead>
      <HowToRead title={t("En qué orden usar esta página", "In what order to use this page")} open={lines.length === 0}>
        <ol className={styles.steps}>
          {steps.map(([href, esTitle, esText, enTitle, enText]) => (
            <li key={href}>
              <a href={href}>
                <strong>{t(esTitle, enTitle)}</strong>
              </a>{" "}
              {t(esText, enText)}
            </li>
          ))}
        </ol>
      </HowToRead>
    </section>
  );
}
