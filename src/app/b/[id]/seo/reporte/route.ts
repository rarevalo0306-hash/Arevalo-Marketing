import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { asLang, errorText, translator } from "@/lib/i18n";
import { uiLang } from "@/lib/i18n-server";
import { asPreset } from "@/lib/seo/report";
import { createReport } from "@/lib/seo/report-run";
import { safeEqual, SESSION_COOKIE, sessionToken } from "@/lib/session";

// El PDF se arma en Node (react-pdf, sharp y las letras del disco). Con el resumen de la IA puede tardar unos segundos.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** El último valor de un parámetro (el formulario manda "0" escondido y luego "1" si la casilla está marcada). */
const last = (u: URLSearchParams, key: string) => u.getAll(key).pop() ?? null;
const on = (v: string | null) => v === "1" || v === "on" || v === "true";

/**
 * Descarga el reporte en PDF: ?periodo=este-mes|mes-pasado|30-dias&lang=es|en&ia=1&marca=0|1.
 * Solo lee lo guardado (no gasta DataForSEO); ia=1 pide el resumen a la IA (unos centavos).
 * Protegido por el middleware (hay que haber entrado) y, por si acaso, se revisa la sesión aquí también.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = new URL(req.url).searchParams;
  const lang = u.has("lang") ? asLang(last(u, "lang")) : await uiLang();
  const t = translator(lang);
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  if (!process.env.APP_PASSWORD || !safeEqual(session, await sessionToken())) return new Response(t("No autorizado", "Unauthorized"), { status: 401 });

  const b = await db.business.findUnique({ where: { id }, select: { id: true } });
  if (!b) return new Response(t("Negocio no encontrado", "Business not found"), { status: 404 });

  try {
    const report = await createReport(id, {
      preset: asPreset(last(u, "periodo")),
      lang,
      ai: on(last(u, "ia")),
      whiteLabel: u.has("marca") ? !on(last(u, "marca")) : false,
    });
    console.log(`[reporte] ${id}: ${report.pdf.length} bytes en ${report.ms} ms (resumen: ${report.summary.source})`);
    return new Response(new Uint8Array(report.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${report.fileName}"`,
        "Content-Length": String(report.pdf.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error(`[reporte] ${id}:`, e);
    return new Response(t(`No se pudo armar el reporte: ${errorText(e, "es")}`, `Couldn't build the report: ${errorText(e, "en")}`), {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
