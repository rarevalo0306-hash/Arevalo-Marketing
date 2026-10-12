import { cookies } from "next/headers";
import { isOwnerEmail, loginUser } from "@/lib/accounts";
import { acceptInvitation } from "@/lib/team";
import {
  appBase,
  GOOGLE_LOGIN_COOKIE,
  GOOGLE_LOGIN_PATH,
  GOOGLE_TOKEN_URL,
  googleLoginEnabled,
  googleIdentity,
  googleLoginRedirectUri,
  idTokenClaims,
  readLoginFlow,
} from "@/lib/google-login";
import { fetchJson, form } from "@/lib/publishers/http";
import { createSession, safeEqual, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

// Pública (sin sesión): regreso de «Entrar con Google». Si esa persona puede entrar (src/lib/accounts.ts), pone su sesión.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const flow = readLoginFlow(jar.get(GOOGLE_LOGIN_COOKIE)?.value);
  jar.delete({ name: GOOGLE_LOGIN_COOKIE, path: GOOGLE_LOGIN_PATH });
  const fail = (why: string) => Response.redirect(`${appBase()}/login?google=${why}`, 302);

  if (url.searchParams.get("error")) return fail("cancel");
  const code = url.searchParams.get("code") ?? "";
  if (!flow || !code || !safeEqual(url.searchParams.get("state") ?? "", flow.state)) return fail("expired");
  if (!googleLoginEnabled() || !process.env.APP_PASSWORD || !process.env.APP_SECRET) return fail("error");

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

  const who = googleIdentity(idTokenClaims(idToken), {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    nonce: flow.nonce,
    nowSec: Math.floor(Date.now() / 1000),
  });
  if (!who.ok) return fail(who.reason === "notAllowed" ? "notallowed" : "error");

  let user: Awaited<ReturnType<typeof loginUser>> = null;
  try {
    // Viene de una invitación: se acepta si el correo de Google es el invitado; si no, entra como siempre.
    if (flow.invite) user = await acceptInvitation(flow.invite, who.email, { name: who.name });
    user ??= await loginUser(who.email, { owner: isOwnerEmail(who.email), name: who.name });
  } catch (e) {
    console.error("google login user unavailable:", e instanceof Error ? e.message : e);
    return fail("error");
  }
  if (!user) return fail("notallowed");

  jar.set(SESSION_COOKIE, await createSession(user.id, user.sessionVersion), sessionCookieOptions());
  return Response.redirect(`${appBase()}/`, 302);
}
