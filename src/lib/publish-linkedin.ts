// LinkedIn: publica con la Posts API (/rest/posts), en el perfil de la persona (w_member_social)
// o en la página de una empresa (w_organization_social, requiere que LinkedIn apruebe la app).
// El token se genera a mano en el portal de desarrolladores y dura 60 días.
import { PublishError, required } from "@/lib/publishers/http";
import type { Creds, PublishInput, Publisher } from "@/lib/publishers/types";

const API = "https://api.linkedin.com";
/** Versión de la API de LinkedIn (AAAAMM). LinkedIn mantiene cada versión un año; actualizarla de vez en cuando. */
export const LINKEDIN_VERSION = "202609";

function headers(token: string, json = true): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": LINKEDIN_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

/** Convierte los errores de LinkedIn en mensajes claros (los de token incluyen la palabra "token" para avisar que hay que reconectar). */
async function linkedinFetch(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  if (res.ok) return res;
  const raw = await res.text();
  let msg = raw.slice(0, 300);
  try {
    const body = JSON.parse(raw) as { message?: string; serviceErrorCode?: number };
    if (body.message) msg = body.message;
  } catch {
    // respuesta que no es JSON
  }
  if (res.status === 401) throw new PublishError(`401: LinkedIn rechazó el token (venció o se revocó). Genera un token nuevo y vuelve a conectar. (${msg})`);
  if (res.status === 403) throw new PublishError(`403: Forbidden — el token no tiene permiso para publicar aquí (falta w_member_social o w_organization_social). Vuelve a conectar con ese permiso. (${msg})`);
  throw new PublishError(`${res.status}: ${msg || "sin detalle"}`);
}

/**
 * Los caracteres especiales del formato "little" de LinkedIn se escapan con "\" (si no, LinkedIn corta el texto).
 * El # se deja tal cual para que los hashtags funcionen.
 */
export function escapeLinkedinText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>*_~]/g, (c) => `\\${c}`);
}

type UserInfo = { sub: string; name?: string; email?: string };

async function userInfo(token: string): Promise<UserInfo> {
  const res = await linkedinFetch(`${API}/v2/userinfo`, { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json()) as UserInfo;
}

/** Quién publica: la empresa o persona escrita en "Publicar como", o el dueño del token. */
export async function linkedinAuthor(creds: Creds): Promise<string> {
  const author = creds.author?.trim() ?? "";
  if (author) {
    if (/^urn:li:(person|organization):[\w-]+$/.test(author)) return author;
    if (/^\d+$/.test(author)) return `urn:li:organization:${author}`;
    throw new PublishError("«Publicar como» debe quedar vacío (tu perfil) o ser urn:li:organization:NÚMERO (tu empresa).");
  }
  try {
    return `urn:li:person:${(await userInfo(creds.accessToken)).sub}`;
  } catch (e) {
    throw new PublishError(
      `No se pudo saber de quién es el token: genéralo con los permisos openid y profile además de w_member_social. (${(e as Error).message})`,
    );
  }
}

async function download(url: string): Promise<{ data: ArrayBuffer; type: string }> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new PublishError(`No se pudo descargar el archivo para LinkedIn (${res.status}).`);
  return { data: await res.arrayBuffer(), type: (res.headers.get("content-type") || "").split(";")[0] };
}

async function uploadImage(token: string, owner: string, mediaUrl: string): Promise<string> {
  const init = await linkedinFetch(`${API}/rest/images?action=initializeUpload`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  const { value } = (await init.json()) as { value: { uploadUrl: string; image: string } };
  const file = await download(mediaUrl);
  await linkedinFetch(value.uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type || "application/octet-stream" },
    body: file.data,
  });
  return value.image;
}

async function uploadVideo(token: string, owner: string, mediaUrl: string): Promise<string> {
  const file = await download(mediaUrl);
  const bytes = new Uint8Array(file.data);
  const init = await linkedinFetch(`${API}/rest/videos?action=initializeUpload`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: bytes.byteLength, uploadCaptions: false, uploadThumbnail: false } }),
  });
  const { value } = (await init.json()) as {
    value: { video: string; uploadToken: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] };
  };
  // LinkedIn reparte el video en partes de ~4 MB; cada parte devuelve un ETag que se manda al final.
  const etags: string[] = [];
  for (const part of value.uploadInstructions) {
    const res = await linkedinFetch(part.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes.slice(part.firstByte, part.lastByte + 1),
    });
    etags.push((res.headers.get("etag") ?? "").replace(/^"|"$/g, ""));
  }
  await linkedinFetch(`${API}/rest/videos?action=finalizeUpload`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ finalizeUploadRequest: { video: value.video, uploadToken: value.uploadToken ?? "", uploadedPartIds: etags } }),
  });
  return value.video;
}

/** El cuerpo de la publicación para /rest/posts. */
export function linkedinPostBody(author: string, text: string, media?: { id: string; title?: string }) {
  return {
    author,
    commentary: escapeLinkedinText(text),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    ...(media ? { content: { media } } : {}),
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
}

async function publish(input: PublishInput, creds: Creds) {
  required(creds, ["accessToken"]);
  const token = creds.accessToken.trim();
  const author = await linkedinAuthor(creds);
  let media: { id: string; title?: string } | undefined;
  if (input.mediaUrl && input.mediaType === "photo") media = { id: await uploadImage(token, author, input.mediaUrl) };
  if (input.mediaUrl && input.mediaType === "video") media = { id: await uploadVideo(token, author, input.mediaUrl), title: input.businessName };
  const res = await linkedinFetch(`${API}/rest/posts`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(linkedinPostBody(author, input.text.slice(0, 3000), media)),
  });
  const id = res.headers.get("x-restli-id") ?? "";
  return {
    url: id ? `https://www.linkedin.com/feed/update/${id}/` : undefined,
    detail: media?.id.startsWith("urn:li:video:") ? "Publicado en LinkedIn (el video tarda unos minutos en procesarse)" : "Publicado en LinkedIn",
  };
}

export const linkedin: Publisher = {
  publish,
  async test(creds) {
    required(creds, ["accessToken"]);
    const author = creds.author?.trim();
    if (author) {
      const urn = await linkedinAuthor(creds);
      return `Token guardado: se publicará como ${urn}. Si LinkedIn no aprobó tu app para empresas, la primera publicación fallará.`;
    }
    const me = await userInfo(creds.accessToken.trim()).catch((e: Error) => {
      // 401: el mensaje ya dice qué hacer. Otros (403…): falta pedir los permisos para saber quién eres.
      if (/^401/.test(e.message)) throw e;
      throw new PublishError(`No se pudo comprobar el token: ${e.message}. Genéralo con los permisos openid, profile y w_member_social.`);
    });
    return `Conectado como ${me.name || me.email || me.sub}. Recuerda: el token vence a los 60 días.`;
  },
};
