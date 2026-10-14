// Extender una foto para otra forma: una foto horizontal sirve para una historia 9:16 agregando cielo, piso o pared
// arriba y abajo, en vez de ponerla chiquita sobre un fondo desenfocado. Con Bria Expand en fal.ai ($0.04 por foto,
// entrenado solo con imágenes con licencia: lo más seguro para uso comercial).
// La foto original nunca se toca: lo nuevo solo rodea la foto entera. La extendida va marcada como editada con IA
// (IPTC compositeWithTrainedAlgorithmicMedia) y se hace una sola vez por foto y forma.
import { createHash } from "crypto";
import { bi } from "@/lib/i18n";

export const EXPAND_MODEL = "fal-ai/bria/expand";
/** Lo que cuesta extender una foto (precio de fal.ai, octubre de 2026). */
export const EXPAND_CENTS = 4;
export const expandEnabled = () => Boolean(process.env.FAL_KEY);

/** Marca IPTC de una foto real con partes hechas por IA. */
export const EXPANDED_SOURCE = "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia";
export const EXPAND_TOOL = "Bria Expand (fal.ai)";

// Bria solo entiende inglés y sin caracteres especiales. Solo se continúa el entorno: nada que cambie lo que la foto
// muestra (personas, letreros, daños u objetos nuevos), porque una foto real editada sigue siendo una prueba.
export const EXPAND_PROMPT =
  "Continue the same scene naturally beyond the edges of the photo with the same light, perspective, colors and materials. Extend only the surroundings such as sky, clouds, trees, ground, grass, floor or walls.";
export const EXPAND_NEGATIVE = "people, faces, hands, animals, text, letters, words, logo, watermark, signs, vehicles, damage, debris, cracks, holes, new objects, frame, border, blur";

/** Qué parte de la foto queda si se recorta a la forma pedida (1 = toda). `ratio` y `want` son ancho/alto. */
export const keptFraction = (ratio: number, want: number) => (ratio > want ? want / ratio : ratio / want);

/** Solo vale la pena extender si recortar perdería mucho de la foto (si no, basta un buen recorte). */
export const worthExpanding = (ratio: number, want: number) => keptFraction(ratio, want) < 0.6;

/** Dónde va la foto entera dentro del lienzo nuevo: lo más grande que quepa, centrada. */
export function expandLayout(iw: number, ih: number, w: number, h: number): { canvas: [number, number]; size: [number, number]; at: [number, number] } {
  const scale = Math.min(w / iw, h / ih);
  const sw = Math.min(w, Math.round(iw * scale));
  const sh = Math.min(h, Math.round(ih * scale));
  return { canvas: [w, h], size: [sw, sh], at: [Math.round((w - sw) / 2), Math.round((h - sh) / 2)] };
}

/** Nombre fijo de la foto extendida: la misma foto en la misma forma se extiende (y se paga) una sola vez. */
export const expandedName = (mediaUrl: string, w: number, h: number) => `ia-extendida-${createHash("sha1").update(`${mediaUrl}|${w}x${h}|v1`).digest("hex").slice(0, 12)}.jpg`;

/**
 * Pide a Bria Expand la foto de `imageUrl` (pública, de iw × ih) extendida a w × h. Devuelve la imagen nueva.
 * Falla con un error claro (quien llama decide qué hacer; al publicar se usa el fondo desenfocado de siempre).
 */
export async function expandWithAi(imageUrl: string, iw: number, ih: number, w: number, h: number): Promise<Buffer> {
  if (!process.env.FAL_KEY) throw bi("Para extender fotos hace falta la clave de fal.ai (FAL_KEY).", "Extending photos needs the fal.ai key (FAL_KEY).");
  if (!/^https:\/\//i.test(imageUrl)) throw bi("La foto tiene que estar guardada en internet para extenderla.", "The photo must be stored online to extend it.");
  const { canvas, size, at } = expandLayout(iw, ih, w, h);
  const res = await fetch(`https://fal.run/${EXPAND_MODEL}`, {
    method: "POST",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, canvas_size: canvas, original_image_size: size, original_image_location: at, prompt: EXPAND_PROMPT, negative_prompt: EXPAND_NEGATIVE }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.text();
  if (!res.ok) throw bi(`fal.ai respondió ${res.status}: ${body.slice(0, 300)}`, `fal.ai responded ${res.status}: ${body.slice(0, 300)}`);
  const url = (JSON.parse(body) as { image?: { url?: string } }).image?.url;
  if (!url) throw bi("La IA no pudo extender esa foto.", "The AI couldn't extend that photo.");
  const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!img.ok) throw bi(`No se pudo descargar la foto extendida (${img.status}).`, `Couldn't download the extended photo (${img.status}).`);
  return Buffer.from(await img.arrayBuffer());
}
