import { NextResponse } from "next/server";
import { fromOtherSite } from "@/lib/access";
import { clearLoginAttempts, countLoginAttempt } from "@/lib/login-attempts";
import { attemptKey, clientIp, missingTable, waitMinutes } from "@/lib/login-limit";
import { safeEqual, SESSION_COOKIE, sessionCookieOptions, sessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

// Pública: entrar con la contraseña (el formulario de /login). Vuelve a /login?e=… con el motivo si no entra.
export async function POST(req: Request) {
  const back = (q: Record<string, string>) => NextResponse.redirect(new URL(`/login?${new URLSearchParams(q)}`, req.url), 303);
  // Sin espacios ni saltos de línea de más (pasa al pegar la contraseña en Vercel).
  const expected = process.env.APP_PASSWORD?.trim();
  if (!expected) return back({ e: "setup" });
  // Solo desde la propia página de entrada: otra web no puede gastar los intentos de alguien ni dejarlo bloqueado.
  if (fromOtherSite(req.headers, new URL(req.url).host)) return new NextResponse(null, { status: 403 });
  let password = "";
  try {
    password = String((await req.formData()).get("password") ?? "").trim();
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
  if (!safeEqual(password, expected)) return back({ e: "wrong" });
  await clearLoginAttempts(attempt).catch(() => {});
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(SESSION_COOKIE, await sessionToken(), sessionCookieOptions());
  return res;
}
