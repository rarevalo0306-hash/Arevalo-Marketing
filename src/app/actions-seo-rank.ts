"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { errorText, intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled } from "@/lib/seo/dataforseo";
import { checkRankings, rankSetup } from "@/lib/seo/rank";
import { saveReport } from "@/lib/seo/reports";

export type RankResult = { ok: boolean; message: string } | null;

/** Revisa en Google (celular) la posición del negocio para cada palabra clave que sigue y guarda el reporte. */
export async function runRankCheck(businessId: string, _prev: RankResult, _f: FormData): Promise<RankResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  if (!dataForSeoEnabled())
    return { ok: false, message: t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).") };
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, website: true, seoLocationCode: true, seoLocationName: true, seoLanguage: true, seoKeywords: true },
  });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const setup = rankSetup(b);
  if (!setup.ok) {
    const msg = {
      website: t("Primero agrega la dirección de tu página web en Ajustes del negocio.", "First add your website address in Business settings."),
      location: t("Primero elige la zona donde buscan tus clientes en «Datos reales de Google», aquí arriba.", "First pick the area where your customers search in “Real Google data” above."),
      keywords: t("Primero agrega las palabras clave que quieres seguir en «Datos reales de Google», aquí arriba.", "First add the keywords you want to track in “Real Google data” above."),
    }[setup.missing];
    return { ok: false, message: msg };
  }
  try {
    const report = await checkRankings({
      keywords: setup.keywords,
      domain: setup.domain,
      businessName: b.name,
      locationCode: setup.locationCode,
      location: b.seoLocationName,
      language: b.seoLanguage === "en" ? "en" : "es",
    });
    await saveReport(businessId, "rank", report as unknown as Prisma.InputJsonValue);
    revalidatePath(`/b/${businessId}/seo`);
    const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(report.cost);
    const n = report.rows.length;
    const failed = report.rows.filter((r) => r.error).length;
    const top10 = report.inTop10;
    return {
      ok: true,
      message:
        t(
          `Listo: revisamos ${n} ${n === 1 ? "palabra clave" : "palabras clave"}. Sales en los primeros 10 en ${top10}. Costó ${money}.`,
          `Done: we checked ${n} ${n === 1 ? "keyword" : "keywords"}. You're in the top 10 for ${top10}. It cost ${money}.`,
        ) +
        (failed
          ? t(` ${failed} no se pudieron revisar esta vez; vuelve a intentarlo más tarde.`, ` ${failed} couldn't be checked this time; try again later.`)
          : ""),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
