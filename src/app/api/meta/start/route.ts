import { db } from "@/lib/db";
import { authUrl, metaEnabled } from "@/lib/meta-oauth";

export const dynamic = "force-dynamic";

// Protegida por el middleware: solo alguien que ya entró a la app puede empezar la conexión.
export async function GET(req: Request) {
  const businessId = new URL(req.url).searchParams.get("b") ?? "";
  if (!metaEnabled()) return new Response("Falta configurar META_APP_ID y META_APP_SECRET.", { status: 503 });
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!b) return new Response("Negocio no encontrado", { status: 404 });
  return Response.redirect(authUrl(b.id), 302);
}
