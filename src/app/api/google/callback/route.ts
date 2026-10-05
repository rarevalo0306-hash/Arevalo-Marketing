import { cookies } from "next/headers";
import { encryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { GOOGLE_COOKIE, googleExchange, listLocations, saveGoogleLocation } from "@/lib/google-oauth";
import { readState } from "@/lib/meta-oauth";

export const dynamic = "force-dynamic";

function back(businessId: string, params: Record<string, string>, path = "conexiones") {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return Response.redirect(`${base}/b/${businessId}/${path}?${new URLSearchParams(params)}`, 302);
}

/** Mensajes claros para los errores más comunes de Google. */
function explain(msg: string): string {
  if (/quota|RATE_LIMIT|429/i.test(msg))
    return "Google todavía no aprobó el acceso a la API del Perfil de Negocio para tu proyecto (la cuota está en 0). Cuando lo aprueben, vuelve a intentarlo.";
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(msg))
    return "Falta activar las APIs del Perfil de Negocio en Google Cloud (My Business Account Management, Business Information y Google My Business).";
  return `Google respondió: ${msg}`;
}

// Google devuelve a la persona aquí después de iniciar sesión y dar permiso.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const businessId = readState(url.searchParams.get("state") ?? "");
  if (!businessId || !(await db.business.findUnique({ where: { id: businessId }, select: { id: true } })))
    return new Response("El enlace de conexión venció o no es válido. Vuelve a intentarlo desde Conexiones.", { status: 400 });

  if (url.searchParams.get("error")) return back(businessId, { google: "error", msg: "Cancelaste la conexión con Google." });

  try {
    const { refreshToken, accessToken } = await googleExchange(url.searchParams.get("code") ?? "");
    const locations = await listLocations(accessToken);
    if (!locations.length)
      return back(businessId, { google: "error", msg: "Esa cuenta de Google no administra ningún Perfil de Negocio. Entra con la cuenta dueña del perfil." });
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
    return back(businessId, { google: "error", msg: explain((e as Error).message).slice(0, 400) });
  }
}
