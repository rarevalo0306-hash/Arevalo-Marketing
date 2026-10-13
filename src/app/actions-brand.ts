"use server";

import { revalidatePath } from "next/cache";
import { deniedText, hasBusiness } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensure } from "@/lib/ensure";
import { getT } from "@/lib/i18n-server";
import { isOwnFile } from "@/lib/media";
import { isPublicHttpsUrl } from "@/lib/net-guard";

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
