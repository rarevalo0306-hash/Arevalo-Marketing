// Imágenes sacadas del manual de marca (logos, isotipo, patrones, íconos, fotos y ejemplos de piezas) para aceptar o
// rechazar. Aquí se cargan los datos; lo que se ve y se toca está en BookAssetsPanel.
import { readBrandAssets } from "@/lib/brand-assets";
import { db } from "@/lib/db";
import { BookAssetsPanel } from "./BookAssetsPanel";

export async function BookAssetsSection({ businessId }: { businessId: string }) {
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { brandBookUrl: true, logoUrl: true, logoLightUrl: true, brandAssets: true, templates: { select: { spec: true } } },
  });
  if (!b) return null;
  const assets = readBrandAssets(b.brandAssets);
  const templateUrls = b.templates
    .map((x) => (x.spec as { custom?: { imageUrl?: unknown } } | null)?.custom?.imageUrl)
    .filter((u): u is string => typeof u === "string" && u !== "");
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
    />
  );
}
