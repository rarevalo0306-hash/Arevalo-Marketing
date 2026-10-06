import { cookies } from "next/headers";
import { encryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { GOOGLE_COOKIE, googleExchange, googleStatePurpose, listLocations, saveGoogleLocation } from "@/lib/google-oauth";
import { errorText, type T, type UiLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { readState } from "@/lib/meta-oauth";
import { explainGscError, GSC_COOKIE, listGscSites, matchSite, saveGscSite, tryFirstGscReport } from "@/lib/seo/gsc";

export const dynamic = "force-dynamic";

function back(businessId: string, params: Record<string, string>, path = "conexiones") {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return Response.redirect(`${base}/b/${businessId}/${path}?${new URLSearchParams(params)}`, 302);
}

/** Mensajes claros para los errores más comunes de Google. */
function explain(msg: string, t: T): string {
  if (/quota|RATE_LIMIT|429/i.test(msg))
    return t(
      "Google todavía no aprobó el acceso a la API del Perfil de Negocio para tu proyecto (la cuota está en 0). Cuando lo aprueben, vuelve a intentarlo.",
      "Google hasn't approved Business Profile API access for your project yet (the quota is 0). Once it's approved, try again.",
    );
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(msg))
    return t(
      "Falta activar las APIs del Perfil de Negocio en Google Cloud (My Business Account Management, Business Information y Google My Business).",
      "The Business Profile APIs need to be turned on in Google Cloud (My Business Account Management, Business Information and Google My Business).",
    );
  return t(`Google respondió: ${msg}`, `Google responded: ${msg}`);
}

/** "Conectar Search Console": guarda el sitio que corresponde a la página del negocio, o deja elegir. */
async function searchConsole(url: URL, businessId: string, lang: UiLang, t: T) {
  const seo = (params: Record<string, string>, path = "seo") => back(businessId, params, path);
  if (url.searchParams.get("error"))
    return seo({
      gsc: "error",
      msg: t(
        "No se dio el permiso para ver Search Console (o cancelaste). Vuelve a intentarlo y acepta el permiso.",
        "Permission to view Search Console wasn't granted (or you canceled). Try again and accept the permission.",
      ),
    });
  try {
    const { refreshToken, accessToken } = await googleExchange(url.searchParams.get("code") ?? "");
    const sites = await listGscSites(accessToken);
    if (!sites.length)
      return seo({
        gsc: "error",
        msg: t(
          "Esa cuenta de Google no tiene tu página en Search Console. Agrégala y verifícala en search.google.com/search-console y vuelve a conectar.",
          "That Google account doesn't have your website in Search Console. Add and verify it at search.google.com/search-console, then connect again.",
        ),
      });
    const b = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { website: true } });
    const site = matchSite(b.website, sites) ?? (sites.length === 1 && !b.website.trim() ? sites[0] : null);
    if (!site) {
      // Ninguno coincide con la página del negocio: guardamos el permiso (cifrado, 15 minutos) y la persona elige.
      (await cookies()).set(GSC_COOKIE, encryptJson({ refreshToken, businessId, sites }), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 15 * 60,
      });
      return seo({}, "seo/gsc");
    }
    await saveGscSite(businessId, refreshToken, site);
    await tryFirstGscReport(businessId);
    return seo({ gsc: "ok" });
  } catch (e) {
    return seo({ gsc: "error", msg: explainGscError(errorText(e, lang), t).slice(0, 400) });
  }
}

// Google devuelve a la persona aquí después de iniciar sesión y dar permiso.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const { lang, t } = await getT();
  const { purpose, businessId } = googleStatePurpose(readState(url.searchParams.get("state") ?? "") ?? "");
  if (!businessId || !(await db.business.findUnique({ where: { id: businessId }, select: { id: true } })))
    return new Response(t("El enlace de conexión venció o no es válido. Vuelve a intentarlo desde Conexiones.", "The connection link expired or isn't valid. Try again from Connections."), { status: 400 });

  if (purpose === "gsc") return searchConsole(url, businessId, lang, t);

  if (url.searchParams.get("error")) return back(businessId, { google: "error", msg: t("Cancelaste la conexión con Google.", "You canceled the Google connection.") });

  try {
    const { refreshToken, accessToken } = await googleExchange(url.searchParams.get("code") ?? "");
    const locations = await listLocations(accessToken);
    if (!locations.length)
      return back(businessId, { google: "error", msg: t("Esa cuenta de Google no administra ningún Perfil de Negocio. Entra con la cuenta dueña del perfil.", "That Google account doesn't manage any Business Profile. Sign in with the account that owns the profile.") });
    if (locations.length === 1) {
      await saveGoogleLocation(businessId, refreshToken, locations[0]);
      return back(businessId, { google: "ok", place: locations[0].title });
    }
    // Varias ubicaciones: guardamos el permiso (cifrado, 15 minutos) y la persona elige cuál.
    (await cookies()).set(GOOGLE_COOKIE, encryptJson({ refreshToken, businessId, locations }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 15 * 60,
    });
    return back(businessId, {}, "conexiones/google");
  } catch (e) {
    return back(businessId, { google: "error", msg: explain(errorText(e, lang), t).slice(0, 400) });
  }
}
