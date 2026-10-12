import { cookies } from "next/headers";
import { appBase, GOOGLE_LOGIN_COOKIE, GOOGLE_LOGIN_MAX_AGE, GOOGLE_LOGIN_PATH, googleLoginEnabled, googleLoginUrl, newLoginFlow } from "@/lib/google-login";

export const dynamic = "force-dynamic";

// Pública (sin sesión): empieza «Entrar con Google». Guarda el state y el nonce del intento en una cookie de 10 minutos
// (y el enlace de la invitación, si viene de ?invitacion=…, para aceptarla al volver).
export async function GET(req: Request) {
  if (!googleLoginEnabled()) return Response.redirect(`${appBase()}/login`, 302);
  const flow = newLoginFlow(new URL(req.url).searchParams.get("invitacion") ?? undefined);
  (await cookies()).set(GOOGLE_LOGIN_COOKIE, flow.cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: GOOGLE_LOGIN_PATH,
    maxAge: GOOGLE_LOGIN_MAX_AGE,
  });
  return Response.redirect(googleLoginUrl(flow.state, flow.nonce), 302);
}
