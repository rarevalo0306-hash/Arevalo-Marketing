import { PageHead } from "@/components/PageHead";
import { ReportCard } from "@/components/seo/ReportCard";
import { AlertsPanel } from "@/components/seo/AlertsPanel";
import { AuditPanel } from "@/components/seo/AuditPanel";
import { CannibalPanel } from "@/components/seo/CannibalPanel";
import { BacklinksPanel } from "@/components/seo/BacklinksPanel";
import { DecayPanel } from "@/components/seo/DecayPanel";
import { CompetitorsPanel } from "@/components/seo/CompetitorsPanel";
import { DfsSettingsPanel } from "@/components/seo/DfsSettingsPanel";
import { GapPanel } from "@/components/seo/GapPanel";
import { GbpPanel } from "@/components/seo/GbpPanel";
import { KeywordsPanel } from "@/components/seo/KeywordsPanel";
import { MapRankPanel } from "@/components/seo/MapRankPanel";
import { OnPagePanel } from "@/components/seo/OnPagePanel";
import { QuestionsPanel } from "@/components/seo/QuestionsPanel";
import { RankPanel } from "@/components/seo/RankPanel";
import { SchemaPanel } from "@/components/seo/SchemaPanel";
import { SearchConsolePanel } from "@/components/seo/SearchConsolePanel";
import { SharePanel } from "@/components/seo/SharePanel";
import { TrafficPanel } from "@/components/seo/TrafficPanel";
import { SeoGuide } from "@/components/seo/SeoGuide";
import { SeoSetup } from "@/components/seo/SeoSetup";
import { SeoTabs, type SeoTab } from "@/components/seo/SeoTabs";
import { VisibilityPanel } from "@/components/seo/VisibilityPanel";
import { seoTabFrom } from "@/components/nav/model";
import { WriterCard } from "@/components/seo/WriterCard";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readTrackedKeywords, readZones } from "@/lib/seo/dataforseo";
import { KEYWORDS_CALL_COST } from "@/lib/seo/keywords";
import { RANK_COST_PER_KEYWORD } from "@/lib/seo/rank";
import { setupState } from "@/lib/seo/setup";

// La auditoría recorre el sitio y la visibilidad en IA hace varias búsquedas: puede tardar.
export const maxDuration = 300;

export default async function SeoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mapa?: string; tab?: string; competidor?: string }> }) {
  const { id } = await params;
  const { mapa, tab, competidor: rawCompetidor } = await searchParams;
  // Desde el buscador del Tablero: el sitio del competidor llega escrito en el formulario de competencia.
  const competidor = (rawCompetidor ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].slice(0, 100) || undefined;
  const b = await db.business.findUniqueOrThrow({
    where: { id },
    select: { name: true, color: true, website: true, seoKeywords: true, seoLocations: true, seoLocationCode: true, seoLocationName: true },
  });
  const { t } = await getT();
  // Sin zonas o sin palabras clave casi nada funciona: el resumen propone todo solo y el dueño acepta o quita.
  const setupShown = dataForSeoEnabled();
  const needsSetup =
    setupShown && (readTrackedKeywords(b.seoKeywords).length === 0 || readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName).length === 0);
  const saved = needsSetup ? (await setupState(id)).proposal : null;
  // Las mismas pestañas y el mismo orden que el menú (SEO_TAB_IDS); ?mapa= abre «Local».
  const initial = seoTabFrom(tab, mapa);
  const tabs: SeoTab[] = [
    {
      id: "resumen",
      label: t("Resumen", "Summary"),
      hint: "",
      content: (
        <>
          {setupShown && (
            <SeoSetup
              businessId={id}
              needed={needsSetup}
              saved={saved}
              price={RANK_COST_PER_KEYWORD}
              measurePrice={KEYWORDS_CALL_COST}
              hasWebsite={Boolean(b.website.trim())}
            />
          )}
          <SeoGuide businessId={id} />
        </>
      ),
    },
    {
      id: "google",
      label: t("Posiciones", "Rankings"),
      hint: t("En qué lugar sales en Google, las palabras que busca la gente y lo que pregunta.", "Where you rank on Google, the words people search and what they ask."),
      content: (
        <>
          <RankPanel businessId={id} />
          <KeywordsPanel businessId={id} />
          <QuestionsPanel businessId={id} />
        </>
      ),
    },
    {
      id: "local",
      label: t("Local", "Local"),
      hint: t("El mapa de calor de tu zona, tu Perfil de Google (reseñas) y el código para Google.", "The heatmap of your area, your Google profile (reviews) and the code for Google."),
      content: (
        <>
          <MapRankPanel businessId={id} mapId={mapa} />
          <GbpPanel businessId={id} />
          <SchemaPanel businessId={id} />
        </>
      ),
    },
    {
      id: "web",
      label: t("Tu página web", "Your website"),
      hint: t("Qué arreglar en tu página, qué páginas perdieron visitas y artículos nuevos.", "What to fix on your site, pages losing visits and new articles."),
      content: (
        <>
          <AuditPanel businessId={id} />
          <OnPagePanel businessId={id} />
          <DecayPanel businessId={id} />
          <CannibalPanel businessId={id} />
          <WriterCard businessId={id} />
          <div id="search-console">
            <SearchConsolePanel businessId={id} />
          </div>
        </>
      ),
    },
    {
      id: "competencia",
      label: t("Competencia", "Competitors"),
      hint: t("Quién te gana en Google, qué palabras tienen ellos y tú no, sus visitas y sus enlaces.", "Who beats you on Google, keywords they have and you don't, their visits and links."),
      content: (
        <>
          <SharePanel businessId={id} />
          <CompetitorsPanel businessId={id} competidor={competidor} />
          <GapPanel businessId={id} />
          <TrafficPanel businessId={id} />
          <BacklinksPanel businessId={id} />
        </>
      ),
    },
    {
      id: "ia",
      label: t("IAs", "AIs"),
      hint: t("Si ChatGPT, Gemini y Claude te recomiendan y qué dicen de ti.", "Whether ChatGPT, Gemini and Claude recommend you and what they say."),
      content: <VisibilityPanel businessId={id} />,
    },
    {
      id: "reportes",
      label: t("Reportes", "Reports"),
      hint: t("El reporte en PDF del mes y los emails de cada lunes.", "The monthly PDF report and the Monday emails."),
      content: (
        <>
          <ReportCard businessId={id} />
          <AlertsPanel businessId={id} />
        </>
      ),
    },
    {
      id: "ajustes",
      label: t("⚙ Ajustes", "⚙ Settings"),
      hint: t("Zonas, idioma, palabras clave que se siguen, cada cuánto se revisan y tu saldo de DataForSEO.", "Areas, language, tracked keywords, how often they are checked and your DataForSEO balance."),
      content: <DfsSettingsPanel businessId={id} />,
    },
  ];
  return (
    <>
      <PageHead
        business={b}
        prefix={t("SEO de", "SEO for")}
        title={t("SEO y visibilidad", "SEO and visibility")}
        subtitle={t(
          "Cómo te encuentran en Google y en las IAs (ChatGPT, Gemini, Claude): la salud de tu página, si las IAs te recomiendan y tus búsquedas reales en Google.",
          "How people find you on Google and in AI assistants (ChatGPT, Gemini, Claude): your website's health, whether AIs recommend you, and your real Google searches.",
        )}
      />
      <SeoTabs tabs={tabs} initial={initial} />
    </>
  );
}
