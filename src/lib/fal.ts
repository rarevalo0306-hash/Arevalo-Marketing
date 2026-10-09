// Imágenes y videos con IA.
// - Fotos: FLUX.2 en fal.ai (buena calidad y barata).
// - Videos (foto → video de 5 s): Seedance 1.0 Pro Fast en fal.ai por defecto (rápido y barato), o
//   Veo 3.1 Lite de Google con la clave de Gemini (VIDEO_PROVIDER=veo, o si no hay FAL_KEY).
// Precios y tiempos verificados en las páginas oficiales en octubre de 2026 (ver VIDEO_MODELS).
import { bi } from "@/lib/i18n";

export const falEnabled = () => Boolean(process.env.FAL_KEY);

const IMAGE_MODEL = process.env.FAL_IMAGE_MODEL || "fal-ai/flux-2";
const QUEUE = "https://queue.fal.run/";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/";

export type Shape = "square" | "vertical" | "horizontal";
const SIZES: Record<Shape, string> = { square: "square_hd", vertical: "portrait_16_9", horizontal: "landscape_16_9" };

/**
 * Lo que pedimos siempre: foto realista de un negocio real, sin letras (las letras las pone el diseño).
 * Los modelos de fotos de hoy no aceptan "negative prompt", así que lo que se evita va en el mismo texto.
 */
export const PHOTO_STYLE =
  "Realistic photograph for a local business's social media: shot on a full-frame camera with a 35mm lens, natural light, true-to-life colors, sharp focus, authentic everyday scene, clean composition with calm space for a headline. " +
  "Absolutely no text, letters, numbers, signs, logos or watermarks anywhere in the image. No recognizable real people or celebrities; any people look natural and candid. " +
  "Avoid: illustration, cartoon, 3D render, CGI look, oversaturated colors, distorted hands or faces, plastic skin, blur.";

async function fal<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.text();
  if (!res.ok) {
    if (body.includes("TOP_UP") || body.includes("Exhausted balance")) throw bi("Tu cuenta de fal.ai no tiene saldo. Recárgala en fal.ai/dashboard/billing.", "Your fal.ai account is out of credit. Top it up at fal.ai/dashboard/billing.");
    if (res.status === 401 || res.status === 403) throw bi("fal.ai rechazó la clave (FAL_KEY). Revisa que esté bien copiada.", "fal.ai rejected the key (FAL_KEY). Check that it was copied correctly.");
    throw bi(`fal.ai respondió ${res.status}: ${body.slice(0, 300)}`, `fal.ai responded ${res.status}: ${body.slice(0, 300)}`);
  }
  return JSON.parse(body) as T;
}

/** Crea una foto a partir de una descripción (ya con el estilo y el contexto). Devuelve una URL temporal de fal.ai. */
export async function generateImage(prompt: string, shape: Shape = "square"): Promise<string> {
  const schnell = IMAGE_MODEL.includes("schnell");
  const out = await fal<{ images?: { url: string }[]; has_nsfw_concepts?: boolean[] }>(`https://fal.run/${IMAGE_MODEL}`, {
    method: "POST",
    body: JSON.stringify({
      prompt: prompt.trim(),
      image_size: SIZES[shape],
      num_images: 1,
      output_format: "jpeg",
      enable_safety_checker: true,
      // FLUX.2: 28 pasos y aceleración normal (calidad alta a buen precio); schnell solo usa 4 pasos.
      ...(schnell ? {} : { num_inference_steps: 28, guidance_scale: 3, acceleration: "regular" }),
    }),
  });
  const url = out.images?.[0]?.url;
  if (!url || out.has_nsfw_concepts?.[0]) throw bi("La IA no pudo crear esa imagen. Prueba con otra descripción.", "The AI couldn't create that image. Try a different description.");
  return url;
}

// ---------- Videos ----------

/**
 * Modelos de video conocidos: precio de un video de 5 s y tiempo típico (para mostrar al dueño).
 * Precios oficiales de fal.ai y de la API de Gemini (octubre 2026).
 */
export const VIDEO_MODELS: Record<string, { usd: number; etaSec: number; name: string }> = {
  "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video": { usd: 0.11, etaSec: 50, name: "Seedance 1.0 Pro Fast (720p)" },
  "fal-ai/kling-video/v2.5-turbo/standard/image-to-video": { usd: 0.21, etaSec: 90, name: "Kling 2.5 Turbo Standard" },
  "fal-ai/kling-video/v2.5-turbo/pro/image-to-video": { usd: 0.35, etaSec: 100, name: "Kling 2.5 Turbo Pro" },
  "fal-ai/kling-video/v2.1/standard/image-to-video": { usd: 0.28, etaSec: 180, name: "Kling 2.1 Standard" },
  "veo-3.1-lite-generate-preview": { usd: 0.3, etaSec: 75, name: "Veo 3.1 Lite (6 s, 720p, con sonido)" },
  "veo-3.1-fast-generate-preview": { usd: 0.6, etaSec: 75, name: "Veo 3.1 Fast (6 s, 720p, con sonido)" },
};
const FAL_VIDEO_MODEL = process.env.FAL_VIDEO_MODEL || "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video";
const VEO_MODEL = process.env.GEMINI_VIDEO_MODEL || "veo-3.1-lite-generate-preview";

