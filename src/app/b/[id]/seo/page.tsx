import { PageHead } from "@/components/PageHead";
import { AuditPanel } from "@/components/seo/AuditPanel";
import { SearchConsolePanel } from "@/components/seo/SearchConsolePanel";
import { VisibilityPanel } from "@/components/seo/VisibilityPanel";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";

// La auditoría recorre el sitio y la visibilidad en IA hace varias búsquedas: puede tardar.
export const maxDuration = 300;

export default async function SeoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
        <AuditPanel businessId={id} />
        <VisibilityPanel businessId={id} />
        <SearchConsolePanel businessId={id} />
      </div>
    </>
  );
}
