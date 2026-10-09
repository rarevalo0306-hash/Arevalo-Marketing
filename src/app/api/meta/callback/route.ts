import { cookies } from "next/headers";
import { saveAdsConnection } from "@/lib/ads";
import { encryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { exchangeCode, listPages, META_COOKIE, metaStatePurpose, readState, saveMetaPage } from "@/lib/meta-oauth";

export const dynamic = "force-dynamic";

function back(businessId: string, params: Record<string, string>, path = "conexiones") {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return Response.redirect(`${base}/b/${businessId}/${path}?${new URLSearchParams(params)}`, 302);
}

// Facebook devuelve a la persona aquí después de iniciar sesión y dar permisos.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const { lang, t } = await getT();
  const state = readState(url.searchParams.get("state") ?? "");
  const { purpose, businessId } = metaStatePurpose(state ?? "");
  if (!state || !businessId || !(await db.business.findUnique({ where: { id: businessId }, select: { id: true } })))
    return new Response(t("El enlace de conexión venció o no es válido. Vuelve a intentarlo desde Conexiones.", "The connection link expired or isn't valid. Try again from Connections."), { status: 400 });

  if (purpose === "ads") return adsCallback(url, businessId);

  if (url.searchParams.get("error"))
    return back(businessId, { meta: "error", msg: t("Cancelaste la conexión con Facebook.", "You canceled the Facebook connection.") });

  try {
    const userToken = await exchangeCode(url.searchParams.get("code") ?? "");
    const pages = await listPages(userToken);
    if (!pages.length)
      return back(businessId, { meta: "error", msg: t("Tu cuenta de Facebook no administra ninguna página, o no diste permiso a ninguna.", "Your Facebook account doesn't manage any Pages, or you didn't give access to any.") });
    if (pages.length === 1) {
      const { instagram } = await saveMetaPage(businessId, pages[0]);
      return back(businessId, { meta: "ok", page: pages[0].name, ig: instagram ?? "" });
    }
    // Varias páginas: guardamos el token (cifrado, 15 minutos) y la persona elige cuál.
    (await cookies()).set(META_COOKIE, encryptJson({ userToken, businessId }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 15 * 60,
    });
    return back(businessId, {}, "conexiones/meta");
  } catch (e) {
    return back(businessId, { meta: "error", msg: t(`Facebook respondió: ${errorText(e, lang)}`, `Facebook responded: ${errorText(e, lang)}`).slice(0, 300) });
  }
}

/** «Conectar anuncios»: guarda el permiso de anuncios y la cuenta de anuncios; vuelve a Anuncios pagados. */
async function adsCallback(url: URL, businessId: string) {
  const { lang, t } = await getT();
  if (url.searchParams.get("error"))
    return back(businessId, { ads: "error", msg: t("Cancelaste la conexión de anuncios.", "You canceled the ads connection.") }, "anuncios");
  try {
    const userToken = await exchangeCode(url.searchParams.get("code") ?? "");
    const r = await saveAdsConnection(businessId, userToken);
    return back(businessId, { ads: r.chosen ? "ok" : "choose" }, "anuncios");
  } catch (e) {
    return back(businessId, { ads: "error", msg: t(`Facebook respondió: ${errorText(e, lang)}`, `Facebook responded: ${errorText(e, lang)}`).slice(0, 300) }, "anuncios");
  }
}
