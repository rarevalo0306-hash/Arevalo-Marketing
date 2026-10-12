import { NextResponse, type NextRequest } from "next/server";
import { gate } from "@/lib/access";
import { readSession, SESSION_COOKIE } from "@/lib/session";

export async function middleware(req: NextRequest) {
  // Aquí solo se revisa la firma y la fecha de la cookie (no hay base). Si esa persona aún existe y a qué negocios
  // entra lo revisa cada página, acción y ruta con src/lib/auth.ts.
  const hasSession = Boolean(await readSession(req.cookies.get(SESSION_COOKIE)?.value));
  const next = gate(req.nextUrl.pathname, req.method, hasSession);
  if (next === "pass") return NextResponse.next();
  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  if (next === "deny") {
    // Una acción del servidor sin sesión (por ejemplo, venció con la app abierta) no corre: el navegador va a /login.
    if (req.headers.has("next-action")) return new NextResponse(null, { status: 401, headers: { "x-action-redirect": "/login;replace" } });
    if (req.method === "POST") return NextResponse.redirect(login, 303);
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return NextResponse.redirect(login);
}

export const config = {
  // Todas las rutas menos los recursos de Next. Qué es público (y solo para leer) lo decide src/lib/access.ts.
  matcher: ["/((?!_next/).*)"],
};
