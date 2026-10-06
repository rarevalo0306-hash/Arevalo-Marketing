"use server";

import { revalidatePath } from "next/cache";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { buildCannibal, compareCannibal, latestCannibalReports, loadCannibalInput, saveCannibalReport } from "@/lib/seo/cannibal";

export type CannibalResult = { ok: boolean; message: string } | null;

/**
 * "Revisar de nuevo": arma la revisión de páginas que compiten entre sí con los reportes ya guardados
 * (Search Console, posiciones y la revisión de la página) y la guarda. No llama a ninguna API: cuesta US$0.
 */
export async function runCannibal(businessId: string, _prev: CannibalResult, f: FormData): Promise<CannibalResult> {
  void _prev;
  void f;
  const { lang, t } = await getT();
  try {
    const input = await loadCannibalInput(businessId);
    if (!input) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
    const report = buildCannibal(input);
    if (!report.source)
      return {
        ok: false,
        message: t(
          "Todavía no hay datos para revisar. Conecta Search Console (gratis) o revisa tus posiciones primero.",
          "There's no data to check yet. Connect Search Console (free) or check your rankings first.",
        ),
      };
    const [previous] = await latestCannibalReports(businessId, 1);
    await saveCannibalReport(businessId, report);
    revalidatePath(`/b/${businessId}/seo`);
    const total = report.issues.length;
    if (!total) return { ok: true, message: t("Listo: ninguna de tus páginas compite con otra. Costo: US$0.", "Done: none of your pages compete with each other. Cost: US$0.") };
    const diff = previous?.report ? compareCannibal(report, previous.report) : null;
    const change = diff
      ? t(` Desde la revisión anterior: ${diff.added} nuevas y ${diff.solved} resueltas.`, ` Since the previous check: ${diff.added} new and ${diff.solved} solved.`)
      : "";
    return {
      ok: true,
      message:
        t(
          `Listo: ${total} ${total === 1 ? "búsqueda tiene" : "búsquedas tienen"} varias páginas tuyas compitiendo.`,
          `Done: ${total} ${total === 1 ? "search has" : "searches have"} several of your pages competing.`,
        ) +
        change +
        t(" Costo: US$0.", " Cost: US$0."),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
