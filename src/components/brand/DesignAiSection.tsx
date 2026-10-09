// «Diseños maestros con IA» (Marca → Plantillas): aquí se leen los datos; la pantalla está en DesignAiPanel.
import { checkDesignMaster, discardDesignMaster, previewDesignMaster, saveDesignMaster, startDesignMasters } from "@/app/actions-design-ai";
import { DesignAiPanel, type PanelModel } from "@/components/brand/DesignAiPanel";
import { db } from "@/lib/db";
import { designModels, maxUsd } from "@/lib/design-ai";
import { masterTemplates, openCandidates, sampleHeadline, samplePhotoFor } from "@/lib/design-ai-run";
import { getT } from "@/lib/i18n-server";

export async function DesignAiSection({ businessId }: { businessId: string }) {
  const { lang } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { color: true, logoUrl: true, fontHeading: true, brandIdentity: true } });
  if (!b) return null;
  const [candidates, masters, photo] = await Promise.all([openCandidates(businessId, lang), masterTemplates(businessId), samplePhotoFor(businessId, b.color)]);
  const models: PanelModel[] = designModels().map((m) => ({ id: m.id, name: m.name, maker: m.maker, usd: m.usd, approx: Boolean(m.approx), styleRef: m.styleRef, etaSec: m.etaSec, defaultOn: m.defaultOn, good: m.good[lang] }));
  return (
    <DesignAiPanel
      models={models}
      cap={maxUsd()}
      candidates={candidates}
      masters={masters}
      favorite={masters[0]?.model ?? ""}
      sample={{ photo, headline: sampleHeadline(b.brandIdentity, lang), logo: b.logoUrl, color: b.color, font: b.fontHeading }}
      hasFal={Boolean(process.env.FAL_KEY)}
      hasIdeogram={Boolean(process.env.IDEOGRAM_API_KEY)}
      start={startDesignMasters.bind(null, businessId)}
      check={checkDesignMaster.bind(null, businessId)}
      preview={previewDesignMaster.bind(null, businessId)}
      save={saveDesignMaster.bind(null, businessId)}
      discard={discardDesignMaster.bind(null, businessId)}
    />
  );
}
