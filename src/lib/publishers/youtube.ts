// YouTube: sube el video al canal del negocio con la API de datos (videos.insert, subida reanudable).
// - Título ≤ 100 caracteres (el seoTitle de la publicación, o la primera línea del texto), descripción ≤ 5000,
//   etiquetas ≤ 500 caracteres con las palabras clave del negocio.
// - Los verticales cortos se ven como Shorts (YouTube los reconoce solo; el título y la descripción llevan #Shorts).
// - Público y «no es para niños» (selfDeclaredMadeForKids: false).
// La conexión guarda clientId, clientSecret y refreshToken (con «Conectar con Google» o pegados a mano).
import { fitTags } from "@/lib/video-plan";
import { fetchJson, form, PublishError, required } from "./http";
import type { Creds, PublishInput, Publisher } from "./types";

const TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
/** 22 = «Gente y blogs» (la categoría más general); se puede cambiar con YOUTUBE_CATEGORY_ID. */
const CATEGORY = () => (/^\d{1,3}$/.test(process.env.YOUTUBE_CATEGORY_ID ?? "") ? process.env.YOUTUBE_CATEGORY_ID! : "22");

async function accessToken(creds: Creds): Promise<string> {
  const clientId = creds.clientId?.trim() || process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = creds.clientSecret?.trim() || process.env.GOOGLE_CLIENT_SECRET || "";
  required({ clientId, clientSecret, refreshToken: creds.refreshToken ?? "" }, ["clientId", "clientSecret", "refreshToken"]);
  const t = await fetchJson<{ access_token: string }>(TOKEN, {
    method: "POST",
    body: form({ client_id: clientId, client_secret: clientSecret, refresh_token: creds.refreshToken, grant_type: "refresh_token" }),
  });
  return t.access_token;
}

const noAngles = (s: string) => s.replace(/[<>]/g, "");
const firstLine = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/https?:\/\/\S+/g, "").replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s+/g, " ").trim())
    .find(Boolean) ?? "";

/** «#CortinasMetalicas» → «Cortinas Metalicas». */
const words = (tag: string) => tag.replace(/^#/, "").replace(/_/g, " ").replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, "$1 $2");

/** Etiquetas: las palabras clave del negocio y los hashtags del texto (sin #Shorts), ≤ 500 caracteres. */
export function youtubeTags(text: string, keywords: string[] = []): string[] {
  const tags = [...text.matchAll(/#([\p{L}\p{N}_]{2,60})/gu)].map((m) => m[1]).filter((t) => t.toLowerCase() !== "shorts");
  return fitTags([...keywords, ...tags.map(words)]);
}

/** Lo que se manda a YouTube (sin subir nada): título, descripción, etiquetas, categoría y privacidad. */
export function youtubeMetadata(input: Pick<PublishInput, "text" | "seoTitle" | "businessName" | "keywords">) {
  const raw = noAngles(input.seoTitle.trim() || firstLine(input.text) || input.businessName).replace(/\s+/g, " ").trim();
  const title = raw.length <= 100 ? raw : raw.slice(0, 101).replace(/\s+\S*$/, "").slice(0, 100);
  const description = noAngles(input.text).slice(0, 5000);
  return {
    snippet: { title, description, tags: youtubeTags(input.text, input.keywords ?? []), categoryId: CATEGORY() },
    status: { privacyStatus: "public" as const, selfDeclaredMadeForKids: false, embeddable: true },
  };
}

/** El primer paso de la subida reanudable: pide la dirección donde se sube el archivo. */
export function uploadInitRequest(meta: ReturnType<typeof youtubeMetadata>, size: number, contentType: string, token: string): { url: string; init: RequestInit } {
  return {
    url: UPLOAD,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": contentType,
        "X-Upload-Content-Length": String(size),
      },
      body: JSON.stringify(meta),
    },
  };
}

async function apiError(res: Response): Promise<PublishError> {
  const raw = await res.text();
  let msg = raw.slice(0, 300);
  try {
    const b = JSON.parse(raw) as { error?: { message?: string; errors?: { reason?: string }[] } };
    const reason = b.error?.errors?.[0]?.reason ?? "";
    if (reason === "uploadLimitExceeded" || reason === "quotaExceeded") return new PublishError("YouTube llegó al límite de subidas de hoy. Intenta mañana.");
    if (reason === "youtubeSignupRequired") return new PublishError("Esa cuenta de Google todavía no tiene canal de YouTube. Créalo en youtube.com y vuelve a conectar.");
    msg = b.error?.message ?? msg;
  } catch {
    // respuesta que no es JSON
  }
  return new PublishError(`${res.status}: ${msg || "sin detalle"}`);
}

export const youtube: Publisher = {
  async publish(input, creds) {
    if (input.mediaType !== "video" || !input.mediaUrl) throw new PublishError("YouTube necesita un video.");
    const token = await accessToken(creds);
    const file = await fetch(input.mediaUrl, { cache: "no-store" });
    if (!file.ok) throw new PublishError(`No se pudo leer el video para subirlo (${file.status}).`);
    const data = new Uint8Array(await file.arrayBuffer());
    const type = (file.headers.get("content-type") || "video/mp4").split(";")[0].trim();
    const meta = youtubeMetadata(input);
    const init = uploadInitRequest(meta, data.byteLength, type.startsWith("video/") ? type : "video/mp4", token);
    const start = await fetch(init.url, { ...init.init, cache: "no-store" });
    if (!start.ok) throw await apiError(start);
    const location = start.headers.get("location") ?? "";
    if (!/^https:\/\/www\.googleapis\.com\/upload\/youtube\//.test(location)) throw new PublishError("YouTube no dio la dirección para subir el video. Intenta de nuevo.");
    const put = await fetch(location, { method: "PUT", headers: { "Content-Type": type.startsWith("video/") ? type : "video/mp4" }, body: data, cache: "no-store" });
    if (!put.ok) throw await apiError(put);
    const video = (await put.json()) as { id?: string };
    if (!video.id) throw new PublishError("YouTube recibió el video pero no devolvió su número.");
    const shorts = /#shorts/i.test(`${meta.snippet.title} ${meta.snippet.description}`);
    return {
      url: shorts ? `https://www.youtube.com/shorts/${video.id}` : `https://youtu.be/${video.id}`,
      detail: `Subido a YouTube${shorts ? " como Short" : ""}; YouTube lo procesa en unos minutos. Id ${video.id}`,
    };
  },
  async test(creds) {
    const token = await accessToken(creds);
    let r: { items?: { id: string; snippet?: { title?: string } }[] };
    try {
      r = await fetchJson(`${API}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      // Un permiso solo para subir videos no deja leer el nombre del canal: igual sirve para publicar.
      if (/^403\b/.test((e as Error).message)) return "Conectado: tiene permiso para subir videos";
      throw e;
    }
    const ch = r.items?.[0];
    if (!ch) throw new PublishError("Esa cuenta de Google no tiene canal de YouTube. Créalo en youtube.com y vuelve a conectar.");
    return `Conectado al canal ${ch.snippet?.title ?? ch.id}`;
  },
};
