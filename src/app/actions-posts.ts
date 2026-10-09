"use server";

// «Posts (fotos y diseños)»: el texto alternativo de las fotos (con palabras clave y la ciudad), escrito por la IA
// (una llamada barata) o con la plantilla, y lo que se sabe de una foto de «Tus fotos».
import { logAiAction } from "@/lib/ai-actions";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { CAROUSEL_MAX } from "@/lib/post-media";
import { altTexts } from "@/lib/post-seo";

export type AltResult = { ok: true; alts: string[]; fromAi: boolean; note?: string } | { ok: false; error: string };

/**
 * Texto alternativo para las fotos de una publicación. `ai` = false: solo la plantilla («lo que se ve — palabra
 * en ciudad»), sin costo. `ai` = true: la IA mira las fotos y lo escribe (si falla, queda la plantilla).
 */
export async function postAltTexts(businessId: string, items: { url: string; what?: string }[], text: string, ai: boolean): Promise<AltResult> {
  const { lang, t } = await getT();
  try {
    const b = await db.business.findUnique({ where: { id: businessId } });
    if (!b) return { ok: false, error: t("Negocio no encontrado", "Business not found") };
    const list = items
      .filter((i) => typeof i?.url === "string" && /^(https?:\/\/|\/media\/)/.test(i.url))
      .slice(0, CAROUSEL_MAX)
      .map((i) => ({ url: i.url.slice(0, 2000), what: typeof i.what === "string" ? i.what.slice(0, 300) : undefined }));
    if (!list.length) return { ok: true, alts: [], fromAi: false };
    const r = await altTexts(b, list, String(text ?? "").slice(0, 4000), lang === "en" ? "en" : "es", { ai });
    if (r.fromAi) {
      await logAiAction({
        businessId,
        kind: "post.alt",
        actor: "owner",
        summary: {
          es: `La IA escribió el texto alternativo de ${list.length} ${list.length === 1 ? "foto" : "fotos"} con palabras clave.`,
          en: `AI wrote the alt text for ${list.length} ${list.length === 1 ? "photo" : "photos"} with keywords.`,
        },
        detail: { alts: r.alts },
      });
    }
    const note = ai && !r.fromAi ? t("La IA no respondió ahora; dejamos un texto con tus palabras clave. Puedes cambiarlo.", "AI didn't answer right now; we left a text with your keywords. You can change it.") : undefined;
    return { ok: true, alts: r.alts, fromAi: r.fromAi, note };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}
