import { NextResponse, type NextRequest } from "next/server";
import { safeEqual, SESSION_COOKIE, sessionToken } from "@/lib/session";

export async function middleware(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value ?? "";
  if (process.env.APP_PASSWORD && safeEqual(cookie, await sessionToken())) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Públicos: login, el publicador automático (tiene su propia clave), los archivos para las redes, recursos de Next
  // y lo necesario para instalar la app (manifiesto e íconos).
  matcher: ["/((?!login|api/cron|media/|_next/|favicon.ico|manifest.webmanifest|icons/|icon|apple-icon).*)"],
};
