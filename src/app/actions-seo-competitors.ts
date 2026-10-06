"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { errorText, intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { normalizeDomain, parseOwnerDomains, runCompetitorsReport } from "@/lib/seo/competitors";
import { dataForSeoEnabled, readTrackedKeywords } from "@/lib/seo/dataforseo";
import { latestReports, saveReport } from "@/lib/seo/reports";

export type CompetitorsResult = { ok: boolean; message: string } | null;

/** Busca a la competencia en Google (DataForSEO Labs, pago por uso) y guarda el reporte. */
export async function runCompetitors(businessId: string, _prev: CompetitorsResult, f: FormData): Promise<CompetitorsResult> {
  void _prev;
  const { lang, t } = await getT();
  if (!dataForSeoEnabled())
    return { ok: false, message: t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).") };
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { website: true, seoLocationCode: true, seoLocationName: true, seoLanguage: true },
  });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const self = normalizeDomain(b.website);
  if (!self) return { ok: false, message: t("Primero agrega la dirección de tu página web en Ajustes del negocio.", "First add your website address in Business settings.") };
  if (!b.seoLocationCode)
    return { ok: false, message: t("Primero elige la zona donde buscan tus clientes (arriba, en Datos reales de Google).", "First pick the area where your customers search (above, in Real Google data).") };

  const typed = String(f.get("domains") ?? "").slice(0, 1000);
  const owner = parseOwnerDomains(typed, self, 3);
  if (typed.trim() && !owner.length)
    return { ok: false, message: t("No reconocimos esos sitios. Escribe solo la dirección, por ejemplo: competencia.com", "We didn't recognize those websites. Type just the address, for example: competitor.com") };

  try {
    const [rank] = await latestReports(businessId, "rank", 1);
    const report = await runCompetitorsReport({
      website: b.website,
      locationCode: b.seoLocationCode,
      locationName: b.seoLocationName,
      language: b.seoLanguage === "en" ? "en" : "es",
      ownerDomains: owner,
      rankJson: rank?.data ?? null,
    });
    await saveReport(businessId, "competitors", report as unknown as Prisma.InputJsonValue);
    revalidatePath(`/b/${businessId}/seo`);
    const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(report.cost);
    const n = report.competitors.length;
    const g = report.gap.length;
    if (!n)
      return {
        ok: true,
        message: t(
          `No encontramos competidores con datos en Google. Escribe hasta 3 sitios de tu competencia y vuelve a buscar. Costo: ${money}.`,
          `We didn't find competitors with Google data. Type up to 3 competitor websites and search again. Cost: ${money}.`,
        ),
      };
    return {
      ok: true,
      message: t(
        `Listo: ${n} ${n === 1 ? "competidor" : "competidores"} y ${g} ${g === 1 ? "búsqueda" : "búsquedas"} donde ellos salen y tú no. Costo: ${money}.`,
        `Done: ${n} ${n === 1 ? "competitor" : "competitors"} and ${g} ${g === 1 ? "search" : "searches"} where they show up and you don't. Cost: ${money}.`,
      ),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** Agrega una búsqueda de las oportunidades a las palabras clave que sigue el negocio (máx. 25). */
export async function trackGapKeyword(businessId: string, keyword: string): Promise<{ ok: boolean; message: string }> {
  const { t } = await getT();
  const kw = String(keyword ?? "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);
  if (!kw) return { ok: false, message: t("Falta la palabra clave.", "The keyword is missing.") };
  const b = await db.business.findUnique({ where: { id: businessId }, select: { seoKeywords: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const current = [...new Set(readTrackedKeywords(b.seoKeywords).map((k) => k.toLowerCase()))];
  if (current.includes(kw)) return { ok: true, message: t("Ya la sigues.", "You already track it.") };
  if (current.length >= 25)
    return { ok: false, message: t("Ya sigues 25 palabras clave (el máximo). Quita alguna arriba en Datos reales de Google.", "You already track 25 keywords (the max). Remove one above in Real Google data.") };
  await db.business.update({ where: { id: businessId }, data: { seoKeywords: [...current, kw] } });
  revalidatePath(`/b/${businessId}/seo`);
  return { ok: true, message: t("Agregada a tus palabras clave.", "Added to your keywords.") };
}
