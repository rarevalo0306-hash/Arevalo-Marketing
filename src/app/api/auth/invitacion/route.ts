import { NextResponse } from "next/server";
import { fromOtherSite } from "@/lib/access";
import { passwordProblem } from "@/lib/password";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { acceptInvitation, readInvitation } from "@/lib/team";

export const dynamic = "force-dynamic";

// Pública: aceptar una invitación creando la cuenta con una contraseña propia (src/lib/team.ts). Solo para correos que
// aún no tienen cuenta; quien ya tiene cuenta entra con ella y acepta desde la misma página.
export async function POST(req: Request) {
  if (!process.env.APP_PASSWORD?.trim() || !process.env.APP_SECRET) return new NextResponse(null, { status: 503 });
  if (fromOtherSite(req.headers, new URL(req.url).host)) return new NextResponse(null, { status: 403 });
  let token = "";
  let password = "";
  let repeat = "";
  try {
    const f = await req.formData();
    token = String(f.get("token") ?? "");
    password = String(f.get("password") ?? "");
    repeat = String(f.get("password2") ?? "");
  } catch {
    return NextResponse.redirect(new URL("/login", req.url), 303);
  }
  const page = (e?: string) => NextResponse.redirect(new URL(`/invitacion/${encodeURIComponent(token)}${e ? `?e=${e}` : ""}`, req.url), 303);
  const problem = passwordProblem(password, repeat);
  if (problem) return page(problem);
  let user: Awaited<ReturnType<typeof acceptInvitation>> = null;
  try {
    const view = await readInvitation(token);
    if (!view) return page();
    if (view.existingUser) return page("existing");
    user = await acceptInvitation(token, view.email, { newPassword: password });
  } catch (e) {
    console.error("accept invitation failed:", e instanceof Error ? e.message : e);
    return page("check");
  }
  if (!user) return page();
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(SESSION_COOKIE, await createSession(user.id, user.sessionVersion), sessionCookieOptions());
  return res;
}
