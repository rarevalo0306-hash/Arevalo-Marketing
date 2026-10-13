// YouTube: sube el video al canal del negocio con la API de datos (videos.insert, subida reanudable).
// - Solo sube lo que aprobó una persona para ese video (input.youtube): título, descripción, etiquetas, privacidad
//   (público, no listado o privado) y si es para niños. Sin aprobación no hace nada (ni pide el token).
// - Los verticales cortos se ven como Shorts (YouTube los reconoce solo; el título y la descripción llevan #Shorts).
// Permisos: youtube.upload y youtube.readonly. La conexión guarda el refreshToken (y clientId/clientSecret solo si se pegó a mano con un cliente propio, ver googleClient).
import { fetchMedia } from "@/lib/media";
import { cleanYoutubeDescription, PRIVACY_LABEL, YT_CATEGORY_ID, YOUTUBE_NEEDS_APPROVAL, youtubeTags, youtubeTitleFor, type YoutubeApproval } from "@/lib/youtube-options";
import { googleAccessToken } from "./google";
import { fetchJson, PublishError } from "./http";
import type { PublishInput, Publisher } from "./types";

const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
/** 22 = «Gente y blogs» (la categoría más general). Es la que dice la pantalla de aprobación: siempre la misma. */
const CATEGORY = () => YT_CATEGORY_ID;

// Las sugerencias viven en youtube-options (sin fs: también las usan las pantallas).
export { youtubeTags };

/** Lo que se sugiere para YouTube (la persona lo ve, lo cambia y lo aprueba): título, descripción y etiquetas. */
export function youtubeMetadata(input: Pick<PublishInput, "text" | "seoTitle" | "businessName" | "keywords">) {
  return {
    snippet: { title: youtubeTitleFor(input), description: cleanYoutubeDescription(input.text), tags: youtubeTags(input.text, input.keywords ?? []), categoryId: CATEGORY() },
  };
}

/** Lo que se manda a YouTube: exactamente lo que aprobó la persona. */
export function youtubeUploadBody(a: YoutubeApproval) {
  return {
    snippet: { title: a.title, description: a.description, tags: a.tags, categoryId: CATEGORY() },
    status: { privacyStatus: a.privacy, selfDeclaredMadeForKids: a.madeForKids, embeddable: true },
  };
}

/** El primer paso de la subida reanudable: pide la dirección donde se sube el archivo. */
export function uploadInitRequest(meta: ReturnType<typeof youtubeUploadBody>, size: number, contentType: string, token: string): { url: string; init: RequestInit } {
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
    // Nunca se sube nada que una persona no haya aprobado (antes de pedir el token o tocar la red).
    if (!input.youtube) throw new PublishError(YOUTUBE_NEEDS_APPROVAL);
    const approval = input.youtube;
    const token = await googleAccessToken(creds);
    // Solo archivos propios o direcciones públicas de internet (también en cada redirección): nunca la red interna.
    const file = await fetchMedia(input.mediaUrl, { cache: "no-store" });
    if (!file.ok) throw new PublishError(`No se pudo leer el video para subirlo (${file.status}).`);
    const data = new Uint8Array(await file.arrayBuffer());
    const type = (file.headers.get("content-type") || "video/mp4").split(";")[0].trim();
    const meta = youtubeUploadBody(approval);
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
      detail: `Subido a YouTube como ${PRIVACY_LABEL[approval.privacy].es.toLowerCase()}${shorts ? " (Short)" : ""}; YouTube lo procesa en unos minutos. Id ${video.id}`,
      id: video.id,
    };
  },
  async test(creds) {
    const token = await googleAccessToken(creds);
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
