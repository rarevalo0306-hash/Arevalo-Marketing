import { cookies } from "next/headers";
import { appBase, GOOGLE_LOGIN_COOKIE, GOOGLE_LOGIN_MAX_AGE, GOOGLE_LOGIN_PATH, googleLoginEnabled, googleLoginUrl, newLoginFlow } from "@/lib/google-login";
import { looksLikeToken } from "@/lib/password";

export const dynamic = "force-dynamic";

/** ¿Viene de una página de Matya (el botón de la invitación)? Navegadores viejos sin Sec-Fetch-Site: por el Referer. */
function fromOwnPage(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  try {
    return new URL(req.headers.get("referer") ?? "").origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

// Pública (sin sesión): empieza «Entrar con Google». Guarda el state y el nonce del intento en una cookie de 10 minutos
// (y el enlace de la invitación, si viene de ?invitacion=…, para aceptarla al volver). Con Google la invitación se acepta
// sin otro clic, así que solo vale desde su página: un enlace directo (de otra web o un correo) lleva primero a ella.
export async function GET(req: Request) {
  if (!googleLoginEnabled()) return Response.redirect(`${appBase()}/login`, 302);
  const invite = new URL(req.url).searchParams.get("invitacion") ?? undefined;
  if (invite && looksLikeToken(invite) && !fromOwnPage(req)) return Response.redirect(`${appBase()}/invitacion/${invite}`, 302);
  const flow = newLoginFlow(invite);
  (await cookies()).set(GOOGLE_LOGIN_COOKIE, flow.cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: GOOGLE_LOGIN_PATH,
    maxAge: GOOGLE_LOGIN_MAX_AGE,
  });
  return Response.redirect(googleLoginUrl(flow.state, flow.nonce), 302);
}
