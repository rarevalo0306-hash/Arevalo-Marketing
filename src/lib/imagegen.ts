// Fotos con IA: FLUX (fal.ai, la más barata), Recraft, ChatGPT (OpenAI) o Google Gemini.
import { generateImage as fluxImage, type Shape } from "@/lib/fal";
import { storeBuffer, storeRemote } from "@/lib/media";
import { bi } from "@/lib/i18n";

export const IMAGE_PROVIDERS = [
  // name en español, nameEn en inglés: la pantalla elige según el idioma de la app.
  { id: "flux", name: "FLUX (fal.ai) — la más barata", nameEn: "FLUX (fal.ai) — the cheapest", env: "FAL_KEY" },
  { id: "recraft", name: "Recraft", nameEn: "Recraft", env: "RECRAFT_API_KEY" },
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

const STYLE =
  "Photorealistic, natural light, professional marketing photo. No text, no letters, no logos, no watermarks. No recognizable real people.";

async function recraftImage(description: string, shape: Shape): Promise<string> {
  const size = shape === "vertical" ? "1024x1820" : shape === "horizontal" ? "1820x1024" : "1024x1024";
  const res = await fetch("https://external.api.recraft.ai/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RECRAFT_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      // Recraft acepta hasta 1000 caracteres en la descripción.
      prompt: `${description.slice(0, 1000 - STYLE.length - 2)}. ${STYLE}`,
      model: process.env.RECRAFT_MODEL || "recraftv3",
      style: process.env.RECRAFT_STYLE || "realistic_image",
      size,
      n: 1,
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw bi("Recraft rechazó la clave (RECRAFT_API_KEY). Revisa que esté bien copiada.", "Recraft rejected the key (RECRAFT_API_KEY). Check that it was copied correctly.");
    if (res.status === 402 || res.status === 429 || body.includes("credit")) throw bi("Tu cuenta de Recraft no tiene créditos o llegó a su límite.", "Your Recraft account is out of credits or has hit its limit.");
    throw bi(`Recraft respondió ${res.status}: ${body.slice(0, 300)}`, `Recraft responded ${res.status}: ${body.slice(0, 300)}`);
  }
  const url = (JSON.parse(body) as { data?: { url?: string }[] }).data?.[0]?.url;
  if (!url) throw bi("Recraft no devolvió la imagen. Intenta de nuevo.", "Recraft didn't return the image. Try again.");
  return url;
}

async function openaiImage(description: string, shape: Shape): Promise<Buffer> {
  const size = shape === "vertical" ? "1024x1536" : shape === "horizontal" ? "1536x1024" : "1024x1024";
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini",
      prompt: `${description}. ${STYLE}`,
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
      contents: [{ role: "user", parts: [{ text: `Create an image: ${description}. ${STYLE}` }] }],
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

/** Crea la foto con la IA elegida y la guarda en tu almacenamiento. Devuelve la dirección pública. */
export async function createImage(pref: string, description: string, shape: Shape, folder: string): Promise<string> {
  const provider = pickImage(pref);
  const d = description.trim().slice(0, 1000);
  if (provider === "flux") return (await storeRemote(await fluxImage(d, shape), folder)).url;
  if (provider === "recraft") return (await storeRemote(await recraftImage(d, shape), folder)).url;
  if (provider === "openai") return (await storeBuffer(await openaiImage(d, shape), "image/jpeg", folder)).url;
  if (provider === "gemini") {
    const img = await geminiImage(d, shape);
    return (await storeBuffer(img.data, img.type, folder)).url;
  }
  throw bi("Falta una clave para crear imágenes (FAL_KEY, RECRAFT_API_KEY, OPENAI_API_KEY o GEMINI_API_KEY).", "An image key is missing (FAL_KEY, RECRAFT_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY).");
}
