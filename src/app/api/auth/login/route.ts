import { NextResponse } from "next/server";
import { fromOtherSite, safeNext } from "@/lib/access";
import { isOwnerEmail, loginUser, verifyLogin } from "@/lib/accounts";
import { clearLoginAttempts, countLoginAttempt } from "@/lib/login-attempts";
import { attemptKey, clientIp, missingTable, waitMinutes } from "@/lib/login-limit";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

// Pública: entrar con correo y contraseña (el formulario de /login). Vuelve a /login?e=… con el motivo si no entra.
// Contraseña propia (src/lib/password.ts) o, para los dueños sin contraseña propia, APP_PASSWORD (src/lib/accounts.ts).
export async function POST(req: Request) {
  let next = "/";
  const back = (q: Record<string, string>) => NextResponse.redirect(new URL(`/login?${new URLSearchParams({ ...q, ...(next !== "/" && { next }) })}`, req.url), 303);
  if (!process.env.APP_PASSWORD?.trim() || !process.env.APP_SECRET) return back({ e: "setup" });
  // Solo desde la propia página de entrada: otra web no puede gastar los intentos de alguien ni dejarlo bloqueado.
  if (fromOtherSite(req.headers, new URL(req.url).host)) return new NextResponse(null, { status: 403 });
  let email = "";
  let password = "";
  try {
    const f = await req.formData();
    email = String(f.get("email") ?? "").trim().slice(0, 254);
    password = String(f.get("password") ?? "").trim();
    next = safeNext(String(f.get("next") ?? ""));
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
  let user: Awaited<ReturnType<typeof loginUser>> = null;
  try {
    const ok = await verifyLogin(email, password);
    if (!ok) return back({ e: "wrong" });
    user = await loginUser(email, { owner: isOwnerEmail(email), expectedVersion: ok.sessionVersion });
  } catch (e) {
    console.error("login user unavailable:", e instanceof Error ? e.message : e);
    return back({ e: "check" });
  }
  if (!user) return back({ e: "wrong" });
  await clearLoginAttempts(attempt).catch(() => {});
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(SESSION_COOKIE, await createSession(user.id, user.sessionVersion), sessionCookieOptions());
  return res;
}
