"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { GA4_CHANNEL, readGa4Connection, refreshGa4, writeGa4Connection } from "@/lib/ga4";
import { explainGa4Error } from "@/lib/ga4-shape";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";

export type Ga4Result = { ok: boolean; message: string } | null;

async function ensureBusiness(id: string) {
  const b = await db.business.findUnique({ where: { id }, select: { id: true } });
  if (!b) {
    const { t } = await getT();
    throw new Error(t("Negocio no encontrado", "Business not found"));
  }
}

const paths = (id: string) => {
  revalidatePath(`/b/${id}/seo`);
  revalidatePath(`/b/${id}/conexiones`);
};

/** «Actualizar»: trae los últimos 28 días de Google Analytics y los guarda. */
export async function refreshGa4Action(businessId: string, _prev: Ga4Result, _f: FormData): Promise<Ga4Result> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  try {
    await ensureBusiness(businessId);
    const r = await refreshGa4(businessId);
    if (!r.ok) {
      // Si se llegó a preguntar a Google, el motivo quedó guardado y el panel lo muestra (sin repetirlo aquí).
      if (r.attempted) {
        revalidatePath(`/b/${businessId}/seo`);
        return { ok: false, message: "" };
      }
      return { ok: false, message: explainGa4Error(errorText(r.error, lang), t) };
    }
    revalidatePath(`/b/${businessId}/seo`);
    return {
      ok: true,
      message: r.report.totals.sessions
        ? t("Listo: datos actualizados.", "Done: data updated.")
        : t(
            "Listo, pero Google Analytics no tiene visitas en estas fechas. Si lo instalaste hace poco, espera unos días.",
            "Done, but Google Analytics has no visits in these dates. If you installed it recently, wait a few days.",
          ),
    };
  } catch (e) {
    return { ok: false, message: explainGa4Error(errorText(e, lang), t) };
  }
}

/** Al abrir el panel: actualiza solo si los datos tienen más de un día (como máximo una vez al día). */
export async function autoRefreshGa4(businessId: string): Promise<{ refreshed: boolean }> {
  try {
    const r = await refreshGa4(businessId, { auto: true });
    // También cuando falla: el panel tiene que mostrar el motivo guardado.
    if (r.ok || !("skipped" in r && r.skipped)) revalidatePath(`/b/${businessId}/seo`);
    return { refreshed: r.ok || !("skipped" in r && r.skipped) };
  } catch {
    return { refreshed: false };
  }
}

/** Elige la propiedad de GA4 de este negocio (de las que se encontraron al conectar) y trae los primeros datos. */
export async function chooseGa4Property(businessId: string, propertyId: string) {
  await ensureBusiness(businessId);
  const { t } = await getT();
  const conn = await readGa4Connection(businessId);
  const prop = conn?.secret.properties?.find((p) => p.id === propertyId);
  if (!conn || !prop)
    redirect(`/b/${businessId}/seo?${new URLSearchParams({ tab: "web", ga4: "error", msg: t("La conexión venció. Vuelve a conectar Google Analytics.", "The connection expired. Connect Google Analytics again.") })}#ga4`);
  await writeGa4Connection(businessId, { ...conn.secret, propertyId: prop.id, propertyName: prop.name, lastError: undefined, lastTryAt: undefined });
  const r = await refreshGa4(businessId).catch(() => ({ ok: false }));
  paths(businessId);
  // Si los primeros datos fallaron, el panel muestra el motivo (sin el «Listo»).
  redirect(`/b/${businessId}/seo?tab=web${r.ok ? "&ga4=ok" : ""}#ga4`);
}

/** «Cambiar de propiedad»: vuelve a mostrar la lista (sin volver a pedir permiso a Google). */
export async function changeGa4Property(businessId: string) {
  await ensureBusiness(businessId);
  const conn = await readGa4Connection(businessId);
  if (conn) await writeGa4Connection(businessId, { ...conn.secret, propertyId: undefined, propertyName: undefined, lastError: undefined, lastTryAt: undefined });
  paths(businessId);
}

/** Quita la conexión con Google Analytics (los reportes guardados se quedan). */
export async function disconnectGa4(businessId: string) {
  await db.connection.deleteMany({ where: { businessId, channel: GA4_CHANNEL } });
  paths(businessId);
}
