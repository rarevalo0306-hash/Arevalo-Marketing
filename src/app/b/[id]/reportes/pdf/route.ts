import { cookies } from "next/headers";
import { appOrigin } from "@/lib/app-origin";
import { businessTz } from "@/lib/business-tz";
import { buildReportFor, savedHighlights } from "@/lib/daily-report";
import { db } from "@/lib/db";
import { asLang, errorText, translator } from "@/lib/i18n";
import { uiLang } from "@/lib/i18n-server";
import { isSingleDay, parseRange } from "@/lib/report-period";
import { periodPdfName, renderPeriodPdf } from "@/lib/report-period-pdf";
import { ruleHighlights } from "@/lib/report-period-view";
import { loadLogo } from "@/lib/seo/report-pdf";
import { safeEqual, SESSION_COOKIE, sessionToken } from "@/lib/session";

// El PDF se arma en Node (react-pdf, sharp y las letras del disco). Solo lee lo guardado: no gasta nada.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Descarga el reporte de un rango en PDF: ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD&lang=es|en (sin fechas: ayer).
 * Protegido por el middleware (hay que haber entrado) y, por si acaso, se revisa la sesión aquí también.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = new URL(req.url).searchParams;
  const lang = u.has("lang") ? asLang(u.get("lang")) : await uiLang();
  const t = translator(lang);
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  if (!process.env.APP_PASSWORD || !safeEqual(session, await sessionToken())) return new Response(t("No autorizado", "Unauthorized"), { status: 401 });

  const b = await db.business.findUnique({ where: { id }, select: { id: true, name: true, timezone: true, logoUrl: true, seoEmailLang: true } });
  if (!b) return new Response(t("Negocio no encontrado", "Business not found"), { status: 404 });

  try {
    const started = Date.now();
    const period = parseRange({ desde: u.get("desde"), hasta: u.get("hasta") }, businessTz(b));
    const [{ report }, cached, logo, origin] = await Promise.all([
      buildReportFor(id, period),
      isSingleDay(period) && (b.seoEmailLang === "en" ? "en" : "es") === lang ? savedHighlights(id, period.fromDay) : Promise.resolve(null),
      b.logoUrl ? loadLogo(b.logoUrl) : Promise.resolve(null),
      appOrigin(),
    ]);
    const pdf = await renderPeriodPdf(report, { lang, highlights: cached?.items ?? ruleHighlights(report, lang), logo, baseUrl: origin });
    const name = periodPdfName(b.name, report, lang);
    console.log(`[reporte-rango] ${id}: ${pdf.length} bytes en ${Date.now() - started} ms`);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error(`[reporte-rango] ${id}:`, e);
    return new Response(t(`No se pudo armar el PDF: ${errorText(e, "es")}`, `Couldn't build the PDF: ${errorText(e, "en")}`), {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
