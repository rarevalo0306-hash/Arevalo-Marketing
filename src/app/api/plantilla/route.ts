import { db } from "@/lib/db";
import { renderDesign, samplePhoto } from "@/lib/design";
import { BUILTIN_TEMPLATES, TemplateSpec } from "@/lib/design-shapes";

export const dynamic = "force-dynamic";

const SAMPLE: Record<string, string> = {
  lista: "Después de una tormenta",
  "color-solido": "¿Sabías que puedes pedir una segunda opinión?",
};

// Vista previa de una plantilla con la marca del negocio (protegida por el middleware: hay que haber entrado).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const businessId = u.searchParams.get("b") ?? "";
  const t = u.searchParams.get("t") ?? "";
  const b = await db.business.findUnique({ where: { id: businessId } });
  if (!b) return new Response("Negocio no encontrado", { status: 404 });
  let spec: TemplateSpec | undefined;
  if (t.startsWith("builtin-")) spec = BUILTIN_TEMPLATES[Number(t.slice(8))];
  else {
    const row = await db.template.findFirst({ where: { id: t, businessId } });
    const parsed = row ? TemplateSpec.safeParse(row.spec) : null;
    spec = parsed?.success ? parsed.data : undefined;
  }
  if (!spec) return new Response("Plantilla no encontrada", { status: 404 });
  const last = await db.post.findFirst({ where: { businessId, mediaType: "photo", NOT: { mediaUrl: "" } }, orderBy: { createdAt: "desc" } });
  const photoUrl = last?.mediaUrl.startsWith("https://") ? last.mediaUrl : await samplePhoto(b.color);
  try {
    const jpg = await renderDesign({
      brand: { name: b.name, color: b.color, color2: b.color2, color3: b.color3, logoUrl: b.logoUrl, logoLightUrl: b.logoLightUrl, phone: b.phone, website: b.website, fontHeading: b.fontHeading },
      template: spec,
      headline: SAMPLE[spec.layout] ?? "Revisa tu casa después de la tormenta",
      steps: ["Toma fotos desde el suelo", "Guarda los recibos", "Pide una evaluación"],
      photoUrl,
    });
    return new Response(new Uint8Array(jpg), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=60" } });
  } catch (e) {
    return new Response((e as Error).message, { status: 500 });
  }
}
