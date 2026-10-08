import { after } from "next/server";
import { getT } from "@/lib/i18n-server";
import { runDueDriveSync, runDueUploadAnalysis } from "@/lib/library-sync";
import { publishDue } from "@/lib/publish";
import { runWeeklyReports } from "@/lib/seo/alerts";
import { runDueRankChecks } from "@/lib/seo/rank";
import { runMonthlyReports } from "@/lib/seo/report-run";
import { safeEqual } from "@/lib/session";

export const dynamic = "force-dynamic";
// La revisión automática de posiciones en Google (después de responder) puede tardar 1-2 minutos.
export const maxDuration = 300;

/** Publica lo programado. Llámalo cada minuto con: Authorization: Bearer <CRON_SECRET>. */
export async function GET(req: Request) {
  const started = Date.now();
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    const { t } = await getT();
    return new Response(t("No autorizado", "Unauthorized"), { status: 401 });
  }
  const published = await publishDue();
  // Posiciones en Google: como mucho UN negocio por llamada, después de responder (no retrasa ni rompe lo de publicar).
  after(async () => {
    try {
      const rank = await runDueRankChecks();
      if (rank) console.log("[posiciones] revisión automática:", JSON.stringify(rank));
    } catch (e) {
      console.error("[posiciones] error en la revisión automática:", e);
    }
    // Resumen SEO de cada lunes: como mucho UN negocio por llamada.
    try {
      const weekly = await runWeeklyReports();
      if (weekly?.ok) console.log("[reporte-semanal] enviado:", weekly.businessId);
    } catch (e) {
      console.error("[reporte-semanal] error:", e instanceof Error ? e.message : e);
    }
    // Reporte en PDF de cada mes (el día 1): como mucho UN negocio por llamada.
    try {
      const monthly = await runMonthlyReports();
      if (monthly?.ok) console.log("[reporte-mensual] enviado:", monthly.businessId, `${monthly.ms} ms`);
    } catch (e) {
      console.error("[reporte-mensual] error:", e instanceof Error ? e.message : e);
    }
    // Carpeta de fotos de Google Drive: como mucho UN negocio por llamada (cada 24 h, o antes si quedaron fotos por revisar).
    try {
      // Usa el tiempo que queda de los 300 s (deja margen para terminar la tanda en curso).
      const drive = await runDueDriveSync(new Date(), 240_000 - (Date.now() - started));
      if (drive) console.log("[drive] revisión automática:", drive.businessId, JSON.stringify(drive.result));
    } catch (e) {
      console.error("[drive] error en la revisión automática:", e instanceof Error ? e.message : e);
    }
    // Fotos y videos subidos con el link de los técnicos que quedaron sin revisar: como mucho UN negocio por llamada.
    try {
      const up = await runDueUploadAnalysis(new Date(), 270_000 - (Date.now() - started));
      if (up) console.log("[subir] revisión automática:", up.businessId, JSON.stringify(up.result));
    } catch (e) {
      console.error("[subir] error en la revisión automática:", e instanceof Error ? e.message : e);
    }
  });
  return Response.json({ published });
}
