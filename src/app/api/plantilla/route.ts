import { businessAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { DESIGN_SHAPES, renderDesign, samplePhoto, type DesignShape } from "@/lib/design";
import { BUILTIN_TEMPLATES, StoredTemplate } from "@/lib/design-shapes";
import { sloganFrom } from "@/lib/design-layout";
import { designStyleOf, isDesignStyle } from "@/lib/design-style";
import { errorText, type T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import sharp from "sharp";
import { readMedia, readSidecar } from "@/lib/media";
import { placementById, placementPlan, previewSize, renderable } from "@/lib/placements";

/**
 * Una foto limpia (sin letras) para la vista previa. La foto de la última publicación suele ser un diseño que ya trae
 * titular y logo: encima de eso, la plantilla se veía con letras montadas. Se usa la foto original del diseño (está en
 * su nota) o una foto sin diseño; si no hay, la foto de ejemplo.
 */
async function cleanPhoto(businessId: string, color: string): Promise<string> {
  const posts = await db.post.findMany({ where: { businessId, mediaType: "photo", NOT: { mediaUrl: "" } }, orderBy: { createdAt: "desc" }, take: 5, select: { mediaUrl: true } });
  for (const p of posts) {
    const note = (await readSidecar(p.mediaUrl)) as { kind?: unknown; photoUrl?: unknown } | null;
    if (note?.kind === "design" && typeof note.photoUrl === "string" && note.photoUrl.startsWith("https://")) return note.photoUrl;
    if (note?.kind === "photo" && p.mediaUrl.startsWith("https://")) return p.mediaUrl;
  }
  return samplePhoto(color);
}

export const dynamic = "force-dynamic";

// Textos de ejemplo de la vista previa, en el idioma de la app.
const sample = (t: T): Record<string, string> => ({
  lista: t("Después de una tormenta", "After a storm"),
  "color-solido": t("¿Sabías que puedes pedir una segunda opinión?", "Did you know you can ask for a second opinion?"),
});

/** La foto de la vista previa en bytes (una dirección guardada o la foto de ejemplo, que viene como data URI). */
async function photoBytes(url: string): Promise<Buffer> {
  const m = /^data:image\/[a-z]+;base64,(.+)$/.exec(url);
  return m ? Buffer.from(m[1], "base64") : readMedia(url);
}

// Vista previa de una plantilla con la marca del negocio (protegida por el middleware: hay que haber entrado).
// ?b=negocio&t=plantilla (builtin-N o el id) y, opcional, &s=forma (square, portrait, story, link, google, wide, email)
// o &p=formato de una red (ver src/lib/placements.ts; ej. pinterest.standard_pin). Con &dl=1 sale en su tamaño real
// para descargar. Con &estilo=elegante (profesional, elegante, fresco o audaz) se ve con ese estilo sin guardarlo.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const businessId = u.searchParams.get("b") ?? "";
  const tpl = u.searchParams.get("t") ?? "";
  const s = u.searchParams.get("s") ?? "square";
  const shape: DesignShape = s in DESIGN_SHAPES ? (s as DesignShape) : "square";
  const pid = u.searchParams.get("p") ?? "";
  const placement = pid ? placementById(pid) : undefined;
  const download = u.searchParams.get("dl") === "1";
  const asked = u.searchParams.get("estilo");
  const { lang, t } = await getT();
  if (pid && (!placement || !renderable(placement))) return new Response(t("Ese formato no se dibuja con plantillas.", "That format isn't drawn with templates."), { status: 404 });
  const size = placement ? (download ? { w: placement.canvas.width, h: placement.canvas.height ?? placement.canvas.width } : previewSize(placement)) : undefined;
  // Solo quien entra a este negocio (src/lib/auth.ts); es una vista previa: no gasta ni guarda nada.
  const access = await businessAccess(businessId, "view");
  if (!access.ok)
    return new Response(
      access.status === 401 ? t("No autorizado", "Unauthorized") : access.status === 403 ? t("Tu papel en esta empresa no permite hacer esto.", "Your role in this business doesn't allow this.") : t("Negocio no encontrado", "Business not found"),
      { status: access.status },
    );
  const b = await db.business.findUnique({ where: { id: businessId } });
  if (!b) return new Response(t("Negocio no encontrado", "Business not found"), { status: 404 });
  let spec: StoredTemplate | undefined;
  if (tpl.startsWith("builtin-")) spec = BUILTIN_TEMPLATES[Number(tpl.slice(8))];
  else {
    const row = await db.template.findFirst({ where: { id: tpl, businessId } });
    const parsed = row ? StoredTemplate.safeParse(row.spec) : null;
    spec = parsed?.success ? parsed.data : undefined;
  }
  if (!spec) return new Response(t("Plantilla no encontrada", "Template not found"), { status: 404 });
  const photoUrl = await cleanPhoto(businessId, b.color);
  const headers: Record<string, string> = { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=60" };
  if (placement && size && download) headers["Content-Disposition"] = `attachment; filename="${placement.id.replace(/[^a-z0-9_.-]/gi, "-")}-${size.w}x${size.h}.jpg"`;
  try {
    // Google Ads responsivo y fotos del Perfil de Negocio: solo la foto, recortada a la medida (el texto va aparte).
    if (placement && size && placementPlan(placement) === "photo") {
      const jpg = await sharp(await photoBytes(photoUrl)).rotate().resize(size.w, size.h, { fit: "cover", position: "attention" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      return new Response(new Uint8Array(jpg), { headers });
    }
    const jpg = await renderDesign({
      brand: { name: b.name, color: b.color, color2: b.color2, color3: b.color3, logoUrl: b.logoUrl, logoLightUrl: b.logoLightUrl, phone: b.phone, website: b.website, fontHeading: b.fontHeading, fontBody: b.fontBody, slogan: sloganFrom(b.brandIdentity, lang), style: isDesignStyle(asked) ? asked : designStyleOf(b).style },
      template: spec,
      headline: sample(t)[spec.layout] ?? t("Revisa tu casa después de la tormenta", "Check your home after the storm"),
      steps: [t("Toma fotos desde el suelo", "Take photos from the ground"), t("Guarda los recibos", "Keep your receipts"), t("Pide una evaluación", "Ask for an assessment")],
      photoUrl,
      shape,
      size,
    });
    return new Response(new Uint8Array(jpg), { headers });
  } catch (e) {
    return new Response(errorText(e, lang), { status: 500 });
  }
}
