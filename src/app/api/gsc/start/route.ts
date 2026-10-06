import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { googleAuthUrl, googleEnabled } from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

// "Conectar Search Console": usa el mismo cliente de Google que el Perfil de Negocio (y el mismo regreso),
// pero solo pide permiso de lectura de Search Console. Protegida por el middleware.
export async function GET(req: Request) {
  const businessId = new URL(req.url).searchParams.get("b") ?? "";
  const { t } = await getT();
  if (!googleEnabled()) return new Response(t("Falta configurar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.", "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET need to be set up."), { status: 503 });
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!b) return new Response(t("Negocio no encontrado", "Business not found"), { status: 404 });
  return Response.redirect(googleAuthUrl(b.id, "gsc"), 302);
}
