// Herramientas de IA para las fotos y el logo: recortar (quitar el fondo), agrandar sin inventar, arreglar los errores
// típicos de las fotos hechas con IA y quitar el fondo liso de un logo (este último sin IA, gratis).
// Regla de todas: una foto real editada sigue siendo una prueba. Nada aquí inventa detalles: el recorte solo quita el
// fondo, el agrandado es fiel (Real-ESRGAN, no un agrandador «creativo» que dibuja detalles que no estaban) y el
// arreglo solo se usa en fotos que hizo la IA. La original nunca se toca: cada resultado es una foto nueva.
import sharp from "sharp";
import { z } from "zod";
import { askGemini } from "@/lib/ai";
import { bi } from "@/lib/i18n";

/** Bria RMBG 2.0 en fal.ai: entrenado solo con imágenes con licencia. $0.018 por foto (octubre de 2026). */
export const CUTOUT_MODEL = "fal-ai/bria/background/remove";
export const CUTOUT_CENTS = 2;
/** Real-ESRGAN en fal.ai: agranda sin inventar. Se cobra por segundo ($0.00111); una foto toma unos segundos. */
export const UPSCALE_MODEL = "fal-ai/esrgan";
export const UPSCALE_CENTS = 1;
/** Arreglar una foto de IA: lo mismo que «otra versión» (Gemini 2.5 Flash Image o Nano Banana), unos 4 centavos. */
export const FIX_CENTS = 4;

export const falToolsEnabled = () => Boolean(process.env.FAL_KEY);
/** Revisar fotos de IA necesita Gemini (que mira la foto); arreglarlas, Gemini o fal.ai. */
export const fixEnabled = () => Boolean(process.env.GEMINI_API_KEY);

/** Solo se agrandan fotos chicas: con el lado largo por debajo de esto ya se ven borrosas en un post. */
export const UPSCALE_BELOW = 1600;
export const canUpscale = (w: number, h: number) => w > 0 && h > 0 && Math.max(w, h) < UPSCALE_BELOW;

/** Llama a un modelo de imágenes de fal.ai y devuelve la imagen que hizo. */
async function falImage(model: string, input: Record<string, unknown>): Promise<Buffer> {
  if (!process.env.FAL_KEY) throw bi("Para esto hace falta la clave de fal.ai (FAL_KEY).", "This needs the fal.ai key (FAL_KEY).");
  if (typeof input.image_url !== "string" || !/^https:\/\//i.test(input.image_url)) throw bi("La foto tiene que estar guardada en internet para que la IA la use.", "The photo must be stored online for the AI to use it.");
  const res = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.text();
  if (!res.ok) throw bi(`fal.ai respondió ${res.status}: ${body.slice(0, 300)}`, `fal.ai responded ${res.status}: ${body.slice(0, 300)}`);
  const url = (JSON.parse(body) as { image?: { url?: string } }).image?.url;
  if (!url) throw bi("La IA no devolvió la foto.", "The AI didn't return the photo.");
  const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!img.ok) throw bi(`No se pudo descargar la foto (${img.status}).`, `Couldn't download the photo (${img.status}).`);
  return Buffer.from(await img.arrayBuffer());
}

/** La persona u objeto principal sin el fondo (PNG transparente). */
export const cutoutPhoto = (imageUrl: string) => falImage(CUTOUT_MODEL, { image_url: imageUrl });

/** La foto al doble de tamaño, sin inventar detalles (modelo fiel, no «creativo»). */
export const upscalePhoto = (imageUrl: string) => falImage(UPSCALE_MODEL, { image_url: imageUrl, scale: 2, model: "RealESRGAN_x2plus", output_format: "jpeg" });

/**
 * Le pide a la IA de imágenes (Gemini 2.5 Flash Image, o Nano Banana en fal.ai) una foto nueva a partir de `src`
 * siguiendo `prompt` (otra versión, o la misma foto con errores arreglados).
 */
