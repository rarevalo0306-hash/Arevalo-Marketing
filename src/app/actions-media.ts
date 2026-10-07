"use server";

// Plantillas propias: el dueño sube su diseño (un marco con partes transparentes, o un fondo) y elige
// dónde van la foto y el titular. Se guarda como una plantilla más del negocio.
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { db } from "@/lib/db";
import { CustomSpec, customBase, PHOTO_SPOTS, TEXT_SPOTS } from "@/lib/design-shapes";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { isOwnFile, readMedia, storeBuffer } from "@/lib/media";

export type CustomTemplateResult = { ok: boolean; message: string } | null;

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];
const pick = <T extends string>(v: FormDataEntryValue | null, list: readonly T[], fallback: T): T => (list.includes(String(v) as T) ? (String(v) as T) : fallback);

/** Guarda una plantilla propia. La imagen llega ya subida (imageUrl, con Supabase) o como archivo (file). */
export async function saveCustomTemplate(businessId: string, _prev: CustomTemplateResult, f: FormData): Promise<CustomTemplateResult> {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  try {
    let url = String(f.get("imageUrl") ?? "").trim();
    let data: Buffer;
    const file = f.get("file");
    if (url) {
      if (!isOwnFile(url, businessId)) return { ok: false, message: t("La imagen no es de este negocio. Súbela de nuevo.", "That image doesn't belong to this business. Please upload it again.") };
      data = await readMedia(url);
    } else if (file instanceof File && file.size > 0) {
      if (!TYPES.includes(file.type)) return { ok: false, message: t("Usa una imagen PNG, JPG o WEBP.", "Use a PNG, JPG or WEBP image.") };
      if (file.size > MAX_BYTES) return { ok: false, message: t("La imagen es muy grande (máximo 8 MB).", "The image is too large (8 MB max).") };
      data = Buffer.from(await file.arrayBuffer());
      url = (await storeBuffer(data, file.type, businessId)).url;
    } else {
      return { ok: false, message: t("Elige la imagen de tu plantilla.", "Choose your template image.") };
    }

    const meta = await sharp(data).metadata().catch(() => null);
    if (!meta?.width || !meta.height) return { ok: false, message: t("No pudimos leer esa imagen. Prueba con un PNG o JPG.", "We couldn't read that image. Try a PNG or JPG.") };
    if (meta.width < 400 || meta.height < 400) return { ok: false, message: t("La imagen es muy pequeña: usa al menos 1080 píxeles de ancho.", "The image is too small: use at least 1080 pixels wide.") };
    const mode = pick(f.get("mode"), ["marco", "fondo"] as const, "fondo");
    if (mode === "marco" && !meta.hasAlpha) {
      return {
        ok: false,
        message: t(
          "Tu imagen no tiene partes transparentes, así que la foto quedaría tapada. Elige «Fondo» (la foto va en un recuadro) o sube un PNG con el centro transparente.",
          "Your image has no transparent parts, so it would cover the photo. Choose “Background” (the photo goes in a box) or upload a PNG with a transparent center.",
        ),
      };
    }
    const custom = CustomSpec.parse({
      imageUrl: url,
      w: meta.width,
      h: meta.height,
      mode,
      photo: mode === "marco" ? "completa" : pick(f.get("photo"), PHOTO_SPOTS, "arriba"),
      text: pick(f.get("text"), TEXT_SPOTS, "abajo"),
      ink: pick(f.get("ink"), ["claro", "oscuro", "marca"] as const, "claro"),
    });
    const name = String(f.get("name") ?? "").trim().slice(0, 40) || t("Mi plantilla", "My template");
    await db.template.create({ data: { businessId, name, spec: customBase(name, custom) } });
    revalidatePath(`/b/${businessId}/marca`);
    revalidatePath(`/b/${businessId}/publicar`);
    return { ok: true, message: t(`Listo: «${name}» quedó guardada. La IA la usará en tus fotos.`, `Done: “${name}” is saved. The AI will use it on your photos.`) };
  } catch (e) {
    return { ok: false, message: t(`No se pudo guardar la plantilla: ${errorText(e, lang)}`, `Couldn't save the template: ${errorText(e, lang)}`) };
  }
}
