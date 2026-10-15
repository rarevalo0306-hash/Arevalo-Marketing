"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { deniedText, hasBusiness } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensure } from "@/lib/ensure";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readZones } from "@/lib/seo/dataforseo";
import { IDEAS_KIND, runIdeas } from "@/lib/seo/ideas";
import { costText } from "@/lib/seo/keywords";
import { saveReport } from "@/lib/seo/reports";

export type IdeasResult = { ok: boolean; message: string } | null;

/** «Buscar ideas»: cientos de búsquedas que contienen la palabra que escribió (DataForSEO Labs, unos centavos). */
export async function findIdeas(businessId: string, _prev: IdeasResult, f: FormData): Promise<IdeasResult> {
  ensure.text(businessId);
  void _prev;
  const { lang, t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  if (!dataForSeoEnabled())
    return { ok: false, message: t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).") };
  const seed = String(f.get("seed") ?? "").slice(0, 120);
  const b = await db.business.findUnique({ where: { id: businessId }, select: { seoLocations: true, seoLocationCode: true, seoLocationName: true, seoLanguage: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  if (!zones.length) return { ok: false, message: t("Primero elige la zona donde buscan tus clientes en la pestaña «⚙ Ajustes».", "First pick the area where your customers search in the “⚙ Settings” tab.") };
  try {
    const report = await runIdeas({ seed, zone: zones[0], language: b.seoLanguage === "en" ? "en" : "es" });
    await saveReport(businessId, IDEAS_KIND, report as unknown as Prisma.InputJsonValue);
    revalidatePath(`/b/${businessId}/seo`);
    return {
      ok: true,
      message: report.rows.length
        ? t(`Listo: ${report.rows.length} ideas para «${report.seed}». Costó ${costText(report.cost)}.`, `Done: ${report.rows.length} ideas for “${report.seed}”. It cost ${costText(report.cost)}.`)
        : t(`DataForSEO no tiene búsquedas con «${report.seed}». Prueba con una palabra más general.`, `DataForSEO has no searches with “${report.seed}”. Try a more general word.`),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
