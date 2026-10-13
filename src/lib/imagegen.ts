// Fotos con IA: FLUX (fal.ai, la más barata), ChatGPT (OpenAI) o Google Gemini.
import { generateImage as fluxImage, PHOTO_STYLE, type Shape } from "@/lib/fal";
import { bi } from "@/lib/i18n";
import { recordAiMedia } from "@/lib/library";
import { logAiAction } from "@/lib/ai-actions";
import { storeAiPhoto } from "@/lib/media-formats";
import { publicMediaUrl, readMedia } from "@/lib/media";
import { aiImageEdit, aiPhotoProblems, FIX_CENTS, fixAiPhoto, fixEnabled } from "@/lib/photo-tools";
import type { PhotoMeta } from "@/lib/photo-meta";

export const IMAGE_PROVIDERS = [
  // name en español, nameEn en inglés: la pantalla elige según el idioma de la app.
  { id: "flux", name: "FLUX.2 (fal.ai) — buena y barata", nameEn: "FLUX.2 (fal.ai) — good and cheap", env: "FAL_KEY" },
  { id: "openai", name: "ChatGPT (OpenAI)", nameEn: "ChatGPT (OpenAI)", env: "OPENAI_API_KEY" },
  { id: "gemini", name: "Google Gemini", nameEn: "Google Gemini", env: "GEMINI_API_KEY" },
] as const;
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number]["id"];

export const availableImage = () => IMAGE_PROVIDERS.filter((p) => Boolean(process.env[p.env]));
export const imagesEnabled = () => availableImage().length > 0;

export function pickImage(pref: string): ImageProvider | null {
  const list = availableImage();
  return (list.find((p) => p.id === pref) ?? list[0])?.id ?? null;
}

/** Nombre aproximado de un color (para pedir detalles sutiles con el color de la marca). */
export function colorName(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return "";
  const [r, g, b] = m.slice(1).map((v) => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max - min < 0.12) return l > 0.8 ? "white" : l < 0.2 ? "black" : "gray";
  const d = max - min;
  const hue = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  const h = (hue + 360) % 360;
  const name = h < 15 || h >= 345 ? "red" : h < 40 ? "orange" : h < 65 ? "yellow" : h < 160 ? "green" : h < 195 ? "teal" : h < 250 ? "blue" : h < 290 ? "purple" : "pink";
  return l < 0.3 ? `deep ${name}` : name;
}

export type PhotoContext = {
  /** Ciudad o zona del negocio (para que la foto se vea local). */
  place?: string;
  /** Color principal de la marca (se pide como detalle sutil, nunca dominante). */
  color?: string;
  /** Datos que se escriben en el archivo (negocio, lugar, palabras clave). */
  meta?: PhotoMeta;
};

/** El texto final para la IA: la idea + el lugar + un toque del color de la marca + el estilo de foto real. */
export function photoPrompt(description: string, ctx: PhotoContext = {}): string {
  const d = description.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "").slice(0, 900);
  const place = ctx.place?.trim();
  const local = place && !d.toLowerCase().includes(place.toLowerCase().split(",")[0]) ? ` Setting: ${place}, with local architecture, vegetation and light typical of the area.` : "";
  const color = ctx.color ? colorName(ctx.color) : "";
  const brand = color && !["white", "black", "gray"].includes(color) ? ` Where it fits naturally, include one subtle ${color} detail (for example clothing, a door or an object), never dominant.` : "";
  return `${d}.${local}${brand} ${PHOTO_STYLE}`;
}

async function openaiImage(description: string, shape: Shape): Promise<Buffer> {
  const size = shape === "vertical" ? "1024x1536" : shape === "horizontal" ? "1536x1024" : "1024x1024";
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini",
      prompt: description,
      size,
      quality: process.env.OPENAI_IMAGE_QUALITY || "medium",
      output_format: "jpeg",
      n: 1,
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    if (res.status === 401) throw bi("OpenAI rechazó la clave (OPENAI_API_KEY).", "OpenAI rejected the key (OPENAI_API_KEY).");
    if (res.status === 429) throw bi("Tu cuenta de OpenAI no tiene saldo o llegó a su límite.", "Your OpenAI account is out of credit or has hit its limit.");
    if (body.includes("moderation") || body.includes("safety")) throw bi("ChatGPT no quiso crear esa imagen. Prueba con otra descripción.", "ChatGPT wouldn't create that image. Try a different description.");
    throw bi(`OpenAI respondió ${res.status}: ${body.slice(0, 300)}`, `OpenAI responded ${res.status}: ${body.slice(0, 300)}`);
  }
  const b64 = (JSON.parse(body) as { data?: { b64_json?: string }[] }).data?.[0]?.b64_json;
  if (!b64) throw bi("ChatGPT no devolvió la imagen. Intenta de nuevo.", "ChatGPT didn't return the image. Please try again.");
  return Buffer.from(b64, "base64");
}

