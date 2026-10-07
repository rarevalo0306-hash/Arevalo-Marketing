"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addBrandAssets, newAssetId, readBrandAssets, type BrandAsset } from "@/lib/brand-assets";
import { updateBrandAssets } from "@/lib/brand-assets-db";
import { renderKit, pool } from "@/lib/brand-kit";
import { asCoverLang, cleanTagline, fallbackTagline, type CoverText } from "@/lib/brand-kit-formats";
import { aiEnabled, ask } from "@/lib/ai";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { storeBuffer, writeSidecar } from "@/lib/media";

export type KitResult = { ok: boolean; message: string; at?: number } | null;

/** La frase y el idioma de las portadas se guardan junto a la imagen para compartir (para volver a crear igual). */
export type KitSidecar = { kitCover: CoverText };

/** Crea (o vuelve a crear) todas las imágenes del kit con la marca del negocio. Gratis: no usa IA. */
export async function createBrandKit(businessId: string, _prev: KitResult, form: FormData): Promise<KitResult> {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, color: true, color2: true, color3: true, fontHeading: true, fontBody: true, logoUrl: true, logoLightUrl: true, phone: true, website: true, brandAssets: true },
  });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const cover: CoverText = { lang: asCoverLang(form.get("lang")), es: cleanTagline(form.get("es")), en: cleanTagline(form.get("en")) };
  const started = Date.now();
  try {
    const { pieces } = await renderKit({ ...b, assets: readBrandAssets(b.brandAssets), cover });
    const now = new Date().toISOString();
    const items: BrandAsset[] = await pool(pieces, 4, async (p) => {
      const { url } = await storeBuffer(p.data, "image/png", businessId);
      return {
        id: newAssetId(),
        kind: "kit",
        url,
        w: p.w,
        h: p.h,
        source: "generated",
        status: "accepted",
        label: p.format.label,
        format: p.format.key,
        group: p.format.group,
        transparent: p.transparent || undefined,
        createdAt: now,
      };
    });
    await updateBrandAssets(businessId, (cur) => ({ ...addBrandAssets(cur, items), generatedAt: now }));
    const og = items.find((a) => a.format === "og");
    if (og) await writeSidecar(og.url, { kitCover: cover } satisfies KitSidecar).catch(() => undefined);
    revalidatePath(`/b/${businessId}/marca`);
    const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
    console.log(`[kit] ${businessId}: ${items.length} imágenes en ${Date.now() - started} ms`);
    return { ok: true, at: Date.now(), message: t(`Listo: ${items.length} imágenes creadas en ${secs} segundos.`, `Done: ${items.length} images created in ${secs} seconds.`) };
  } catch (e) {
    console.error(`[kit] ${businessId}:`, e);
    return { ok: false, message: t(`No se pudo crear el kit: ${errorText(e, lang)}`, `Couldn't create the kit: ${errorText(e, lang)}`) };
  }
}

const TaglineSchema = z.object({
  es: z.string().describe("Short cover tagline in Spanish, 3 to 8 words, correct accents"),
  en: z.string().describe("The same tagline in natural English, 3 to 8 words"),
});

/** La IA propone una frase corta para las portadas (unos centavos). Sin IA, una frase sacada de los datos del negocio. */
export async function suggestKitTagline(businessId: string): Promise<{ ok: boolean; es: string; en: string; ai: boolean; message?: string }> {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { name: true, website: true, aiProfile: true, brandVoice: true, aiText: true } });
  if (!b) return { ok: false, es: "", en: "", ai: false, message: t("Negocio no encontrado", "Business not found") };
  const fb = fallbackTagline(b);
  if (!aiEnabled()) return { ok: true, ...fb, ai: false };
  try {
    const system = `You write the short tagline printed on the social media covers, website banner and business card of "${b.name}"${b.website ? ` (${b.website})` : ""}.
About the business (the only facts you may use): ${b.aiProfile.trim().slice(0, 1500) || "(no profile — keep it general)"}
${b.brandVoice.trim() ? `Brand voice: ${b.brandVoice.trim().slice(0, 600)}` : ""}
Rules: 3 to 8 words; say what the business does for its customers (and where, if the profile says it); no prices, no promises of results or money, no statistics, no hashtags, no emoji, no quotes, no final period. If it's a public adjuster or insurance-related, never promise a payout. Spanish must use correct accents.`;
    const r = await ask(b.aiText, TaglineSchema, system, "Write the tagline.", 600);
    const es = cleanTagline(r.es) || fb.es;
    const en = cleanTagline(r.en) || fb.en;
    return { ok: true, es, en, ai: true };
  } catch (e) {
    return { ok: false, ...fb, ai: false, message: t(`La IA no pudo proponer una frase: ${errorText(e, lang)}`, `The AI couldn't suggest a tagline: ${errorText(e, lang)}`) };
  }
}
