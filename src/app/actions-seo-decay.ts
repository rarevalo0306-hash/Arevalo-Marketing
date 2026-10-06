"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { BiError, errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { decayReport, saveDecayReport } from "@/lib/seo/decay";
import { explainGscError, GSC_CHANNEL } from "@/lib/seo/gsc";

export type DecayResult = { ok: boolean; message: string; needsGsc?: boolean } | null;

/**
 * "Revisar mis páginas": compara los últimos 28 días de Search Console con los 28 anteriores y con hace 3 meses,
 * y guarda las páginas que están perdiendo visitas. Gratis (Search Console no cobra).
 */
export async function refreshDecay(businessId: string, _prev: DecayResult, _f: FormData): Promise<DecayResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  try {
    const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
    if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
    const conn = await db.connection.findUnique({ where: { businessId_channel: { businessId, channel: GSC_CHANNEL } } });
    if (!conn)
      return {
        ok: false,
        needsGsc: true,
        message: t(
          "Para revisar tus páginas primero conecta Search Console (es gratis). Está más arriba en esta misma página.",
          "To check your pages, first connect Search Console (it's free). It's further up on this same page.",
        ),
      };
    const report = await decayReport(conn);
    await saveDecayReport(businessId, report);
    revalidatePath(`/b/${businessId}/seo`);
    if (!report.pagesChecked)
      return {
        ok: true,
        message: t(
          "Listo, pero todavía no hay páginas con suficientes visitas desde Google para comparar. Vuelve a revisar en unas semanas.",
          "Done, but there are no pages with enough visits from Google to compare yet. Check again in a few weeks.",
        ),
      };
    const n = report.decaying;
    if (!n)
      return {
        ok: true,
        message: t(
          `Listo: revisamos ${report.pagesChecked} ${report.pagesChecked === 1 ? "página" : "páginas"} y ninguna está perdiendo visitas. Costo: US$0.`,
          `Done: we checked ${report.pagesChecked} ${report.pagesChecked === 1 ? "page" : "pages"} and none is losing visits. Cost: US$0.`,
        ),
      };
    return {
      ok: true,
      message: t(
        `Listo: ${n} de ${report.pagesChecked} ${report.pagesChecked === 1 ? "página" : "páginas"} ${n === 1 ? "está" : "están"} perdiendo visitas. Costo: US$0.`,
        `Done: ${n} of ${report.pagesChecked} ${report.pagesChecked === 1 ? "page is" : "pages are"} losing visits. Cost: US$0.`,
      ),
    };
  } catch (e) {
    // Los errores propios (conexión incompleta) ya vienen en palabras claras; los de Google se explican.
    return { ok: false, message: e instanceof BiError ? errorText(e, lang) : explainGscError(errorText(e, lang), t) };
  }
}
