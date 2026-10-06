"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { DAYS, normTime, SCHEMA_KEEP, SCHEMA_KIND, type WeekHours } from "@/lib/seo/schema";

export type SchemaSaveResult = { ok: boolean; message: string } | null;

/**
 * Guarda el horario y el rango de precios que escribió el dueño (gratis, no llama a ninguna API).
 * Campos del formulario: open-<Day> ("on"), opens-<Day>, closes-<Day> (hh:mm) y priceRange.
 */
export async function saveSchemaExtras(businessId: string, _prev: SchemaSaveResult, f: FormData): Promise<SchemaSaveResult> {
  void _prev;
  const { t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };

  const hours: WeekHours = {};
  const bad: string[] = [];
  for (const d of DAYS) {
    if (f.get(`open-${d}`) !== "on") continue;
    const opens = normTime(f.get(`opens-${d}`));
    const closes = normTime(f.get(`closes-${d}`));
    if (!opens || !closes || opens === closes) bad.push(d);
    else hours[d] = [{ opens, closes }];
  }
  if (bad.length)
    return {
      ok: false,
      message: t("Revisa las horas: cada día abierto necesita hora de abrir y de cerrar, y no pueden ser iguales.", "Check the hours: each open day needs an opening and a closing time, and they can't be the same."),
    };
  const priceRange = String(f.get("priceRange") ?? "").replace(/\s+/g, " ").trim().slice(0, 99);

  await db.seoReport.create({ data: { businessId, kind: SCHEMA_KIND, data: { version: 1, hours, priceRange, updatedAt: new Date().toISOString() } } });
  const old = await db.seoReport.findMany({ where: { businessId, kind: SCHEMA_KIND }, orderBy: { createdAt: "desc" }, skip: SCHEMA_KEEP, select: { id: true } });
  if (old.length) await db.seoReport.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  revalidatePath(`/b/${businessId}/seo`);
  return {
    ok: true,
    message: Object.keys(hours).length
      ? t("Listo: guardamos tu horario. El código de arriba ya lo incluye; vuelve a copiarlo y pégalo en tu página.", "Done: we saved your hours. The code above already includes them; copy it again and paste it on your website.")
      : t("Listo: guardado. Sin días abiertos, el código no lleva horario.", "Done: saved. With no open days, the code has no hours."),
  };
}
