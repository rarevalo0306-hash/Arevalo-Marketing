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
  // Públicos: login, el publicador automático (tiene su propia clave), los archivos para las redes, recursos de Next,
  // lo necesario para instalar la app (manifiesto e íconos) y el link de subida de los técnicos (/subir/<link> y
  // /api/subir/<link>/…, que revisan su propio link).
  matcher: ["/((?!login|api/cron|api/subir/|subir/|media/|_next/|favicon.ico|manifest.webmanifest|icons/|icon|apple-icon).*)"],
};
