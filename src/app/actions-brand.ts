"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";

/**
 * Guarda un logo apenas se sube (o se quita). Antes solo se guardaba al presionar "Guardar la marca",
 * y si el dueño salía de la página el logo se perdía y no aparecía en ningún lado.
 */
export async function saveBrandLogo(businessId: string, field: "logoUrl" | "logoLightUrl", url: string): Promise<{ ok: boolean; message: string }> {
  const { t } = await getT();
  if (field !== "logoUrl" && field !== "logoLightUrl") return { ok: false, message: t("Campo no válido.", "Invalid field.") };
  if (url !== "" && !/^https:\/\//.test(url)) return { ok: false, message: t("La dirección del logo no es válida.", "The logo address isn't valid.") };
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  await db.business.update({ where: { id: businessId }, data: { [field]: url } });
  revalidatePath(`/b/${businessId}`, "layout");
  return { ok: true, message: url ? t("Logo guardado.", "Logo saved.") : t("Logo quitado.", "Logo removed.") };
}
