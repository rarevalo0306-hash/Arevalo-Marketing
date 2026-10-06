"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { errorText, intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { normalizeDomain, readCompetitorsReport } from "@/lib/seo/competitors";
import { dataForSeoEnabled, readZones } from "@/lib/seo/dataforseo";
import { latestReports } from "@/lib/seo/reports";
import { hasData, pickTrafficCompetitors, runTrafficReport, TRAFFIC_KEEP, TRAFFIC_KIND } from "@/lib/seo/traffic";

export type TrafficResult = { ok: boolean; message: string } | null;

/** Revisa las visitas (estimadas) de tu página y de tu competencia, con su historial (DataForSEO Labs, pago por uso). */
export async function runTraffic(businessId: string, _prev: TrafficResult, _f: FormData): Promise<TrafficResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  if (!dataForSeoEnabled())
    return { ok: false, message: t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).") };
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, seoLanguage: true },
  });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const self = normalizeDomain(b.website);
  if (!self) return { ok: false, message: t("Primero agrega la dirección de tu página web en Ajustes del negocio.", "First add your website address in Business settings.") };
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  if (!zones.length)
    return { ok: false, message: t("Primero elige la zona donde buscan tus clientes (arriba, en Datos reales de Google).", "First pick the area where your customers search (above, in Real Google data).") };

  // Sin reporte de competencia se revisa solo tu página.
  const [compRow] = await latestReports(businessId, "competitors", 1);
  const competitors = pickTrafficCompetitors(compRow ? readCompetitorsReport(compRow.data) : null, self);

  try {
    const report = await runTrafficReport({
      website: b.website,
      // DataForSEO Labs solo trabaja por país: se usa el de la zona principal (igual que la competencia).
      locationCode: zones[0].code,
      locationName: zones[0].name,
      language: b.seoLanguage === "en" ? "en" : "es",
      competitors,
    });
    await db.seoReport.create({ data: { businessId, kind: TRAFFIC_KIND, data: report as unknown as Prisma.InputJsonValue } });
    // Solo se guardan los últimos reportes de visitas.
    const old = await db.seoReport.findMany({ where: { businessId, kind: TRAFFIC_KIND }, orderBy: { createdAt: "desc" }, skip: TRAFFIC_KEEP, select: { id: true } });
    if (old.length) await db.seoReport.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    revalidatePath(`/b/${businessId}/seo`);

    const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(report.cost);
    const empty = report.domains.filter((d) => !hasData(d) && !d.failed).length;
    const total = report.domains.length;
    const extra =
      (empty ? t(` ${empty} de ${total} no tienen datos (sitios chicos o nuevos).`, ` ${empty} of ${total} have no data (small or new sites).`) : "") +
      (report.notes.length ? t(" Algunos datos no se pudieron traer (ver notas).", " Some data couldn't be fetched (see notes).") : "");
    return {
      ok: true,
      message:
        (total === 1
          ? t(`Listo: revisamos las visitas de tu página. Busca a tu competencia para compararte. Costo: ${money}.`, `Done: we checked your website's visits. Find your competition to compare yourself. Cost: ${money}.`)
          : t(`Listo: revisamos las visitas de tu página y de ${total - 1} ${total - 1 === 1 ? "competidor" : "competidores"}. Costo: ${money}.`, `Done: we checked the visits of your website and ${total - 1} ${total - 1 === 1 ? "competitor" : "competitors"}. Cost: ${money}.`)) + extra,
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
