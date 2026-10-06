"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { errorText, intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import {
  BACKLINKS_KEEP,
  BACKLINKS_KIND,
  BACKLINKS_LOCKED_KIND,
  NoBacklinksAccessError,
  pickBacklinkCompetitors,
  runBacklinksReport,
} from "@/lib/seo/backlinks";
import { normalizeDomain, readCompetitorsReport } from "@/lib/seo/competitors";
import { dataForSeoEnabled } from "@/lib/seo/dataforseo";

export type BacklinksResult = { ok: boolean; message: string; locked?: boolean } | null;

/** Revisa los enlaces hacia la página del negocio y los de su competencia (DataForSEO Backlinks API, pago por uso). */
export async function runBacklinks(businessId: string, _prev: BacklinksResult, _f: FormData): Promise<BacklinksResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  if (!dataForSeoEnabled())
    return { ok: false, message: t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).") };
  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const self = normalizeDomain(b.website);
  if (!self) return { ok: false, message: t("Primero agrega la dirección de tu página web en Ajustes del negocio.", "First add your website address in Business settings.") };

  // La competencia sale del último reporte de "Tu competencia en Google" (si no hay, se revisa solo tu página).
  const [compRow] = await db.seoReport.findMany({ where: { businessId, kind: "competitors" }, orderBy: { createdAt: "desc" }, take: 1 });
  const competitors = pickBacklinkCompetitors(compRow ? readCompetitorsReport(compRow.data) : null, self);

  try {
    const report = await runBacklinksReport({ website: b.website, competitors });
    await db.seoReport.create({ data: { businessId, kind: BACKLINKS_KIND, data: report as unknown as Prisma.InputJsonValue } });
    // Solo se guardan los últimos reportes; y ya hay acceso, así que se borra el aviso de "sin acceso".
    const old = await db.seoReport.findMany({ where: { businessId, kind: BACKLINKS_KIND }, orderBy: { createdAt: "desc" }, skip: BACKLINKS_KEEP, select: { id: true } });
    await db.seoReport.deleteMany({ where: { OR: [{ id: { in: old.map((o) => o.id) } }, { businessId, kind: BACKLINKS_LOCKED_KIND }] } });
    revalidatePath(`/b/${businessId}/seo`);
    const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(report.cost);
    const domains = report.summary.referringDomains ?? report.referringTotal ?? 0;
    return {
      ok: true,
      message:
        t(
          `Listo: ${domains} ${domains === 1 ? "sitio te enlaza" : "sitios te enlazan"}` +
            (competitors.length ? ` y encontramos ${report.gap.length} ${report.gap.length === 1 ? "sitio" : "sitios"} donde tu competencia tiene enlace y tú no` : "") +
            `. Costo: ${money}.`,
          `Done: ${domains} ${domains === 1 ? "site links" : "sites link"} to you` +
            (competitors.length ? ` and we found ${report.gap.length} ${report.gap.length === 1 ? "site" : "sites"} where your competitors have a link and you don't` : "") +
            `. Cost: ${money}.`,
        ) + (report.notes.length ? t(" Algunos datos no se pudieron traer (ver notas).", " Some data couldn't be fetched (see notes).") : ""),
    };
  } catch (e) {
    if (e instanceof NoBacklinksAccessError) {
      // Se guarda una marca (sin costo: DataForSEO no cobra las llamadas rechazadas) para mostrar la explicación.
      await db.seoReport.deleteMany({ where: { businessId, kind: BACKLINKS_LOCKED_KIND } });
      await db.seoReport.create({ data: { businessId, kind: BACKLINKS_LOCKED_KIND, data: { locked: true, at: new Date().toISOString() } } });
      revalidatePath(`/b/${businessId}/seo`);
      return {
        ok: false,
        locked: true,
        message: t(
          "Tu cuenta de DataForSEO todavía no tiene activada la parte de Enlaces. No se cobró nada. Abajo te explicamos cómo activarla.",
          "Your DataForSEO account doesn't have the Links part turned on yet. Nothing was charged. Below we explain how to turn it on.",
        ),
      };
    }
    return { ok: false, message: errorText(e, lang) };
  }
}
