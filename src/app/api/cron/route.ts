import { after } from "next/server";
import { syncAds } from "@/lib/ads";
import { runCampaigns } from "@/lib/campaign-engine";
import { runDailyReports } from "@/lib/daily-report";
import { getT } from "@/lib/i18n-server";
import { runDueDriveSync, runDueUploadAnalysis } from "@/lib/library-sync";
import { syncPostMetrics } from "@/lib/post-metrics";
import { runProposals } from "@/lib/proposals";
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
    // Campañas: termina las vencidas y prepara las publicaciones de los próximos días (pocas por llamada, con candado).
    try {
      const camp = await runCampaigns(new Date(), 100_000);
      if (camp.campaigns || camp.ended) console.log("[campañas]", JSON.stringify(camp));
    } catch (e) {
      console.error("[campañas] error:", e instanceof Error ? e.message : e);
    }
    // Anuncios pagados: pausa en Meta los de campañas paradas, en pausa o terminadas (así PARAR llega a los anuncios).
    try {
      const ads = await syncAds(new Date());
      if (ads.campaigns) console.log("[anuncios]", JSON.stringify(ads));
    } catch (e) {
      console.error("[anuncios] error:", e instanceof Error ? e.message : e);
    }
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
    // Resultados de las publicaciones (alcance, me gusta, comentarios…): lee las que tocan y las guarda en PostMetric.
    try {
      const metrics = await syncPostMetrics(new Date());
      if (metrics.due || metrics.errors) console.log("[resultados]", JSON.stringify(metrics));
    } catch (e) {
      console.error("[resultados] error:", e instanceof Error ? e.message : e);
    }
    // Propuestas de la IA para mejorar (el dueño las acepta o rechaza): pocos negocios por llamada.
    try {
      const props = await runProposals(new Date());
      if (props.businesses || props.expired || props.errors) console.log("[propuestas]", JSON.stringify(props));
    } catch (e) {
      console.error("[propuestas] error:", e instanceof Error ? e.message : e);
    }
    // Reporte diario por email: cierra a la medianoche de cada negocio. Como mucho 5 negocios por llamada y solo
    // mientras no se pasen los primeros 120 s (el resto sigue en la próxima llamada); nunca manda dos veces el mismo día.
    try {
      const daily = await runDailyReports(new Date(), { max: 5, budgetMs: Math.max(10_000, 120_000 - (Date.now() - started)) });
      if (daily.checked) console.log("[reporte-diario]", JSON.stringify(daily));
    } catch (e) {
      console.error("[reporte-diario] error:", e instanceof Error ? e.message : e);
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
