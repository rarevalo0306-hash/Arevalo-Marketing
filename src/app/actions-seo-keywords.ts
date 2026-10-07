"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readTrackedKeywords, readZones, type Zone, zoneLabel } from "@/lib/seo/dataforseo";
import { cleanKeyword, costText, keywordReport, type KeywordsReport, MAX_TRACKED } from "@/lib/seo/keywords";
import { saveReport } from "@/lib/seo/reports";
import { readStudy } from "@/lib/study-shape";

export type KeywordsResult = { ok: boolean; message: string } | null;

/**
 * Pide a Google Ads (DataForSEO) las búsquedas reales de las palabras clave en cada zona elegida y guarda
 * un reporte por zona. Las zonas van una tras otra (DataForSEO permite 12 llamadas por minuto); las ideas
 * nuevas se buscan solo en la zona principal para no gastar de más.
 */
export async function refreshKeywords(businessId: string, _prev: KeywordsResult, _f: FormData): Promise<KeywordsResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  if (!dataForSeoEnabled())
    return { ok: false, message: t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).") };
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { seoLocations: true, seoLocationCode: true, seoLocationName: true, seoLanguage: true, seoKeywords: true, study: true },
  });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  if (!zones.length)
    return { ok: false, message: t("Primero elige tu zona de Google en el panel de arriba y guarda.", "First pick your Google area in the panel above and save.") };
  const tracked = readTrackedKeywords(b.seoKeywords);
  if (tracked.length === 0)
    return { ok: false, message: t("Primero escribe al menos una palabra clave en el panel de arriba y guarda.", "First enter at least one keyword in the panel above and save.") };

  const study = readStudy(b.study);
  const keywords = [...tracked, ...(study?.keywords.map((k) => k.keyword) ?? [])];
  const language = b.seoLanguage === "en" ? "en" : "es";
  const done: { zone: Zone; report: KeywordsReport }[] = [];
  const failed: { zone: Zone; error: unknown }[] = [];
  for (const [i, zone] of zones.entries()) {
    try {
      const report = await keywordReport({ keywords, seeds: tracked, locationCode: zone.code, locationName: zone.name, language, ideas: i === 0 });
      await saveReport(businessId, "keywords", report as unknown as Prisma.InputJsonValue);
      done.push({ zone, report });
    } catch (error) {
      failed.push({ zone, error });
    }
  }
  if (!done.length) return { ok: false, message: errorText(failed[0]?.error, lang) };
  revalidatePath(`/b/${businessId}/seo`);
  revalidatePath(`/b/${businessId}/estudio`);

  const main = done.find((d) => d.zone.code === zones[0].code)?.report;
  const first = main ?? done[0].report;
  const n = first.keywords.length;
  const withData = first.keywords.filter((k) => k.volume !== null).length;
  const cost = costText(done.reduce((s, d) => s + d.report.cost, 0));
  const areas = done.length;
  const failedNames = failed.map((f) => zoneLabel(f.zone.name) || String(f.zone.code)).join(", ");
  return {
    ok: true,
    message:
      (zones.length > 1
        ? t(
            `Listo: medimos ${n} ${n === 1 ? "palabra clave" : "palabras clave"} en ${areas} ${areas === 1 ? "zona" : "zonas"} (${withData} con datos de Google en la primera).`,
            `Done: we measured ${n} ${n === 1 ? "keyword" : "keywords"} in ${areas} ${areas === 1 ? "area" : "areas"} (${withData} with Google data in the first one).`,
          )
        : t(
            `Listo: medimos ${n} ${n === 1 ? "palabra clave" : "palabras clave"} (${withData} con datos de Google).`,
            `Done: we measured ${n} ${n === 1 ? "keyword" : "keywords"} (${withData} with Google data).`,
          )) +
      (main ? t(` Encontramos ${main.ideas.length} ideas nuevas.`, ` We found ${main.ideas.length} new ideas.`) : "") +
      t(` Costo total: ${cost}.`, ` Total cost: ${cost}.`) +
      (main?.ideasFailed ? t(" Las ideas nuevas no se pudieron traer esta vez; inténtalo de nuevo en un minuto.", " New ideas couldn't be fetched this time; try again in a minute.") : "") +
      (failed.length
        ? t(
            ` No se pudo medir en: ${failedNames} (${errorText(failed[0].error, "es")}). Vuelve a intentarlo en un minuto.`,
            ` Couldn't measure in: ${failedNames} (${errorText(failed[0].error, "en")}). Try again in a minute.`,
          )
        : ""),
  };
}

/** Agrega una idea a las palabras clave que sigue el negocio (máximo 25, sin repetir, en minúsculas). */
export async function trackKeyword(businessId: string, keyword: string): Promise<{ ok: boolean; message: string }> {
  const { t } = await getT();
  const k = cleanKeyword(String(keyword ?? ""));
  if (!k) return { ok: false, message: t("Palabra clave vacía.", "Empty keyword.") };
  const b = await db.business.findUnique({ where: { id: businessId }, select: { seoKeywords: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const tracked = readTrackedKeywords(b.seoKeywords).map((x) => x.toLowerCase());
  if (tracked.includes(k)) return { ok: true, message: t("Ya la sigues.", "You already track it.") };
  if (tracked.length >= MAX_TRACKED)
    return { ok: false, message: t(`Ya sigues ${MAX_TRACKED} palabras clave. Quita alguna en la pestaña «⚙ Ajustes».`, `You already track ${MAX_TRACKED} keywords. Remove one in the “⚙ Settings” tab.`) };
  await db.business.update({ where: { id: businessId }, data: { seoKeywords: [...tracked, k] } });
  revalidatePath(`/b/${businessId}/seo`);
  return { ok: true, message: t("Agregada.", "Added.") };
}
