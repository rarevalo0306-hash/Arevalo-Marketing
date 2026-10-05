// Imágenes y videos con IA a través de fal.ai (FLUX para fotos, Kling para convertir una foto en video).
import { PublishError } from "@/lib/publishers/http";

export const falEnabled = () => Boolean(process.env.FAL_KEY);

const IMAGE_MODEL = process.env.FAL_IMAGE_MODEL || "fal-ai/flux/schnell";
const VIDEO_MODEL = process.env.FAL_VIDEO_MODEL || "fal-ai/kling-video/v2.1/standard/image-to-video";
const QUEUE = "https://queue.fal.run/";

export type Shape = "square" | "vertical" | "horizontal";
const SIZES: Record<Shape, string> = { square: "square_hd", vertical: "portrait_16_9", horizontal: "landscape_16_9" };

// Lo que pedimos siempre, para que sirva a un negocio real.
const STYLE =
  "Photorealistic, natural light, professional marketing photo. No text, no letters, no logos, no watermarks. No recognizable real people.";

async function fal<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.text();
  if (!res.ok) {
    if (body.includes("TOP_UP") || body.includes("Exhausted balance")) throw new PublishError("Tu cuenta de fal.ai no tiene saldo. Recárgala en fal.ai/dashboard/billing.");
    if (res.status === 401 || res.status === 403) throw new PublishError("fal.ai rechazó la clave (FAL_KEY). Revisa que esté bien copiada.");
    throw new PublishError(`fal.ai respondió ${res.status}: ${body.slice(0, 300)}`);
  }
  return JSON.parse(body) as T;
}

/** Crea una foto a partir de una descripción. Devuelve una URL temporal de fal.ai. */
export async function generateImage(description: string, shape: Shape = "square"): Promise<string> {
  const out = await fal<{ images?: { url: string }[]; has_nsfw_concepts?: boolean[] }>(`https://fal.run/${IMAGE_MODEL}`, {
    method: "POST",
    body: JSON.stringify({ prompt: `${description.trim()}. ${STYLE}`, image_size: SIZES[shape], num_images: 1, output_format: "jpeg", enable_safety_checker: true }),
  });
  const url = out.images?.[0]?.url;
  if (!url || out.has_nsfw_concepts?.[0]) throw new PublishError("La IA no pudo crear esa imagen. Prueba con otra descripción.");
  return url;
}

export type VideoJob = { statusUrl: string; responseUrl: string };

/** Empieza a convertir una foto en un video de 5 segundos. Tarda 1-3 minutos; luego se consulta con videoResult. */
export async function startVideo(imageUrl: string, motion: string): Promise<VideoJob> {
  const out = await fal<{ status_url: string; response_url: string }>(QUEUE + VIDEO_MODEL, {
    method: "POST",
    body: JSON.stringify({
      image_url: imageUrl,
      prompt: `${motion.trim() || "Slow, smooth camera movement"}. Realistic, steady, cinematic.`,
      negative_prompt: "text, letters, watermark, blur, distortion, low quality",
      duration: "5",
    }),
  });
  return { statusUrl: out.status_url, responseUrl: out.response_url };
}

/** Solo aceptamos direcciones de la cola de fal.ai, para no mandar la clave a otro sitio. */
export function isFalQueueUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && url.hostname === "queue.fal.run";
  } catch {
    return false;
  }
}

export async function videoResult(job: VideoJob): Promise<{ done: false } | { done: true; url: string }> {
  if (!isFalQueueUrl(job.statusUrl) || !isFalQueueUrl(job.responseUrl)) throw new PublishError("Dirección de video no válida.");
  const st = await fal<{ status: string }>(job.statusUrl);
  if (st.status !== "COMPLETED") return { done: false };
  const out = await fal<{ video?: { url: string } }>(job.responseUrl);
  if (!out.video?.url) throw new PublishError("fal.ai terminó pero no devolvió el video. Intenta de nuevo.");
  return { done: true, url: out.video.url };
}
