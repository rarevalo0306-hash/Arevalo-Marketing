"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { errorText, intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, zoneLabel } from "@/lib/seo/dataforseo";
import { checkRankings, rankSetup } from "@/lib/seo/rank";
import { saveReport } from "@/lib/seo/reports";

export type RankResult = { ok: boolean; message: string } | null;

/** Revisa en Google (celular) la posición del negocio para cada palabra clave que sigue, en cada zona, y guarda un reporte por zona. */
export async function runRankCheck(businessId: string, _prev: RankResult, _f: FormData): Promise<RankResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  if (!dataForSeoEnabled())
    return { ok: false, message: t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).") };
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, seoLanguage: true, seoKeywords: true },
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
    const { reports, failed } = await checkRankings({
      keywords: setup.keywords,
      domain: setup.domain,
      businessName: b.name,
      zones: setup.zones,
      language: b.seoLanguage === "en" ? "en" : "es",
    });
    for (const report of reports) await saveReport(businessId, "rank", report as unknown as Prisma.InputJsonValue);
    revalidatePath(`/b/${businessId}/seo`);
    const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(
      Math.round(reports.reduce((s, r) => s + r.cost, 0) * 10000) / 10000,
    );
    const main = reports.find((r) => r.locationCode === setup.zones[0].code) ?? reports[0];
    const n = main.rows.length;
    const failedRows = reports.reduce((s, r) => s + r.rows.filter((x) => x.error).length, 0);
    const top10 = main.inTop10;
    const where = reports.length > 1 ? t(` en ${reports.length} zonas`, ` in ${reports.length} areas`) : "";
    const mainName = zoneLabel(main.location) || t("tu zona principal", "your main area");
    return {
      ok: true,
      message:
        t(
          `Listo: revisamos ${n} ${n === 1 ? "palabra clave" : "palabras clave"}${where}. Sales en los primeros 10 en ${top10}${reports.length > 1 ? ` (en ${mainName})` : ""}. Costó ${money}.`,
          `Done: we checked ${n} ${n === 1 ? "keyword" : "keywords"}${where}. You're in the top 10 for ${top10}${reports.length > 1 ? ` (in ${mainName})` : ""}. It cost ${money}.`,
        ) +
        (failedRows
          ? t(` ${failedRows} consultas no se pudieron revisar esta vez; vuelve a intentarlo más tarde.`, ` ${failedRows} lookups couldn't be checked this time; try again later.`)
          : "") +
        (failed.length
          ? t(
              ` No se pudo revisar en: ${failed.map((f) => zoneLabel(f.zone.name) || f.zone.code).join(", ")}.`,
              ` Couldn't check in: ${failed.map((f) => zoneLabel(f.zone.name) || f.zone.code).join(", ")}.`,
            )
          : ""),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
