// Texto alternativo y datos de SEO para «Posts»: la ciudad del negocio y el texto alternativo de cada foto,
// escrito por la IA (una llamada barata) o con la plantilla. Las palabras del negocio y el punto importante de
// las fotos están en src/lib/post-focus.ts (sin depender de media-formats).
import { z } from "zod";
import type { Business } from "@prisma/client";
import { askGemini } from "@/lib/ai";
import { identityPrompt } from "@/lib/brand-identity";
import { businessPlace } from "@/lib/media-formats";
import { businessKeywords, libraryPhotoInfo } from "@/lib/post-focus";
import { altTextFallback, pickPostKeywords, whatFromText } from "@/lib/post-keywords";

export { businessKeywords, focusForUrl, libraryPhotoInfo } from "@/lib/post-focus";

type BizForKeywords = Pick<Business, "seoKeywords" | "study" | "studyInput" | "seoMapPlace" | "seoLocations" | "seoLocationName">;

/** La ciudad del negocio ("" si no se sabe). */
export function businessCity(b: Omit<BizForKeywords, "seoKeywords">): string {
  return businessPlace(b).city ?? "";
}

export type AltInput = { url: string; what?: string };
export type AltOutput = { alts: string[]; fromAi: boolean; error?: string };

const AltSchema = z.object({ alts: z.array(z.string()) });

/** Una foto chica (para la IA) en base64, o null si no se puede leer. */
async function photoPart(url: string): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  if (!/^https:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const sharp = (await import("sharp")).default;
    const small = await sharp(buf).rotate().resize(512, 512, { fit: "inside" }).jpeg({ quality: 70 }).toBuffer();
    return { inlineData: { mimeType: "image/jpeg", data: small.toString("base64") } };
  } catch {
    return null;
  }
}

/**
 * Texto alternativo para cada foto: lo escribe la IA (una sola llamada para todas, mirando fotos chicas) con una
 * palabra clave del post y la ciudad; si no hay IA o falla, la plantilla «lo que se ve — palabra en ciudad».
 */
export async function altTexts(
  b: BizForKeywords & { name: string; brandIdentity?: unknown },
  items: AltInput[],
  postText: string,
  lang: "es" | "en",
  opts: { ai: boolean } = { ai: true },
): Promise<AltOutput> {
  const keywords = pickPostKeywords(postText, businessKeywords(b), 3);
  const city = businessCity(b);
  const infos = await Promise.all(items.map((i) => libraryPhotoInfo(i.url)));
  const whats = items.map((i, n) => i.what?.trim() || infos[n].what?.[lang] || whatFromText(postText) || b.name);
  const fallback = whats.map((w, n) => altTextFallback(w, keywords[n % Math.max(1, keywords.length)] ?? keywords[0] ?? "", city, lang));
  if (!opts.ai || !process.env.GEMINI_API_KEY || !items.length) return { alts: fallback, fromAi: false };
  try {
    const parts = (await Promise.all(items.slice(0, 10).map((i) => photoPart(i.url)))).filter((p): p is NonNullable<typeof p> => p !== null);
    const system = [
      `You write image alt text for ${b.name}, a local business${city ? ` in ${city}` : ""}. Language: ${lang === "en" ? "English" : "Spanish"}.`,
      "Each alt text: one plain sentence, 8-20 words, under 125 characters. Describe what the photo really shows (never invent),",
      "then naturally include ONE of the given keywords and the city when it fits. No hashtags, no emojis, no 'image of' or 'photo of'.",
      "Return exactly one alt text per photo, in the same order.",
      identityPrompt(b),
    ].join("\n");
    const user = [
      `Keywords (use one per photo): ${keywords.join(", ") || "(none)"}`,
      `City: ${city || "(unknown)"}`,
      `Post text: ${postText.slice(0, 800)}`,
      ...items.map((_, n) => `Photo ${n + 1} (what we know it shows): ${whats[n].slice(0, 300)}`),
      parts.length === items.length ? "The photos are attached in the same order." : "Some photos could not be attached; use what we know they show.",
    ].join("\n");
    const r = await askGemini(AltSchema, system, user, 600, parts.length === items.length ? parts : []);
    const alts = items.map((_, n) => (r.alts[n] ?? "").replace(/\s+/g, " ").replace(/#[\p{L}\p{N}_]+/gu, "").trim().slice(0, 200) || fallback[n]);
    return { alts, fromAi: true };
  } catch (e) {
    return { alts: fallback, fromAi: false, error: (e as Error).message?.slice(0, 300) };
  }
}
