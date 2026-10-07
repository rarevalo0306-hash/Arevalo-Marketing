import { db } from "@/lib/db";
import { DESIGN_SHAPES, renderDesign, samplePhoto, type DesignShape } from "@/lib/design";
import { BUILTIN_TEMPLATES, StoredTemplate } from "@/lib/design-shapes";
import { errorText, type T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

// Textos de ejemplo de la vista previa, en el idioma de la app.
const sample = (t: T): Record<string, string> => ({
  lista: t("Después de una tormenta", "After a storm"),
  "color-solido": t("¿Sabías que puedes pedir una segunda opinión?", "Did you know you can ask for a second opinion?"),
});

// Vista previa de una plantilla con la marca del negocio (protegida por el middleware: hay que haber entrado).
// ?b=negocio&t=plantilla (builtin-N o el id) y, opcional, &s=forma (square, portrait, story, link, google, wide, email).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const businessId = u.searchParams.get("b") ?? "";
  const tpl = u.searchParams.get("t") ?? "";
  const s = u.searchParams.get("s") ?? "square";
  const shape: DesignShape = s in DESIGN_SHAPES ? (s as DesignShape) : "square";
  const { lang, t } = await getT();
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
  const last = await db.post.findFirst({ where: { businessId, mediaType: "photo", NOT: { mediaUrl: "" } }, orderBy: { createdAt: "desc" } });
  const photoUrl = last?.mediaUrl.startsWith("https://") ? last.mediaUrl : await samplePhoto(b.color);
  try {
    const jpg = await renderDesign({
      brand: { name: b.name, color: b.color, color2: b.color2, color3: b.color3, logoUrl: b.logoUrl, logoLightUrl: b.logoLightUrl, phone: b.phone, website: b.website, fontHeading: b.fontHeading, fontBody: b.fontBody },
      template: spec,
      headline: sample(t)[spec.layout] ?? t("Revisa tu casa después de la tormenta", "Check your home after the storm"),
      steps: [t("Toma fotos desde el suelo", "Take photos from the ground"), t("Guarda los recibos", "Keep your receipts"), t("Pide una evaluación", "Ask for an assessment")],
      photoUrl,
      shape,
    });
    return new Response(new Uint8Array(jpg), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=60" } });
  } catch (e) {
    return new Response(errorText(e, lang), { status: 500 });
  }
}
