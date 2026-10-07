// Descargas del kit de marca: quién puede bajar qué. Partes sin servidor para poder probarlas.
import { readBrandAssets, type BrandAsset } from "@/lib/brand-assets";
import { safeEqual } from "@/lib/session";

/** Hay contraseña configurada y la cookie de la sesión es la correcta (lo mismo que revisa el middleware). */
export function sessionOk(cookie: string | undefined, token: string, appPassword: string | undefined): boolean {
  return Boolean(appPassword) && Boolean(cookie) && safeEqual(cookie ?? "", token);
}

/** La imagen pedida, solo si es de este negocio (está en su lista guardada). */
export function ownAsset(raw: unknown, assetId: string): BrandAsset | null {
  if (!/^[a-z0-9]{6,40}$/i.test(assetId)) return null;
  return readBrandAssets(raw).items.find((a) => a.id === assetId) ?? null;
}

/** Las imágenes del kit de este negocio. */
export const kitItems = (raw: unknown) => readBrandAssets(raw).items.filter((a) => a.kind === "kit" && a.status === "accepted");

/** Encabezado para que el navegador descargue con ese nombre (con acentos bien escritos). */
export function attachment(fileName: string): string {
  const ascii = fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "");
  return `attachment; filename="${ascii || "archivo"}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
