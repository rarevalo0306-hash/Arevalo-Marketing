"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { errorText, intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { normalizeDomain, readCompetitorsReport } from "@/lib/seo/competitors";
import { dataForSeoEnabled, readZones } from "@/lib/seo/dataforseo";
import { businessTopicVocab, gbpCategory, pickGapCompetitors, runGapReport } from "@/lib/seo/gap";
import { latestReports, saveReport } from "@/lib/seo/reports";

export type GapResult = { ok: boolean; message: string } | null;

/** Busca las palabras que tu competencia tiene y tú no (DataForSEO Labs, pago por uso) y guarda el reporte. */
export async function runGap(businessId: string, _prev: GapResult, _f: FormData): Promise<GapResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  if (!dataForSeoEnabled())
    return { ok: false, message: t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).") };
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, seoLanguage: true, seoKeywords: true, study: true },
  });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  if (!normalizeDomain(b.website)) return { ok: false, message: t("Primero agrega la dirección de tu página web en Ajustes del negocio.", "First add your website address in Business settings.") };
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  if (!zones.length)
    return { ok: false, message: t("Primero elige la zona donde buscan tus clientes (arriba, en Datos reales de Google).", "First pick the area where your customers search (above, in Real Google data).") };
  const [[compRow], [gbpRow]] = await Promise.all([latestReports(businessId, "competitors", 1), latestReports(businessId, "gbp", 1)]);
  const competitors = pickGapCompetitors(compRow ? readCompetitorsReport(compRow.data) : null);
  if (!competitors.length)
    return {
      ok: false,
      message: t(
        'Primero busca a tu competencia con el botón "Buscar mi competencia" (arriba). Así sabemos con quién compararte.',
        'First find your competition with the "Find my competition" button (above). That way we know who to compare you with.',
      ),
    };

  try {
    const report = await runGapReport({
      website: b.website,
      // DataForSEO Labs solo trabaja por país: se usa el de la zona principal.
      locationCode: zones[0].code,
      locationName: zones[0].name,
      language: b.seoLanguage === "en" ? "en" : "es",
      competitors,
      // Lo que vende el negocio: las búsquedas que no tienen que ver (de directorios, otros rubros) van aparte.
      vocab: businessTopicVocab({ ...b, category: gbpRow ? gbpCategory(gbpRow.data) : null }),
    });
    await saveReport(businessId, "gap", report as unknown as Prisma.InputJsonValue);
    revalidatePath(`/b/${businessId}/seo`);
    const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(report.cost);
    const missing = report.rows.filter((r) => r.type === "missing").length;
    const weak = report.rows.length - missing;
    if (!report.rows.length)
      return {
        ok: true,
        message: t(
          `No encontramos búsquedas donde tu competencia te gane. Costo: ${money}.`,
          `We didn't find searches where your competitors beat you. Cost: ${money}.`,
        ),
      };
    return {
      ok: true,
      message:
        t(
          `Listo: ${missing} ${missing === 1 ? "búsqueda" : "búsquedas"} que te faltan y ${weak} donde estás más abajo que tu competencia. Costo: ${money}.`,
          `Done: ${missing} ${missing === 1 ? "search" : "searches"} you're missing and ${weak} where you rank below your competitors. Cost: ${money}.`,
        ) + (report.notes.length ? t(" Algunos datos no se pudieron traer (ver notas).", " Some data couldn't be fetched (see notes).") : ""),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
