"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { errorText, intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readZones } from "@/lib/seo/dataforseo";
import {
  cleanKeyword,
  findMapPlaces,
  isMapSize,
  isMapSpacing,
  MAP_KEEP,
  type MapCandidate,
  type MapReport,
  readMapPlace,
  readMapReport,
  runMapGrid,
  toMapPlace,
} from "@/lib/seo/maprank";
import { saveReport } from "@/lib/seo/reports";

const notConnected = (t: (es: string, en: string) => string) =>
  t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).");

export type MapPlaceSearch = { ok: true; candidates: MapCandidate[]; cost: number } | { ok: false; error: string };

/** Busca el negocio por su nombre en Google Maps, en la zona principal (una búsqueda ≈ US$0.002). */
export async function findMapPlace(businessId: string, query: string): Promise<MapPlaceSearch> {
  const { lang, t } = await getT();
  if (!dataForSeoEnabled()) return { ok: false, error: notConnected(t) };
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, seoLanguage: true },
  });
  if (!b) return { ok: false, error: t("Negocio no encontrado", "Business not found") };
  const zone = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName)[0];
  if (!zone) return { ok: false, error: t("Primero elige la zona donde buscan tus clientes en «Datos reales de Google».", "First pick the area where your customers search in “Real Google data”.") };
  const q = cleanKeyword(query) || cleanKeyword(b.name);
  if (q.length < 2) return { ok: false, error: t("Escribe el nombre de tu negocio como sale en Google Maps.", "Type your business name as it shows on Google Maps.") };
  try {
    const r = await findMapPlaces({ query: q, zone, language: b.seoLanguage === "en" ? "en" : "es", website: b.website });
    return { ok: true, candidates: r.candidates, cost: r.cost };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

/** Guarda cuál es el negocio en Google Maps (el que eligió el dueño). */
export async function saveMapPlace(businessId: string, place: unknown): Promise<{ ok: boolean; message: string }> {
  const { t } = await getT();
  const p = readMapPlace(place);
  if (!p) return { ok: false, message: t("Ese negocio no tiene ubicación en Google Maps. Elige otro.", "That business has no location on Google Maps. Pick another one.") };
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  await db.business.update({ where: { id: businessId }, data: { seoMapPlace: toMapPlace(p) as unknown as Prisma.InputJsonValue } });
  revalidatePath(`/b/${businessId}/seo`);
  return { ok: true, message: t(`Listo: tu negocio en Google Maps es «${p.title}».`, `Done: your business on Google Maps is “${p.title}”.`) };
}

export type MapRankResult = { ok: boolean; message: string; id?: string } | null;

/** Hace el mapa de calor de una palabra clave: una búsqueda en Google Maps desde cada punto de la cuadrícula. */
export async function runMapRank(businessId: string, _prev: MapRankResult, f: FormData): Promise<MapRankResult> {
  void _prev;
  const { lang, t } = await getT();
  if (!dataForSeoEnabled()) return { ok: false, message: notConnected(t) };
  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true, seoLanguage: true, seoMapPlace: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const place = readMapPlace(b.seoMapPlace);
  if (!place) return { ok: false, message: t("Primero busca y elige tu negocio en Google Maps, aquí arriba.", "First find and pick your business on Google Maps, above.") };
  const picked = String(f.get("keyword") ?? "");
  const keyword = cleanKeyword(picked === "__custom" ? f.get("customKeyword") : picked);
  if (keyword.length < 2) return { ok: false, message: t("Elige o escribe la palabra clave que quieres revisar en el mapa.", "Pick or type the keyword you want to check on the map.") };
  const size = Number(f.get("size"));
  const spacingKm = Number(f.get("spacing"));
  if (!isMapSize(size) || !isMapSpacing(spacingKm)) return { ok: false, message: t("Elige el tamaño del mapa y la distancia entre puntos.", "Pick the map size and the distance between points.") };

  try {
    const report = await runMapGrid({ keyword, place, website: b.website, size, spacingKm, language: b.seoLanguage === "en" ? "en" : "es" });
    const saved = await saveReport(businessId, "maprank", report as unknown as Prisma.InputJsonValue);
    // Se guardan los últimos 30 mapas; los más viejos se borran.
    const old = await db.seoReport.findMany({ where: { businessId, kind: "maprank" }, orderBy: { createdAt: "desc" }, skip: MAP_KEEP, select: { id: true } });
    if (old.length) await db.seoReport.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    revalidatePath(`/b/${businessId}/seo`);

    const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(report.cost);
    const n = report.points.length;
    const failed = report.points.filter((p) => p.error).length;
    const checked = n - failed;
    return {
      ok: true,
      id: saved.id,
      message:
        t(
          `Listo: buscamos «${keyword}» desde ${checked} puntos. Sales en los 3 primeros en el ${report.top3Share} % del mapa y apareces en ${report.found} de ${checked} puntos. Costó ${money}.`,
          `Done: we searched “${keyword}” from ${checked} points. You're in the top 3 on ${report.top3Share}% of the map and show up at ${report.found} of ${checked} points. It cost ${money}.`,
        ) +
        (failed ? t(` ${failed} puntos no se pudieron revisar esta vez (salen con «!»).`, ` ${failed} points couldn't be checked this time (shown with “!”).`) : ""),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** Un mapa guardado (para ver mapas anteriores sin recargar la página). */
export async function loadMapReport(businessId: string, id: string): Promise<(MapReport & { id: string }) | null> {
  const r = await db.seoReport.findFirst({ where: { id: String(id), businessId, kind: "maprank" }, select: { id: true, data: true } });
  const report = r ? readMapReport(r.data) : null;
  return report && r ? { ...report, id: r.id } : null;
}
