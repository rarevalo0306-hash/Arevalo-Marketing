import { NextResponse } from "next/server";
import { fromOtherSite } from "@/lib/access";
import { passwordProblem } from "@/lib/password";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { completeReset } from "@/lib/team";

export const dynamic = "force-dynamic";

// Pública: guardar la contraseña nueva con el enlace de «¿Olvidaste tu contraseña?» (o el que mandó el Administrador).
export async function POST(req: Request) {
  if (!process.env.APP_PASSWORD?.trim() || !process.env.APP_SECRET) return new NextResponse(null, { status: 503 });
  if (fromOtherSite(req.headers, new URL(req.url).host)) return new NextResponse(null, { status: 403 });
  let token = "";
  let password = "";
  let repeat = "";
  try {
    const f = await req.formData();
    token = String(f.get("token") ?? "");
    // Igual que al entrar (/api/auth/login): sin espacios al principio ni al final.
    password = String(f.get("password") ?? "").trim();
    repeat = String(f.get("password2") ?? "").trim();
  } catch {
    return NextResponse.redirect(new URL("/login", req.url), 303);
  }
  const page = (e: string) => NextResponse.redirect(new URL(`/clave/${encodeURIComponent(token)}?e=${e}`, req.url), 303);
  const problem = passwordProblem(password, repeat);
  if (problem) return page(problem);
  let user: Awaited<ReturnType<typeof completeReset>> = null;
  try {
    user = await completeReset(token, password);
  } catch (e) {
    console.error("password reset failed:", e instanceof Error ? e.message : e);
    return page("check");
  }
  if (!user) return page("expired");
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(SESSION_COOKIE, await createSession(user.id, user.sessionVersion), sessionCookieOptions());
  return res;
}
