// Fotos con IA: FLUX (fal.ai, la más barata), ChatGPT (OpenAI) o Google Gemini.
import { generateImage as fluxImage, type Shape } from "@/lib/fal";
import { storeBuffer, storeRemote } from "@/lib/media";
import { PublishError } from "@/lib/publishers/http";

export const IMAGE_PROVIDERS = [
  { id: "flux", name: "FLUX (fal.ai) — la más barata", env: "FAL_KEY" },
  { id: "openai", name: "ChatGPT (OpenAI)", env: "OPENAI_API_KEY" },
  { id: "gemini", name: "Google Gemini", env: "GEMINI_API_KEY" },
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
    if (res.status === 401) throw new PublishError("OpenAI rechazó la clave (OPENAI_API_KEY).");
    if (res.status === 429) throw new PublishError("Tu cuenta de OpenAI no tiene saldo o llegó a su límite.");
    if (body.includes("moderation") || body.includes("safety")) throw new PublishError("ChatGPT no quiso crear esa imagen. Prueba con otra descripción.");
    throw new PublishError(`OpenAI respondió ${res.status}: ${body.slice(0, 300)}`);
  }
  const b64 = (JSON.parse(body) as { data?: { b64_json?: string }[] }).data?.[0]?.b64_json;
  if (!b64) throw new PublishError("ChatGPT no devolvió la imagen. Intenta de nuevo.");
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
    if (res.status === 429) throw new PublishError("Gemini llegó a su límite para imágenes. Activa la facturación en Google AI Studio o usa otra IA.");
    throw new PublishError(`Gemini respondió ${res.status}: ${body.slice(0, 300)}`);
  }
  const parts = (JSON.parse(body) as { candidates?: { content?: { parts?: { inlineData?: { data: string; mimeType: string } }[] } }[] })
    .candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData)?.inlineData;
  if (!img) throw new PublishError("Gemini no pudo crear esa imagen. Prueba con otra descripción.");
  return { data: Buffer.from(img.data, "base64"), type: img.mimeType };
}

/** Crea la foto con la IA elegida y la guarda en tu almacenamiento. Devuelve la dirección pública. */
export async function createImage(pref: string, description: string, shape: Shape, folder: string): Promise<string> {
  const provider = pickImage(pref);
  const d = description.trim().slice(0, 1000);
  if (provider === "flux") return (await storeRemote(await fluxImage(d, shape), folder)).url;
  if (provider === "openai") return (await storeBuffer(await openaiImage(d, shape), "image/jpeg", folder)).url;
  if (provider === "gemini") {
    const img = await geminiImage(d, shape);
    return (await storeBuffer(img.data, img.type, folder)).url;
  }
  throw new PublishError("Falta una clave para crear imágenes (FAL_KEY, OPENAI_API_KEY o GEMINI_API_KEY).");
}
