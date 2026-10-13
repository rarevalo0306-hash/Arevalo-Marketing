"use server";

import { revalidatePath } from "next/cache";
import { deniedText, hasBusiness } from "@/lib/auth";
import { LOGO_SLOTS, LOGO_TYPES, setLogoSlot, setMainLogoType, type LogoSlot, type LogoType, type LogoVariant } from "@/lib/brand-assets";
import { updateBrandAssets } from "@/lib/brand-assets-db";
import { db } from "@/lib/db";
import { ensure } from "@/lib/ensure";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { isOwnFile, storeBuffer } from "@/lib/media";
import { isPublicHttpsUrl } from "@/lib/net-guard";
import { svgToPng } from "@/lib/svg-logo";

/**
 * Guarda un logo apenas se sube (o se quita). Antes solo se guardaba al presionar "Guardar la marca",
 * y si el dueño salía de la página el logo se perdía y no aparecía en ningún lado.
 */
export async function saveBrandLogo(businessId: string, field: "logoUrl" | "logoLightUrl", url: string): Promise<{ ok: boolean; message: string }> {
  ensure.text(businessId, field, url);
  const { t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  if (field !== "logoUrl" && field !== "logoLightUrl") return { ok: false, message: t("Campo no válido.", "Invalid field.") };
  // El servidor descarga el logo después (kit de marca): solo direcciones públicas de internet, nunca la red interna.
  if (url !== "" && !(isOwnFile(url, businessId) || (await isPublicHttpsUrl(url)))) return { ok: false, message: t("La dirección del logo no es válida.", "The logo address isn't valid.") };
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  await db.business.update({ where: { id: businessId }, data: { [field]: url } });
  revalidatePath(`/b/${businessId}`, "layout");
  return { ok: true, message: url ? t("Logo guardado.", "Logo saved.") : t("Logo quitado.", "Logo removed.") };
}

/** Guarda (o quita, con "") la versión a color o blanca de un tipo de logo: isotipo, logotipo, imagotipo o isologo. */
export async function saveLogoSlot(businessId: string, slot: LogoSlot, variant: LogoVariant, url: string): Promise<{ ok: boolean; message: string }> {
  ensure.text(businessId, slot, variant, url);
  const { t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  if (!LOGO_SLOTS.includes(slot) || (variant !== "color" && variant !== "white")) return { ok: false, message: t("Campo no válido.", "Invalid field.") };
  if (url !== "" && !(isOwnFile(url, businessId) || (await isPublicHttpsUrl(url)))) return { ok: false, message: t("La dirección del logo no es válida.", "The logo address isn't valid.") };
  await updateBrandAssets(businessId, (cur) => setLogoSlot(cur, slot, variant, url));
  revalidatePath(`/b/${businessId}/marca`);
  return { ok: true, message: url ? t("Logo guardado.", "Logo saved.") : t("Logo quitado.", "Logo removed.") };
}

/** Qué tipo es el logo principal (logotipo, imagotipo o isologo). "" = sin decir. */
export async function saveMainLogoType(businessId: string, type: string): Promise<{ ok: boolean; message: string }> {
  ensure.text(businessId, type);
  const { t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  const main = LOGO_TYPES.find((x) => x === type) ?? null;
  if (type !== "" && !main) return { ok: false, message: t("Tipo de logo no válido.", "Invalid logo type.") };
  await updateBrandAssets(businessId, (cur) => setMainLogoType(cur, main as LogoType | null));
  revalidatePath(`/b/${businessId}/marca`);
  return { ok: true, message: t("Guardado.", "Saved.") };
}

/** Recibe un logo en SVG, lo limpia y lo guarda como PNG de 2000 px con fondo transparente. Devuelve su dirección. */
export async function uploadSvgLogo(businessId: string, svg: string): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  ensure.text(businessId, svg);
  const { lang, t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  try {
    const png = await svgToPng(svg);
    const { url } = await storeBuffer(png, "image/png", businessId);
    return { ok: true, url };
  } catch (e) {
    return { ok: false, message: t(`No se pudo usar el SVG: ${errorText(e, lang)}`, `Couldn't use the SVG: ${errorText(e, lang)}`) };
  }
}
