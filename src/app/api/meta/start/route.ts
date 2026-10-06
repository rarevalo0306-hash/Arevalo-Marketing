import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { authUrl, metaEnabled } from "@/lib/meta-oauth";

export const dynamic = "force-dynamic";

// Protegida por el middleware: solo alguien que ya entró a la app puede empezar la conexión.
export async function GET(req: Request) {
  const businessId = new URL(req.url).searchParams.get("b") ?? "";
  const { t } = await getT();
  if (!metaEnabled()) return new Response(t("Falta configurar META_APP_ID y META_APP_SECRET.", "META_APP_ID and META_APP_SECRET need to be set up."), { status: 503 });
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!b) return new Response(t("Negocio no encontrado", "Business not found"), { status: 404 });
  return Response.redirect(authUrl(b.id), 302);
}
