// Kit de marca listo para usar: foto de perfil, portadas, favicon, encabezado de email, tarjeta… creado por la app
// con el logo, los colores y la letra del negocio. Aquí se leen los datos; la pantalla está en KitPanel.
import { createBrandKit, suggestKitTagline, type KitSidecar } from "@/app/actions-brand-kit";
import { KitPanel, type KitItem } from "@/components/brand/KitPanel";
import { aiEnabled } from "@/lib/ai";
import { kitAssets } from "@/lib/brand-assets";
import { loadBrandAssets } from "@/lib/brand-assets-db";
import { asCoverLang, cleanTagline, fallbackTagline, type CoverText } from "@/lib/brand-kit-formats";
import { db } from "@/lib/db";
import { readSidecar } from "@/lib/media";

/** La frase y el idioma usados la última vez (guardados junto a la imagen para compartir). */
function savedCover(raw: unknown): CoverText | null {
  const c = raw && typeof raw === "object" ? (raw as Partial<KitSidecar>).kitCover : null;
  if (!c || typeof c !== "object") return null;
  return { lang: asCoverLang(c.lang), es: cleanTagline(c.es), en: cleanTagline(c.en) };
}

export async function BrandKitSection({ businessId }: { businessId: string }) {
  const [b, assets] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: { name: true, color: true, logoUrl: true, phone: true, website: true, aiProfile: true } }),
    loadBrandAssets(businessId),
  ]);
  if (!b) return null;
  const kit = kitAssets(assets).filter((a) => a.status === "accepted");
  const og = kit.find((a) => a.format === "og");
  const saved = og ? savedCover(await readSidecar(og.url)) : null;
  const fb = fallbackTagline(b);
  const items: KitItem[] = kit.map((a) => ({ id: a.id, url: a.url, w: a.w, h: a.h, format: a.format ?? "", transparent: Boolean(a.transparent), createdAt: a.createdAt }));
  return (
    <KitPanel
      businessId={businessId}
      business={{ name: b.name, color: b.color, phone: b.phone, website: b.website, hasLogo: Boolean(b.logoUrl) }}
      items={items}
      generatedAt={assets.generatedAt ?? null}
      cover={saved ?? { lang: "es", ...fb }}
      // Sin frase guardada y con IA: la pantalla le pide una propuesta a la IA al abrir (una sola vez).
      autoSuggest={!saved && aiEnabled()}
      aiOn={aiEnabled()}
      create={createBrandKit.bind(null, businessId)}
      suggest={suggestKitTagline.bind(null, businessId)}
    />
  );
}
