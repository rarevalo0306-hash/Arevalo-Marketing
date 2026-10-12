import { ownAsset, attachment } from "@/app/api/brand-kit/access";
import { businessAccess } from "@/lib/auth";
import { kitFileName } from "@/lib/brand-kit-formats";
import { db } from "@/lib/db";
import { asLang, translator } from "@/lib/i18n";
import { uiLang } from "@/lib/i18n-server";
import { readMedia } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Descarga una imagen del kit (o del manual) con su nombre: el atributo "download" no sirve para archivos de otro
 * dominio (Supabase), así que pasa por aquí. Protegido por el middleware y aquí se revisa que la persona entre a este negocio.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; asset: string }> }) {
  const { id, asset } = await params;
  const u = new URL(req.url).searchParams;
  const lang = u.has("lang") ? asLang(u.get("lang")) : await uiLang();
  const t = translator(lang);
  const access = await businessAccess(id, "view");
  if (!access.ok) return new Response(access.status === 401 ? t("No autorizado", "Unauthorized") : access.status === 403 ? t("Tu papel no permite esto", "Your role doesn't allow this") : t("No encontrado", "Not found"), { status: access.status });
  const b = await db.business.findUnique({ where: { id }, select: { name: true, brandAssets: true } });
  const a = b ? ownAsset(b.brandAssets, asset) : null;
  if (!b || !a) return new Response(t("No encontrado", "Not found"), { status: 404 });
  try {
    const data = await readMedia(a.url);
    const name = a.kind === "kit" ? kitFileName(a.format, b.name, lang) : `${a.kind}-${a.id}.${a.url.split(".").pop()?.slice(0, 4) || "png"}`;
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": name.endsWith(".png") ? "image/png" : "application/octet-stream",
        "Content-Disposition": attachment(name),
        "Content-Length": String(data.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response(t("No se pudo leer la imagen.", "Couldn't read the image."), { status: 502 });
  }
}