export async function aiImageEdit(src: { data: Buffer; url: string }, prompt: string): Promise<{ data: Buffer; type: string }> {
  if (process.env.GEMINI_API_KEY) {
    // Más chica para que la petición sea liviana (la IA no necesita más para entender la escena).
    const jpg = await sharp(src.data).rotate().resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: jpg.toString("base64") } }, { text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      if (res.status === 429) throw bi("Gemini llegó a su límite para imágenes. Activa la facturación en Google AI Studio.", "Gemini has hit its image limit. Turn on billing in Google AI Studio.");
      throw bi(`Gemini respondió ${res.status}: ${body.slice(0, 300)}`, `Gemini responded ${res.status}: ${body.slice(0, 300)}`);
    }
    const parts = (JSON.parse(body) as { candidates?: { content?: { parts?: { inlineData?: { data: string; mimeType: string } }[] } }[] }).candidates?.[0]?.content?.parts ?? [];
    const img = parts.find((x) => x.inlineData)?.inlineData;
    if (!img) throw bi("Gemini no pudo hacer la foto. Intenta de nuevo.", "Gemini couldn't make the photo. Please try again.");
    return { data: Buffer.from(img.data, "base64"), type: img.mimeType };
  }
  if (process.env.FAL_KEY) {
    if (!/^https:\/\//.test(src.url)) throw bi("La foto tiene que estar guardada en internet para que la IA la use.", "The photo must be stored online for the AI to use it.");
    const res = await fetch("https://fal.run/fal-ai/nano-banana/edit", {
      method: "POST",
      headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, image_urls: [src.url], num_images: 1, output_format: "jpeg" }),
    });
    const body = await res.text();
    if (!res.ok) throw bi(`fal.ai respondió ${res.status}: ${body.slice(0, 300)}`, `fal.ai responded ${res.status}: ${body.slice(0, 300)}`);
    const url = (JSON.parse(body) as { images?: { url?: string }[] }).images?.[0]?.url;
    if (!url) throw bi("La IA no pudo hacer la foto. Intenta de nuevo.", "The AI couldn't make the photo. Please try again.");
    const img = await fetch(url);
    if (!img.ok) throw bi(`No se pudo descargar la foto nueva (${img.status}).`, `Couldn't download the new photo (${img.status}).`);
    return { data: Buffer.from(await img.arrayBuffer()), type: (img.headers.get("content-type") || "image/jpeg").split(";")[0].trim() };
  }
  throw bi("Para editar fotos con IA hace falta la clave de Gemini (GEMINI_API_KEY) o de fal.ai (FAL_KEY).", "Editing photos with AI needs the Gemini key (GEMINI_API_KEY) or the fal.ai key (FAL_KEY).");
}

// ---------- Arreglar fotos de IA ----------

const CheckSchema = z.object({
  problems: z.array(z.string()).max(6).describe("Clearly visible defects, each as a short English phrase with where it is. Empty if none."),
});

export const CHECK_PROMPT = `You review AI-generated photos for a small business's social media before they are posted.
List only clearly visible defects that make the photo look fake or wrong:
- deformed, extra or missing fingers, hands, arms or legs
- distorted faces or eyes
- garbled, misspelled or meaningless text, letters, numbers, signs or logos
- melted, merged or duplicated objects, or impossible geometry
- watermarks
Say where each one is (for example "left hand of the man on the ladder has six fingers"). If nothing is clearly wrong, return an empty list. Do not report style, lighting or composition.`;

/** Los errores que se ven en una foto hecha con IA (lista vacía si está bien). Necesita Gemini. */
export async function aiPhotoProblems(file: Buffer): Promise<string[]> {
  const jpg = await sharp(file).rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const r = await askGemini(CheckSchema, CHECK_PROMPT, "Review this photo.", 1500, [{ inlineData: { mimeType: "image/jpeg", data: jpg.toString("base64") } }]);
  return r.problems.map((p) => p.trim()).filter(Boolean).slice(0, 6);
}

