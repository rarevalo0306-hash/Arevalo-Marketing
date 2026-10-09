// Imágenes sacadas del manual de marca (logos, isotipo, patrones, íconos, fotos y ejemplos de piezas) para aceptar o
// rechazar. Aquí se cargan los datos; lo que se ve y se toca está en BookAssetsPanel.
import { checkDesignMaster, previewDesignMaster, saveDesignMaster, startBookConvert } from "@/app/actions-design-ai";
import { readBrandAssets } from "@/lib/brand-assets";
import { db } from "@/lib/db";
import { editModels, maxUsd } from "@/lib/design-ai";
import { sampleHeadline, samplePhotoFor } from "@/lib/design-ai-run";
import { getT } from "@/lib/i18n-server";
import { BookAssetsPanel } from "./BookAssetsPanel";

export async function BookAssetsSection({ businessId }: { businessId: string }) {
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { brandBookUrl: true, logoUrl: true, logoLightUrl: true, brandAssets: true, color: true, fontHeading: true, brandIdentity: true, templates: { select: { spec: true } } },
  });
  if (!b) return null;
  const { lang } = await getT();
  const assets = readBrandAssets(b.brandAssets);
  const templateUrls = b.templates
    .map((x) => (x.spec as { custom?: { imageUrl?: unknown } } | null)?.custom?.imageUrl)
    .filter((u): u is string => typeof u === "string" && u !== "");
  // Las piezas del manual que ya se convirtieron en plantilla.
  const convertedIds = b.templates.map((x) => (x.spec as { custom?: { bookAsset?: unknown } } | null)?.custom?.bookAsset).filter((v): v is string => typeof v === "string");
  const hasSocial = assets.items.some((a) => a.source === "book" && a.kind === "template");
  return (
    <BookAssetsPanel
      businessId={businessId}
      canRead={Boolean(process.env.GEMINI_API_KEY)}
      bookUrl={b.brandBookUrl}
      readAt={assets.bookReadAt ?? ""}
      pages={assets.bookPages ?? 0}
      items={assets.items.filter((a) => a.source === "book")}
      logoUrl={b.logoUrl}
      logoLightUrl={b.logoLightUrl}
      templateUrls={templateUrls}
      convertedIds={convertedIds}
      convert={
        hasSocial
          ? {
              models: editModels().map((m) => ({ id: m.id, name: m.edit.name ?? m.name, usd: m.edit.usd, approx: Boolean(m.edit.approx), etaSec: m.etaSec })),
              cap: maxUsd(),
              sample: { photo: await samplePhotoFor(businessId, b.color), headline: sampleHeadline(b.brandIdentity, lang), logo: b.logoUrl, color: b.color, font: b.fontHeading },
              start: startBookConvert.bind(null, businessId),
              check: checkDesignMaster.bind(null, businessId),
              preview: previewDesignMaster.bind(null, businessId),
              save: saveDesignMaster.bind(null, businessId),
            }
          : null
      }
    />
  );
}
