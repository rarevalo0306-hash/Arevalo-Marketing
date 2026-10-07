"use server";

import { revalidatePath } from "next/cache";
import { searchLocations, type DfsLocation } from "@/lib/seo/dataforseo";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { locationChildren, searchCountry } from "@/lib/seo/locations";
import { applySettingsForm } from "@/lib/seo/setup";
import type { TreeLocation } from "@/lib/seo/setup-shared";

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

export type TreeResult = { ok: true; locations: TreeLocation[] } | { ok: false; error: string };

/** Lo que hay dentro de una zona (parent = null: el país y sus estados/departamentos). Gratis. */
export async function seoLocationChildren(country: string, parent: number | null): Promise<TreeResult> {
  const { lang } = await getT();
  try {
    return { ok: true, locations: await locationChildren(country, parent) };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

/** Busca zonas por nombre dentro de un país, con su zona "padre" (incluye barrios y códigos postales). Gratis. */
export async function searchSeoPlaces(country: string, query: string): Promise<TreeResult> {
  const { lang } = await getT();
  if (query.trim().length < 2) return { ok: true, locations: [] };
  try {
    return { ok: true, locations: await searchCountry(country, query.slice(0, 80)) };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

export type SeoSettingsResult = { ok: boolean; message: string } | null;

/** Guarda las zonas de Google, el idioma, las palabras clave que se siguen y cada cuánto se revisan las posiciones. */
export async function saveSeoSettings(businessId: string, _prev: SeoSettingsResult, f: FormData): Promise<SeoSettingsResult> {
  const { t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const { zones, keywords } = await applySettingsForm(businessId, f);
  revalidatePath(`/b/${businessId}/seo`);
  return {
    ok: true,
    message: t(`Guardado: ${zones.length} ${zones.length === 1 ? "zona" : "zonas"} y ${keywords.length} palabras clave.`, `Saved: ${zones.length} ${zones.length === 1 ? "area" : "areas"} and ${keywords.length} keywords.`),
  };
}
