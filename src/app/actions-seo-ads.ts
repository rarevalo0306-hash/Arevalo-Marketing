"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { deniedText, hasBusiness } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensure } from "@/lib/ensure";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { ADS_KIND, advertisersFrom, pickAdCompetitors, runAdsResearch } from "@/lib/seo/ads-research";
import { readCompetitorsReport, withoutDirectories } from "@/lib/seo/competitors";
import { dataForSeoEnabled, readZones } from "@/lib/seo/dataforseo";
import { costText } from "@/lib/seo/keywords";
import { readRankReport } from "@/lib/seo/rank";
import { latestReports, saveReport } from "@/lib/seo/reports";

export type AdsResult = { ok: boolean; message: string } | null;

/** «Ver sus anuncios»: las búsquedas pagadas y los anuncios de hasta 3 competidores (DataForSEO, unos centavos). */
export async function researchAds(businessId: string, _prev: AdsResult, f: FormData): Promise<AdsResult> {
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
    .slice(0, 6);
  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, seoLanguage: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  if (!zones.length) return { ok: false, message: t("Primero elige la zona donde buscan tus clientes en la pestaña «⚙ Ajustes».", "First pick the area where your customers search in the “⚙ Settings” tab.") };
  const [[compRow], rankRows] = await Promise.all([latestReports(businessId, "competitors", 1), latestReports(businessId, "rank", 3 * zones.length)]);
  const comp = compRow ? readCompetitorsReport(compRow.data) : null;
  const ranks = rankRows.map((r) => readRankReport(r.data)).filter((r) => r !== null);
  const domains = pickAdCompetitors({
    typed,
    competitors: comp ? withoutDirectories(comp).report.competitors.map((c) => c.domain) : [],
    advertisers: advertisersFrom(ranks, b.website),
    self: b.website,
  });
  if (!domains.length)
    return { ok: false, message: t("Escribe al menos la página de un competidor, o busca primero tu competencia (arriba).", "Type at least one competitor's website, or first look up your competitors (above).") };
  try {
    const report = await runAdsResearch({ domains, zone: zones[0], language: b.seoLanguage === "en" ? "en" : "es" });
    await saveReport(businessId, ADS_KIND, report as unknown as Prisma.InputJsonValue);
    revalidatePath(`/b/${businessId}/seo`);
    const paying = report.competitors.filter((c) => (c.paidKeywords ?? 0) > 0 || (c.transparency?.recent ?? 0) > 0).length;
    return {
      ok: true,
      message: t(
        `Listo: revisamos ${report.competitors.length} competidores; ${paying} ${paying === 1 ? "paga" : "pagan"} anuncios en Google. Costó ${costText(report.cost)}.`,
        `Done: we checked ${report.competitors.length} competitors; ${paying} ${paying === 1 ? "pays" : "pay"} for Google ads. It cost ${costText(report.cost)}.`,
      ),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
