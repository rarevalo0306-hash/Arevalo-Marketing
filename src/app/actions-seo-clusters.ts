"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { deniedText, hasBusiness } from "@/lib/auth";
import { ensure } from "@/lib/ensure";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { runClusters } from "@/lib/seo/clusters-load";
import { saveReport } from "@/lib/seo/reports";

export type ClustersResult = { ok: boolean; message: string } | null;

/** «Agrupar mis búsquedas»: arma los temas con lo que ya está guardado (no gasta en DataForSEO). */
export async function buildTopicClusters(businessId: string, _prev: ClustersResult, _f: FormData): Promise<ClustersResult> {
  ensure.text(businessId);
  void _prev;
  void _f;
  const { lang, t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  try {
    const report = await runClusters(businessId);
    if (!report || !report.clusters.length)
      return {
        ok: false,
        message: t(
          "Todavía hay muy pocas búsquedas para agrupar. Primero presiona «Actualizar búsquedas» en Palabras clave o revisa tus posiciones.",
          "There are still too few searches to group. First press “Update searches” in Keywords or check your rankings.",
        ),
      };
    await saveReport(businessId, "clusters", report as unknown as Prisma.InputJsonValue);
    revalidatePath(`/b/${businessId}/seo`);
    const missing = report.clusters.filter((c) => !c.page && !c.article).length;
    return {
      ok: true,
      message: t(
        `Listo: ${report.total} búsquedas en ${report.clusters.length} temas. A ${missing} ${missing === 1 ? "le falta su página" : "les falta su página"}.`,
        `Done: ${report.total} searches in ${report.clusters.length} topics. ${missing} ${missing === 1 ? "is missing its page" : "are missing their page"}.`,
      ),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
