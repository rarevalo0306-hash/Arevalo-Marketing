"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { runAudit } from "@/lib/seo/audit";
import { saveReport } from "@/lib/seo/reports";

export type AuditResult = { ok: boolean; message: string } | null;

/** Revisa la página web del negocio (gratis, sin claves) y guarda el reporte. */
export async function runSiteAudit(businessId: string, _prev: AuditResult, _f: FormData): Promise<AuditResult> {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  if (!b.website.trim())
    return { ok: false, message: t("Primero agrega la dirección de tu página web en Ajustes del negocio.", "First add your website address in Business settings.") };
  try {
    const report = await runAudit(b.website);
    await saveReport(businessId, "audit", report as unknown as Prisma.InputJsonValue);
    revalidatePath(`/b/${businessId}/seo`);
    const errors = report.issues.filter((i) => i.severity === "error").length;
    const n = report.pages.length;
    const speed = "error" in report.pagespeed ? t(" No se pudo medir la velocidad con Google esta vez.", " Google's speed test didn't work this time.") : "";
    return {
      ok: true,
      message:
        t(
          `Listo: revisamos ${n} ${n === 1 ? "página" : "páginas"}. Puntaje ${report.score}/100${errors ? `, con ${errors} ${errors === 1 ? "error importante" : "errores importantes"} para arreglar primero` : ""}.`,
          `Done: we checked ${n} ${n === 1 ? "page" : "pages"}. Score ${report.score}/100${errors ? `, with ${errors} major ${errors === 1 ? "error" : "errors"} to fix first` : ""}.`,
        ) + speed,
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
