"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { deniedText, hasBusiness } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensure } from "@/lib/ensure";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { compareDomains, runCompare } from "@/lib/seo/compare";
import { normalizeDomain } from "@/lib/seo/competitors";
import { dataForSeoEnabled, readZones } from "@/lib/seo/dataforseo";
import { costText } from "@/lib/seo/keywords";
import { saveReport } from "@/lib/seo/reports";

export type CompareResult = { ok: boolean; message: string } | null;

/** Compara la página del negocio con hasta 4 más (las que escribió en el formulario) y guarda la comparación. */
export async function compareSites(businessId: string, _prev: CompareResult, f: FormData): Promise<CompareResult> {
  ensure.text(businessId);
  void _prev;
  const { lang, t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  if (!dataForSeoEnabled())
    return { ok: false, message: t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).") };
  const typed = f
    .getAll("domain")
    .map((v) => (typeof v === "string" ? v.trim().slice(0, 200) : ""))
    .filter(Boolean)
    .slice(0, 10);
  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, seoLanguage: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  if (!zones.length) return { ok: false, message: t("Primero elige la zona donde buscan tus clientes en la pestaña «⚙ Ajustes».", "First pick the area where your customers search in the “⚙ Settings” tab.") };
  const own = normalizeDomain(b.website);
  const others = compareDomains(typed, own).filter((d) => d !== own);
  if (!others.length) return { ok: false, message: t("Escribe al menos una página para comparar (ej.: competencia.com).", "Type at least one website to compare (e.g. competitor.com).") };
  try {
    const report = await runCompare({ domains: typed, self: own, zone: zones[0], language: b.seoLanguage === "en" ? "en" : "es" });
    await saveReport(businessId, "compare", report as unknown as Prisma.InputJsonValue);
    revalidatePath(`/b/${businessId}/seo`);
    return {
      ok: true,
      message:
        t(`Listo: comparamos ${report.rows.length} páginas. Costó ${costText(report.cost)}.`, `Done: we compared ${report.rows.length} websites. It cost ${costText(report.cost)}.`) +
        (report.linksLocked ? t(" Los enlaces no se muestran: tu cuenta de DataForSEO no tiene activada esa parte.", " Links aren't shown: your DataForSEO account doesn't have that part turned on.") : ""),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
