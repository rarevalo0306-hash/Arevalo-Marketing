import { NextResponse } from "next/server";
import { fromOtherSite } from "@/lib/access";
import { isOwnerEmail, loginUser } from "@/lib/accounts";
import { loginEmails } from "@/lib/google-login";
import { clearLoginAttempts, countLoginAttempt } from "@/lib/login-attempts";
import { attemptKey, clientIp, missingTable, waitMinutes } from "@/lib/login-limit";
import { createSession, safeEqual, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

// Pública: entrar con correo y contraseña (el formulario de /login). Vuelve a /login?e=… con el motivo si no entra.
// Por ahora la contraseña es APP_PASSWORD y solo vale para los dueños (LOGIN_EMAILS). Las demás personas entran con Google.
export async function POST(req: Request) {
  const back = (q: Record<string, string>) => NextResponse.redirect(new URL(`/login?${new URLSearchParams(q)}`, req.url), 303);
  // Sin espacios ni saltos de línea de más (pasa al pegar la contraseña en Vercel).
  const expected = process.env.APP_PASSWORD?.trim();
  if (!expected || !process.env.APP_SECRET || !loginEmails().length) return back({ e: "setup" });
  // Solo desde la propia página de entrada: otra web no puede gastar los intentos de alguien ni dejarlo bloqueado.
  if (fromOtherSite(req.headers, new URL(req.url).host)) return new NextResponse(null, { status: 403 });
  let email = "";
  let password = "";
  try {
    const f = await req.formData();
    email = String(f.get("email") ?? "").trim().slice(0, 254);
    password = String(f.get("password") ?? "").trim();
  } catch {
    return back({ e: "wrong" });
  }
  // Límite de intentos (src/lib/login-limit.ts): se cuenta antes de revisar la contraseña. Si la tabla aún no existe,
  // se entra sin límite antes que dejar a todos fuera; con otro error de la base no se revisa la contraseña.
  const attempt = attemptKey(clientIp(req.headers));
  let wait = 0;
  try {
    wait = await countLoginAttempt(attempt);
  } catch (e) {
    console.error("login limit unavailable:", e instanceof Error ? e.message : e);
    if (!missingTable(e)) return back({ e: "check" });
  }
  if (wait > 0) return back({ e: "locked", m: String(waitMinutes(wait)) });
  // Se revisan los dos siempre, para no decir cuál de los dos estuvo mal.
  const passwordOk = safeEqual(password, expected);
  if (!(isOwnerEmail(email) && passwordOk)) return back({ e: "wrong" });
  let user: Awaited<ReturnType<typeof loginUser>> = null;
  try {
    user = await loginUser(email, { owner: true });
  } catch (e) {
    console.error("login user unavailable:", e instanceof Error ? e.message : e);
    return back({ e: "check" });
  }
  if (!user) return back({ e: "wrong" });
  await clearLoginAttempts(attempt).catch(() => {});
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(SESSION_COOKIE, await createSession(user.id, user.sessionVersion), sessionCookieOptions());
  return res;
}
