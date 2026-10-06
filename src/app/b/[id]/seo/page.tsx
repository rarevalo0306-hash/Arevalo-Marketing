import { PageHead } from "@/components/PageHead";
import { AlertsPanel } from "@/components/seo/AlertsPanel";
import { AuditPanel } from "@/components/seo/AuditPanel";
import { CompetitorsPanel } from "@/components/seo/CompetitorsPanel";
import { DfsSettingsPanel } from "@/components/seo/DfsSettingsPanel";
import { GapPanel } from "@/components/seo/GapPanel";
import { KeywordsPanel } from "@/components/seo/KeywordsPanel";
import { MapRankPanel } from "@/components/seo/MapRankPanel";
import { RankPanel } from "@/components/seo/RankPanel";
import { SearchConsolePanel } from "@/components/seo/SearchConsolePanel";
import { VisibilityPanel } from "@/components/seo/VisibilityPanel";
import { WriterCard } from "@/components/seo/WriterCard";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";

// La auditoría recorre el sitio y la visibilidad en IA hace varias búsquedas: puede tardar.
export const maxDuration = 300;

export default async function SeoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mapa?: string }> }) {
  const { id } = await params;
  const { mapa } = await searchParams;
  const b = await db.business.findUniqueOrThrow({ where: { id }, select: { name: true, color: true } });
  const { t } = await getT();
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
      <div className="stack" style={{ gap: 22 }}>
        <DfsSettingsPanel businessId={id} />
        <KeywordsPanel businessId={id} />
        <WriterCard businessId={id} />
        <RankPanel businessId={id} />
        <MapRankPanel businessId={id} mapId={mapa} />
        <AlertsPanel businessId={id} />
        <CompetitorsPanel businessId={id} />
        <GapPanel businessId={id} />
        <AuditPanel businessId={id} />
        <VisibilityPanel businessId={id} />
        <SearchConsolePanel businessId={id} />
      </div>
    </>
  );
}
