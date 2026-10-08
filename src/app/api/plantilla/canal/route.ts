import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { isOwnFile, SAFE_MEDIA_NAME } from "@/lib/media";
import { imageForChannel } from "@/lib/media-formats";

export const dynamic = "force-dynamic";

/** Solo archivos del propio negocio: su carpeta del almacenamiento o una copia local (/media/…). */
function allowed(url: string, businessId: string): boolean {
  const local = /^\/media\/([^/?#]+)$/.exec(url);
  if (local) return SAFE_MEDIA_NAME.test(local[1]);
  return isOwnFile(url, businessId);
}

// Vista previa por red: la foto de la publicación EXACTAMENTE como se mandará a ese canal (diseños dibujados de
// nuevo en su forma, recortes y fondos desenfocados). Protegida por el middleware (hay que haber entrado).
// ?b=negocio&u=dirección de la foto&c=canal (instagram, facebook, google, linkedin, x…).
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const businessId = q.get("b") ?? "";
  const url = q.get("u") ?? "";
  const channel = q.get("c") ?? "";
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!b) return new Response(t("Negocio no encontrado", "Business not found"), { status: 404 });
  if (!allowed(url, businessId)) return new Response(t("Esa foto no es de este negocio.", "That photo doesn't belong to this business."), { status: 400 });
  try {
    const made = await imageForChannel(url, channel);
    // Sin cambios para esta red: se muestra la original.
    if (!made) return Response.redirect(new URL(url, req.url), 302);
    return new Response(new Uint8Array(made.out), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    return new Response(errorText(e, lang), { status: 500 });
  }
}
