import { NextResponse, type NextRequest } from "next/server";
import { gate } from "@/lib/access";
import { safeEqual, SESSION_COOKIE, sessionToken } from "@/lib/session";

export async function middleware(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value ?? "";
  const hasSession = Boolean(process.env.APP_PASSWORD) && safeEqual(cookie, await sessionToken());
  const next = gate(req.nextUrl.pathname, req.method, hasSession);
  if (next === "pass") return NextResponse.next();
  if (next === "deny") return new NextResponse("Unauthorized", { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Todas las rutas menos los recursos de Next. Qué es público (y solo para leer) lo decide src/lib/access.ts.
  matcher: ["/((?!_next/).*)"],
};
