"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { explainGscError, GSC_CHANNEL, GSC_COOKIE, saveGscSite, searchConsoleReport, tryFirstGscReport, type GscPending } from "@/lib/seo/gsc";
import { saveReport } from "@/lib/seo/reports";

export type GscResult = { ok: boolean; message: string } | null;

async function ensureBusiness(id: string) {
  const b = await db.business.findUnique({ where: { id }, select: { id: true } });
  if (!b) {
    const { t } = await getT();
    throw new Error(t("Negocio no encontrado", "Business not found"));
  }
}

/** "Actualizar datos": trae los últimos 28 días de Search Console y los guarda. */
export async function refreshSearchConsole(businessId: string, _prev: GscResult, _f: FormData): Promise<GscResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  try {
    await ensureBusiness(businessId);
    const conn = await db.connection.findUnique({ where: { businessId_channel: { businessId, channel: GSC_CHANNEL } } });
    if (!conn) return { ok: false, message: t("Primero conecta Search Console.", "Connect Search Console first.") };
    const report = await searchConsoleReport(conn);
    await saveReport(businessId, "gsc", report);
    revalidatePath(`/b/${businessId}/seo`);
    return {
      ok: true,
      message: report.totals.impressions
        ? t("Listo: datos actualizados.", "Done: data updated.")
        : t(
            "Listo, pero Google todavía no tiene búsquedas para tu página en estas fechas. Si la agregaste hace poco, espera unos días.",
            "Done, but Google doesn't have searches for your website in these dates yet. If you added it recently, wait a few days.",
          ),
    };
  } catch (e) {
    return { ok: false, message: explainGscError(errorText(e, lang), t) };
  }
}

/** Después de "Conectar Search Console", cuando ningún sitio coincide con la página del negocio. */
export async function chooseGscSite(businessId: string, siteUrl: string) {
  await ensureBusiness(businessId);
  const { t } = await getT();
  const jar = await cookies();
  const raw = jar.get(GSC_COOKIE)?.value;
  let saved: GscPending | null = null;
  try {
    saved = raw ? decryptJson<GscPending>(raw) : null;
  } catch {
    saved = null;
  }
  if (!saved || saved.businessId !== businessId || !saved.sites.includes(siteUrl))
    redirect(`/b/${businessId}/seo?${new URLSearchParams({ gsc: "error", msg: t("La conexión venció. Vuelve a intentarlo.", "The connection expired. Please try again.") })}`);
  await saveGscSite(businessId, saved.refreshToken, siteUrl);
  jar.delete(GSC_COOKIE);
  await tryFirstGscReport(businessId);
  revalidatePath(`/b/${businessId}/seo`);
  redirect(`/b/${businessId}/seo?gsc=ok`);
}

/** Quita la conexión con Search Console (los reportes guardados se quedan). */
export async function disconnectSearchConsole(businessId: string) {
  await db.connection.deleteMany({ where: { businessId, channel: GSC_CHANNEL } });
  revalidatePath(`/b/${businessId}/seo`);
}
