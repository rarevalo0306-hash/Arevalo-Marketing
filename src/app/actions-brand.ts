"use server";

import { revalidatePath } from "next/cache";
import { deniedText, hasBusiness } from "@/lib/auth";
import { LOGO_INFO, LOGO_SLOTS, LOGO_TYPES, readBrandAssets, setLogoSlot, setMainLogoType, type LogoSlot, type LogoType, type LogoVariant } from "@/lib/brand-assets";
import { updateBrandAssets } from "@/lib/brand-assets-db";
import { db } from "@/lib/db";
import { ensure } from "@/lib/ensure";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { isOwnFile, storeBuffer } from "@/lib/media";
import { detectLogoType } from "@/lib/logo-type";
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
  // Logo principal nuevo: la IA mira qué tipo es (logotipo, imagotipo o isologo) para no preguntárselo al dueño.
  const type = field === "logoUrl" && url ? await detectLogoType(url) : null;
  if (type) await updateBrandAssets(businessId, (cur) => setMainLogoType(cur, type, "ai"));
  revalidatePath(`/b/${businessId}`, "layout");
  if (!url) return { ok: true, message: t("Logo quitado.", "Logo removed.") };
  return { ok: true, message: type ? t(`Logo guardado. La IA vio que es un ${LOGO_INFO[type].name.es.toLowerCase()}.`, `Logo saved. The AI saw it's a ${LOGO_INFO[type].name.en.toLowerCase()}.`) : t("Logo guardado.", "Logo saved.") };
}

/**
 * Para los logos que se subieron antes: si el logo principal todavía no tiene tipo, la IA lo mira una vez y lo marca.
 * Devuelve el tipo, o null si no hay logo, ya tenía tipo o la IA no pudo verlo.
 */
export async function detectMainLogoType(businessId: string): Promise<LogoType | null> {
  ensure.text(businessId);
  if (!(await hasBusiness(businessId, "publish"))) return null;
  const b = await db.business.findUnique({ where: { id: businessId }, select: { logoUrl: true, brandAssets: true } });
  if (!b?.logoUrl || readBrandAssets(b.brandAssets).logos?.mainType) return null;
  const type = await detectLogoType(b.logoUrl);
  if (!type) return null;
  // Si el dueño eligió mientras tanto, se respeta lo suyo.
  await updateBrandAssets(businessId, (cur) => (cur.logos?.mainType ? cur : setMainLogoType(cur, type, "ai")));
  revalidatePath(`/b/${businessId}/marca`);
  return type;
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
  await updateBrandAssets(businessId, (cur) => setMainLogoType(cur, main as LogoType | null, "owner"));
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