async function geminiImage(description: string, shape: Shape): Promise<{ data: Buffer; type: string }> {
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
  const aspectRatio = shape === "vertical" ? "9:16" : shape === "horizontal" ? "16:9" : "1:1";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `Create an image: ${description}` }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio } },
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    if (res.status === 429) throw bi("Gemini llegó a su límite para imágenes. Activa la facturación en Google AI Studio o usa otra IA.", "Gemini has hit its image limit. Turn on billing in Google AI Studio or use a different AI.");
    throw bi(`Gemini respondió ${res.status}: ${body.slice(0, 300)}`, `Gemini responded ${res.status}: ${body.slice(0, 300)}`);
  }
  const parts = (JSON.parse(body) as { candidates?: { content?: { parts?: { inlineData?: { data: string; mimeType: string } }[] } }[] })
    .candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData)?.inlineData;
  if (!img) throw bi("Gemini no pudo crear esa imagen. Prueba con otra descripción.", "Gemini couldn't create that image. Try a different description.");
  return { data: Buffer.from(img.data, "base64"), type: img.mimeType };
}

/**
 * Crea la foto con la IA elegida y la guarda en tu almacenamiento con los datos del negocio
 * (autor, lugar, palabras clave). Las marcas de "hecho con IA" del proveedor se conservan. Devuelve la dirección pública.
 * `folder` es el id del negocio: la foto también queda en su biblioteca («Hechas con IA») para volver a usarla.
 * `used: false` cuando todavía no va en una publicación (ej. el compositor la crea para que el dueño decida).
 */
export async function createImage(pref: string, description: string, shape: Shape, folder: string, ctx: PhotoContext = {}, opts: { used?: boolean } = {}): Promise<string> {
  const url = await reviewAiPhoto(await createImageFile(pref, description, shape, folder, ctx), folder, ctx.meta);
  await recordAiMedia(folder, url, { kind: "photo", title: ctx.meta?.title, prompt: description, keywords: ctx.meta?.keywords, used: opts.used });
  return url;
}

/**
 * Antes de usar una foto que hizo la IA, la IA la revisa (manos raras, letras mal escritas, objetos derretidos) y, si
 * ve algo, la arregla una vez. Nunca falla: si no se puede revisar o arreglar, queda la foto como salió.
 */
async function reviewAiPhoto(url: string, folder: string, meta?: PhotoMeta): Promise<string> {
  if (!fixEnabled()) return url;
  try {
    const data = await readMedia(url);
    const problems = await aiPhotoProblems(data);
    if (!problems.length) return url;
    const out = await fixAiPhoto({ data, url: publicMediaUrl(url) }, problems);
    const fixed = await storeAiPhoto(out.data, out.type, folder, meta);
    await logAiAction({ businessId: folder, kind: "photo.fix", actor: "auto", costCents: FIX_CENTS, summary: { es: "Foto de IA arreglada antes de usarla", en: "AI photo fixed before using it" }, detail: { problems: problems.join("; ") } });
    return fixed;
  } catch (e) {
    console.error("[photo-fix]", e instanceof Error ? e.message : e);
    return url;
  }
}

async function createImageFile(pref: string, description: string, shape: Shape, folder: string, ctx: PhotoContext): Promise<string> {
  const provider = pickImage(pref);
  const d = photoPrompt(description.trim().slice(0, 1000), ctx);
  if (provider === "flux") {
    const res = await fetch(await fluxImage(d, shape));
    if (!res.ok) throw bi(`No se pudo descargar la foto creada por la IA (${res.status}).`, `Couldn't download the photo the AI created (${res.status}).`);
    const type = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    return storeAiPhoto(Buffer.from(await res.arrayBuffer()), type.startsWith("image/") ? type : "image/jpeg", folder, ctx.meta);
  }
  if (provider === "openai") return storeAiPhoto(await openaiImage(d, shape), "image/jpeg", folder, ctx.meta);
  if (provider === "gemini") {
    const img = await geminiImage(d, shape);
    return storeAiPhoto(img.data, img.type, folder, ctx.meta);
  }
  throw bi("Falta una clave para crear imágenes (FAL_KEY, OPENAI_API_KEY o GEMINI_API_KEY).", "An image key is missing (FAL_KEY, OPENAI_API_KEY or GEMINI_API_KEY).");
}

// ---------- Otra versión de una foto ----------

/** Qué se le pide a la IA para hacer otra versión de una foto que ella misma creó. */
export const variantPrompt = () =>
  "Create a new, different photograph of the same kind of scene as this image, for the next social media post: same subject, setting and style, " +
  "but a clearly different camera angle, framing and moment, so it doesn't look like the same photo. Keep it photorealistic and believable. " +
  PHOTO_STYLE;

/** Se puede hacer otra versión: con la clave de Gemini (lo más simple) o de fal.ai (Nano Banana). */
export const variantsEnabled = () => Boolean(process.env.GEMINI_API_KEY || process.env.FAL_KEY);
/** Precio aproximado de una versión (Gemini 2.5 Flash Image y Nano Banana en fal.ai: unos 4 centavos). */
export const VARIANT_CENTS = 4;

/**
 * Otra versión de una foto: mismo tema, lugar y estilo, otro ángulo y otro momento. `url` es la dirección pública de la
 * foto (la necesita fal.ai); `data` la foto en sí (la recibe Gemini). Devuelve la imagen nueva.
 */
export const photoVariant = (src: { data: Buffer; url: string }) => aiImageEdit(src, variantPrompt());