/** Qué se le pide a la IA para arreglar solo esos errores (las letras se quitan, no se reescriben: salen mal). */
export const fixPrompt = (problems: string[]) =>
  `Fix only these problems in this photo: ${problems.join("; ")}. ` +
  "Remove any text, letters, numbers, signs or logos entirely instead of rewriting them. " +
  "Keep everything else exactly the same: composition, framing, people, objects, colors and light. Photorealistic.";

/** La misma foto con esos errores arreglados. */
export const fixAiPhoto = (src: { data: Buffer; url: string }, problems: string[]) => aiImageEdit(src, fixPrompt(problems));

// ---------- Logo: quitar un fondo liso (sin IA) ----------

const near = (d: Buffer, i: number, c: number[], tol: number) => {
  const dr = d[i] - c[0];
  const dg = d[i + 1] - c[1];
  const db = d[i + 2] - c[2];
  return dr * dr + dg * dg + db * db <= tol * tol;
};

/**
 * Quita el fondo liso de un logo (blanco o de un solo color): se borra el color del fondo que toca el borde, nada más.
 * Lo que está dentro del dibujo nunca se toca (letras blancas dentro de un círculo siguen ahí). Devuelve un PNG
 * transparente, o null si el logo ya es transparente o su borde no es de un solo color (no hay fondo liso que quitar).
 */
export async function removeFlatBackground(file: Buffer): Promise<Buffer | null> {
  const { data, info } = await sharp(file).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  if (w < 8 || h < 8) return null;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  // Ya transparente: los bordes casi no tienen color.
  if (border.filter((p) => data[p * 4 + 3] < 200).length > border.length * 0.5) return null;
  // El color del fondo: el más común del borde (redondeado), y casi todo el borde tiene que ser de ese color.
  const counts = new Map<string, number>();
  for (const p of border) {
    const k = [0, 1, 2].map((c) => Math.round(data[p * 4 + c] / 16)).join(",");
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const bg = top.split(",").map((v) => Math.min(255, Number(v) * 16 + 8));
  const TOL = 48;
  if (border.filter((p) => near(data, p * 4, bg, TOL)).length < border.length * 0.85) return null;
  // Se llena desde el borde todo lo que es del color del fondo.
  const seen = new Uint8Array(w * h);
  const stack = border.filter((p) => near(data, p * 4, bg, TOL));
  for (const p of stack) seen[p] = 1;
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q < 0 || seen[q] || !near(data, q * 4, bg, TOL)) continue;
      seen[q] = 1;
      stack.push(q);
    }
  }
  let cleared = 0;
  for (let p = 0; p < w * h; p++) {
    if (!seen[p]) continue;
    data[p * 4 + 3] = 0;
    cleared++;
  }
  // Nada que quitar, o se borraría casi todo (el «fondo» era el logo).
  if (cleared === 0 || cleared > w * h * 0.97) return null;
  // Borde suave: los puntos del dibujo que tocan el fondo quedan un poco transparentes según qué tan parecidos son.
  const out = Buffer.from(data);
  for (let p = 0; p < w * h; p++) {
    if (seen[p]) continue;
    const x = p % w;
    const touches = (x > 0 && seen[p - 1]) || (x < w - 1 && seen[p + 1]) || (p >= w && seen[p - w]) || (p < w * (h - 1) && seen[p + w]);
    if (!touches) continue;
    const i = p * 4;
    const dist = Math.sqrt((data[i] - bg[0]) ** 2 + (data[i + 1] - bg[1]) ** 2 + (data[i + 2] - bg[2]) ** 2);
    out[i + 3] = Math.round(data[i + 3] * Math.min(1, Math.max(0.35, dist / (TOL * 2.5))));
  }
  return sharp(out, { raw: info }).png().toBuffer();
}
