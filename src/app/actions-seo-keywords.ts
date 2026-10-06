"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readTrackedKeywords } from "@/lib/seo/dataforseo";
import { cleanKeyword, costText, keywordReport, MAX_TRACKED } from "@/lib/seo/keywords";
import { saveReport } from "@/lib/seo/reports";
import { readStudy } from "@/lib/study-shape";

export type KeywordsResult = { ok: boolean; message: string } | null;

/** Pide a Google Ads (DataForSEO) las búsquedas reales de las palabras clave e ideas nuevas, y guarda el reporte. */
export async function refreshKeywords(businessId: string, _prev: KeywordsResult, _f: FormData): Promise<KeywordsResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  if (!dataForSeoEnabled())
    return { ok: false, message: t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).") };
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { seoLocationCode: true, seoLocationName: true, seoLanguage: true, seoKeywords: true, study: true },
  });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  if (!b.seoLocationCode)
    return { ok: false, message: t("Primero elige tu zona de Google en el panel de arriba y guarda.", "First pick your Google area in the panel above and save.") };
  const tracked = readTrackedKeywords(b.seoKeywords);
  if (tracked.length === 0)
    return { ok: false, message: t("Primero escribe al menos una palabra clave en el panel de arriba y guarda.", "First enter at least one keyword in the panel above and save.") };

  const study = readStudy(b.study);
  try {
    const report = await keywordReport({
      keywords: [...tracked, ...(study?.keywords.map((k) => k.keyword) ?? [])],
      seeds: tracked,
      locationCode: b.seoLocationCode,
      locationName: b.seoLocationName,
      language: b.seoLanguage === "en" ? "en" : "es",
    });
    await saveReport(businessId, "keywords", report as unknown as Prisma.InputJsonValue);
    revalidatePath(`/b/${businessId}/seo`);
    revalidatePath(`/b/${businessId}/estudio`);
    const n = report.keywords.length;
    const withData = report.keywords.filter((k) => k.volume !== null).length;
    const cost = costText(report.cost);
    return {
      ok: true,
      message:
        t(
          `Listo: medimos ${n} ${n === 1 ? "palabra clave" : "palabras clave"} (${withData} con datos de Google) y encontramos ${report.ideas.length} ideas nuevas. Costo: ${cost}.`,
          `Done: we measured ${n} ${n === 1 ? "keyword" : "keywords"} (${withData} with Google data) and found ${report.ideas.length} new ideas. Cost: ${cost}.`,
        ) +
        (report.ideasFailed ? t(" Las ideas nuevas no se pudieron traer esta vez; inténtalo de nuevo en un minuto.", " New ideas couldn't be fetched this time; try again in a minute.") : ""),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
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
    return { ok: false, message: t(`Ya sigues ${MAX_TRACKED} palabras clave. Quita alguna en el panel de arriba.`, `You already track ${MAX_TRACKED} keywords. Remove one in the panel above.`) };
  await db.business.update({ where: { id: businessId }, data: { seoKeywords: [...tracked, k] } });
  revalidatePath(`/b/${businessId}/seo`);
  return { ok: true, message: t("Agregada.", "Added.") };
}
