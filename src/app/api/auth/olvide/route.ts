import { NextResponse } from "next/server";
import { fromOtherSite } from "@/lib/access";
import { getT } from "@/lib/i18n-server";
import { countLoginAttempt } from "@/lib/login-attempts";
import { attemptKey, clientIp, missingTable } from "@/lib/login-limit";
import { requestPasswordReset } from "@/lib/team";

export const dynamic = "force-dynamic";

// Pública: «¿Olvidaste tu contraseña?». Siempre responde lo mismo (no dice si el correo tiene cuenta). Cuenta en el mismo
// límite de intentos que entrar, con su propia llave: 5 pedidos cada 15 minutos por dirección.
export async function POST(req: Request) {
  if (fromOtherSite(req.headers, new URL(req.url).host)) return new NextResponse(null, { status: 403 });
  const done = (q = "enviado=1") => NextResponse.redirect(new URL(`/olvide?${q}`, req.url), 303);
  let email = "";
  try {
    email = String((await req.formData()).get("email") ?? "").trim().slice(0, 254);
  } catch {
    return done("e=check");
  }
  try {
    if ((await countLoginAttempt(attemptKey(`reset:${clientIp(req.headers)}`))) > 0) return done("e=locked");
  } catch (e) {
    if (!missingTable(e)) return done("e=check");
  }
  const { lang } = await getT();
  await requestPasswordReset(email, lang).catch((e) => console.error("password reset failed:", e instanceof Error ? e.message : e));
  return done();
}
