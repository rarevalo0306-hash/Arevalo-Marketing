import { cookies } from "next/headers";
import {
  appBase,
  checkGoogleLogin,
  GOOGLE_LOGIN_COOKIE,
  GOOGLE_LOGIN_PATH,
  GOOGLE_TOKEN_URL,
  googleLoginEnabled,
  googleLoginRedirectUri,
  idTokenClaims,
  loginEmails,
  readLoginFlow,
} from "@/lib/google-login";
import { fetchJson, form } from "@/lib/publishers/http";
import { safeEqual, SESSION_COOKIE, sessionCookieOptions, sessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

// Pública (sin sesión): regreso de «Entrar con Google». Si el correo está permitido, pone la misma sesión que la contraseña.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const flow = readLoginFlow(jar.get(GOOGLE_LOGIN_COOKIE)?.value);
  jar.delete({ name: GOOGLE_LOGIN_COOKIE, path: GOOGLE_LOGIN_PATH });
  const fail = (why: string) => Response.redirect(`${appBase()}/login?google=${why}`, 302);

  if (url.searchParams.get("error")) return fail("cancel");
  const code = url.searchParams.get("code") ?? "";
  if (!flow || !code || !safeEqual(url.searchParams.get("state") ?? "", flow.state)) return fail("expired");
  if (!googleLoginEnabled() || !process.env.APP_PASSWORD) return fail("error");

  let idToken = "";
  try {
    const t = await fetchJson<{ id_token?: string }>(GOOGLE_TOKEN_URL, {
      method: "POST",
      body: form({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: googleLoginRedirectUri(),
        grant_type: "authorization_code",
      }),
    });
    idToken = t.id_token ?? "";
  } catch (e) {
    console.error("google login exchange failed:", e instanceof Error ? e.message : e);
    return fail("error");
  }

  const check = checkGoogleLogin(idTokenClaims(idToken), {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    nonce: flow.nonce,
    nowSec: Math.floor(Date.now() / 1000),
    allowed: loginEmails(),
  });
  if (!check.ok) return fail(check.reason === "notAllowed" ? "notallowed" : "error");

  jar.set(SESSION_COOKIE, await sessionToken(), sessionCookieOptions());
  return Response.redirect(`${appBase()}/`, 302);
}
