"use server";

import { revalidatePath } from "next/cache";
import { searchLocations, type DfsLocation } from "@/lib/seo/dataforseo";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";

export type LocationSearch = { ok: true; locations: DfsLocation[] } | { ok: false; error: string };

/** Busca zonas de Google por nombre dentro de un país (gratis en DataForSEO). */
export async function searchSeoLocations(country: string, query: string): Promise<LocationSearch> {
  const { lang } = await getT();
  if (query.trim().length < 2) return { ok: true, locations: [] };
  try {
    return { ok: true, locations: await searchLocations(country, query.slice(0, 80)) };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

export type SeoSettingsResult = { ok: boolean; message: string } | null;

/** Guarda la zona de Google, el idioma, las palabras clave que se siguen y la revisión diaria. */
export async function saveSeoSettings(businessId: string, _prev: SeoSettingsResult, f: FormData): Promise<SeoSettingsResult> {
  const { t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const code = Number(f.get("locationCode"));
  const keywords = [
    ...new Set(
      String(f.get("keywords") ?? "")
        .split("\n")
        .map((k) => k.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80))
        .filter(Boolean),
    ),
  ].slice(0, 25);
  await db.business.update({
    where: { id: businessId },
    data: {
      seoLocationCode: Number.isInteger(code) && code > 0 ? code : null,
      seoLocationName: String(f.get("locationName") ?? "").slice(0, 200),
      seoLanguage: f.get("language") === "en" ? "en" : "es",
      seoKeywords: keywords,
      seoDaily: f.get("daily") === "on",
    },
  });
  revalidatePath(`/b/${businessId}/seo`);
  return { ok: true, message: t(`Guardado: ${keywords.length} palabras clave.`, `Saved: ${keywords.length} keywords.`) };
}