/** Qué servicio hace los videos: fal.ai (por defecto) o Veo con la clave de Gemini. */
export function videoProvider(): "fal" | "veo" | null {
  const pref = (process.env.VIDEO_PROVIDER || "").toLowerCase();
  if (pref === "veo" && process.env.GEMINI_API_KEY) return "veo";
  if (process.env.FAL_KEY) return "fal";
  if (process.env.GEMINI_API_KEY && pref !== "fal") return "veo";
  return null;
}
export const videoEnabled = () => videoProvider() !== null;

/** Tiempo típico (segundos) del modelo de video configurado, para mostrar el avance. */
export function videoEta(): number {
  const p = videoProvider();
  return VIDEO_MODELS[p === "veo" ? VEO_MODEL : FAL_VIDEO_MODEL]?.etaSec ?? 120;
}

export type VideoJob = { statusUrl: string; responseUrl: string; provider?: "fal" | "veo"; etaSec?: number; startedAt?: number };

const MOTION = "Slow, smooth, steady camera movement; realistic motion; keep the scene and lighting consistent; no text, letters or watermarks appearing";

/** Empieza a convertir una foto en un video corto. Luego se consulta con videoResult. */
export async function startVideo(imageUrl: string, motion: string): Promise<VideoJob> {
  const prompt = `${motion.trim() || "Gentle cinematic push-in"}. ${MOTION}.`;
  const etaSec = videoEta();
  const startedAt = Date.now();
  if (videoProvider() === "veo") return { ...(await startVeo(imageUrl, prompt)), provider: "veo", etaSec, startedAt };
  const model = FAL_VIDEO_MODEL;
  const body = model.includes("seedance")
    ? { image_url: imageUrl, prompt, resolution: process.env.FAL_VIDEO_RESOLUTION || "720p", duration: "5", aspect_ratio: "auto", camera_fixed: false, enable_safety_checker: true }
    : model.includes("kling")
      ? { image_url: imageUrl, prompt, negative_prompt: "text, letters, watermark, blur, distortion, warped faces, low quality", duration: "5", cfg_scale: 0.5 }
      : { image_url: imageUrl, prompt, duration: "5" };
  const out = await fal<{ status_url: string; response_url: string }>(QUEUE + model, { method: "POST", body: JSON.stringify(body) });
  return { statusUrl: out.status_url, responseUrl: out.response_url, provider: "fal", etaSec, startedAt };
}

/** Veo (API de Gemini): foto inicial + texto, 9:16, 6 segundos, 720p. */
async function startVeo(imageUrl: string, prompt: string): Promise<{ statusUrl: string; responseUrl: string }> {
  const img = await fetch(imageUrl);
  if (!img.ok) throw bi(`No se pudo leer la foto para el video (${img.status}).`, `Couldn't read the photo for the video (${img.status}).`);
  const mimeType = (img.headers.get("content-type") || "image/jpeg").split(";")[0];
  const data = Buffer.from(await img.arrayBuffer()).toString("base64");
  const res = await fetch(`${GEMINI}models/${VEO_MODEL}:predictLongRunning`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt: `${prompt} Soft natural ambient sound only, no speech, no music.`, image: { inlineData: { mimeType, data } } }],
      parameters: { aspectRatio: "9:16", durationSeconds: 6, resolution: "720p", personGeneration: "allow_adult" },
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    if (res.status === 429) throw bi("Google llegó a su límite para videos. Activa la facturación en Google AI Studio o intenta más tarde.", "Google has hit its video limit. Turn on billing in Google AI Studio or try later.");
    throw bi(`Google respondió ${res.status}: ${body.slice(0, 300)}`, `Google responded ${res.status}: ${body.slice(0, 300)}`);
  }
  const name = (JSON.parse(body) as { name?: string }).name ?? "";
  if (!/^models\/[\w.-]+\/operations\/[\w-]+$/.test(name)) throw bi("Google no devolvió el trabajo del video. Intenta de nuevo.", "Google didn't return the video job. Please try again.");
  return { statusUrl: GEMINI + name, responseUrl: GEMINI + name };
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
/** Igual para Google: solo operaciones y archivos de la API de Gemini. */
export function isGeminiUrl(u: string, kind: "operation" | "file"): boolean {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:" || url.hostname !== "generativelanguage.googleapis.com") return false;
    return kind === "operation" ? /^\/v1beta\/models\/[\w.-]+\/operations\/[\w-]+$/.test(url.pathname) : /^\/v1beta\/files\/[\w-]+(:download)?$/.test(url.pathname);
  } catch {
    return false;
  }
}

