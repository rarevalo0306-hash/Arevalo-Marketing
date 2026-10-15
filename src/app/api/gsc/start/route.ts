import { businessAccess } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import { googleAuthUrl, googleEnabled } from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

// "Conectar Search Console": usa el mismo cliente de Google que el Perfil de Negocio (y el mismo regreso),
// pero solo pide permiso de lectura de Search Console. Protegida por el middleware.
export async function GET(req: Request) {
  const businessId = new URL(req.url).searchParams.get("b") ?? "";
  const { t } = await getT();
  if (!googleEnabled()) return new Response(t("Falta configurar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.", "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET need to be set up."), { status: 503 });
  // Conectar las cuentas de Google es del Administrador o de quien «Puede conectar» en este negocio (src/lib/auth.ts).
  const access = await businessAccess(businessId, "connect");
  if (!access.ok)
    return new Response(
      access.status === 401 ? t("No autorizado", "Unauthorized") : access.status === 403 ? t("Tu papel en esta empresa no permite hacer esto.", "Your role in this business doesn't allow this.") : t("Negocio no encontrado", "Business not found"),
      { status: access.status },
    );
  return Response.redirect(googleAuthUrl(businessId, "gsc"), 302);
}
