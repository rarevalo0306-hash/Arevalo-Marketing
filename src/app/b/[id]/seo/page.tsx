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
import { SeoTabs, type SeoTab } from "@/components/seo/SeoTabs";
import { VisibilityPanel } from "@/components/seo/VisibilityPanel";
import { WriterCard } from "@/components/seo/WriterCard";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readTrackedKeywords } from "@/lib/seo/dataforseo";

// La auditoría recorre el sitio y la visibilidad en IA hace varias búsquedas: puede tardar.
export const maxDuration = 300;

const TAB_IDS = ["resumen", "google", "web", "competencia", "ia", "reportes", "ajustes"] as const;

export default async function SeoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mapa?: string; tab?: string }> }) {
  const { id } = await params;
  const { mapa, tab } = await searchParams;
  const b = await db.business.findUniqueOrThrow({ where: { id }, select: { name: true, color: true, seoKeywords: true } });
  const { t } = await getT();
  // Sin palabras clave elegidas casi nada funciona: el resumen lo dice primero y lleva a Ajustes.
  const needsSetup = dataForSeoEnabled() && readTrackedKeywords(b.seoKeywords).length === 0;
  const initial = TAB_IDS.find((x) => x === tab) ?? (mapa ? "google" : "resumen");
  const tabs: SeoTab[] = [
    {
      id: "resumen",
      label: t("Resumen", "Summary"),
      hint: "",
      content: (
        <>
          {needsSetup && (
            <section className="card stack" style={{ gap: 10 }}>
              <h2>{t("Primero: dinos qué buscan tus clientes", "First: tell us what your customers search for")}</h2>
              <p className="small muted">
                {t(
                  "Elige la zona donde están tus clientes y las palabras clave que quieres seguir. Toma 2 minutos y con eso se llenan las demás pestañas.",
                  "Pick where your customers are and the keywords you want to track. It takes 2 minutes and fills in the other tabs.",
                )}
              </p>
              <div>
                <a className="btn primary" href="#dataforseo">{t("Ir a Ajustes de SEO →", "Go to SEO settings →")}</a>
              </div>
            </section>
          )}
          <SeoGuide businessId={id} />
        </>
      ),
    },
    {
      id: "google",
      label: t("Google y Maps", "Google & Maps"),
      hint: t("En qué lugar sales, el mapa de calor, tu Perfil de Google y lo que pregunta la gente.", "Where you rank, the map heatmap, your Google profile and what people ask."),
      content: (
        <>
          <RankPanel businessId={id} />
          <MapRankPanel businessId={id} mapId={mapa} />
          <GbpPanel businessId={id} />
          <KeywordsPanel businessId={id} />
          <QuestionsPanel businessId={id} />
        </>
      ),
    },
    {
      id: "web",
      label: t("Tu página web", "Your website"),
      hint: t("Qué arreglar en tu página, qué páginas perdieron visitas, el código para Google y artículos nuevos.", "What to fix on your site, pages losing visits, the code for Google and new articles."),
      content: (
        <>
          <AuditPanel businessId={id} />
          <OnPagePanel businessId={id} />
          <DecayPanel businessId={id} />
          <CannibalPanel businessId={id} />
          <SchemaPanel businessId={id} />
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
          <CompetitorsPanel businessId={id} />
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
      label: t("Reportes y avisos", "Reports & alerts"),
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
      hint: t("Zonas, idioma y palabras clave que se siguen, y tu saldo de DataForSEO.", "Zones, language and tracked keywords, and your DataForSEO balance."),
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