/** ¿Ya está el video? Devuelve la dirección para descargarlo (y los encabezados necesarios). */
export async function videoResult(job: VideoJob): Promise<{ done: false } | { done: true; url: string; headers?: Record<string, string> }> {
  if (job.provider === "veo") {
    if (!isGeminiUrl(job.statusUrl, "operation")) throw bi("Dirección de video no válida.", "Invalid video address.");
    const res = await fetch(job.statusUrl, { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY! } });
    const op = (await res.json()) as { done?: boolean; error?: { message?: string }; response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[]; raiMediaFilteredReasons?: string[] } } };
    if (!res.ok) throw bi(`Google respondió ${res.status}.`, `Google responded ${res.status}.`);
    if (!op.done) return { done: false };
    if (op.error) throw bi(`Google no pudo crear el video: ${op.error.message ?? ""}`, `Google couldn't create the video: ${op.error.message ?? ""}`);
    const uri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ?? "";
    if (!isGeminiUrl(uri, "file")) throw bi("Google no quiso crear ese video. Prueba con otra foto.", "Google wouldn't create that video. Try a different photo.");
    return { done: true, url: uri, headers: { "x-goog-api-key": process.env.GEMINI_API_KEY! } };
  }
  if (!isFalQueueUrl(job.statusUrl) || !isFalQueueUrl(job.responseUrl)) throw bi("Dirección de video no válida.", "Invalid video address.");
  const st = await fal<{ status: string }>(job.statusUrl);
  if (st.status !== "COMPLETED") return { done: false };
  const out = await fal<{ video?: { url: string } }>(job.responseUrl);
  if (!out.video?.url) throw bi("fal.ai terminó pero no devolvió el video. Intenta de nuevo.", "fal.ai finished but didn't return the video. Please try again.");
  return { done: true, url: out.video.url };
}

// ---------- Videos con tus fotos reales (sección «Videos») ----------
// FFmpeg compose de fal.ai une los cuadros que dibuja la app (fotos con movimiento y texto, cierre con la marca) y
// los clips reales en un MP4; la música la crea CassetteAI (instrumental, uso comercial permitido en fal.ai).
// Precios oficiales (octubre 2026): compose US$0.0002 por segundo de video; música US$0.02 por minuto.

export const FAL_COMPOSE_MODEL = "fal-ai/ffmpeg-api/compose";
export const FAL_MUSIC_MODEL = process.env.FAL_MUSIC_MODEL || "cassetteai/music-generator";
/** Tipo de pista para los cuadros de las fotos: "video" (como el video-starter-kit de fal) o "image". */
export const composeFrameTrack = (): "video" | "image" => (process.env.FAL_COMPOSE_FRAME_TRACK === "image" ? "image" : "video");

export type FalJob = { statusUrl: string; responseUrl: string };

/** Manda un trabajo a la cola de fal.ai (no espera el resultado). */
export async function falSubmit(model: string, input: unknown): Promise<FalJob> {
  const out = await fal<{ status_url: string; response_url: string }>(QUEUE + model, { method: "POST", body: JSON.stringify(input) });
  if (!isFalQueueUrl(out.status_url) || !isFalQueueUrl(out.response_url)) throw bi("fal.ai no devolvió el trabajo. Intenta de nuevo.", "fal.ai didn't return the job. Please try again.");
  return { statusUrl: out.status_url, responseUrl: out.response_url };
}

/** ¿Ya terminó? Devuelve la respuesta del modelo cuando está lista. */
export async function falPoll<T>(job: FalJob): Promise<{ done: false } | { done: true; out: T }> {
  if (!isFalQueueUrl(job.statusUrl) || !isFalQueueUrl(job.responseUrl)) throw bi("Dirección de trabajo no válida.", "Invalid job address.");
  const st = await fal<{ status: string }>(job.statusUrl);
  if (st.status !== "COMPLETED") return { done: false };
  return { done: true, out: await fal<T>(job.responseUrl) };
}

/** Empieza la música de fondo (segundos enteros, instrumental). */
export function startMusic(prompt: string, seconds: number): Promise<FalJob> {
  return falSubmit(FAL_MUSIC_MODEL, { prompt: prompt.slice(0, 400), duration: Math.max(10, Math.min(180, Math.ceil(seconds))) });
}
/** La dirección del audio cuando la música está lista. */
export const musicUrlOf = (out: { audio_file?: { url?: string }; audio?: { url?: string } }) => out.audio_file?.url ?? out.audio?.url ?? "";

/** Empieza a unir las pistas en un MP4. */
export function startCompose(tracks: unknown[]): Promise<FalJob> {
  return falSubmit(FAL_COMPOSE_MODEL, { tracks });
}
