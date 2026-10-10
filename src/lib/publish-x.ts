// X (antes Twitter): publica con la API v2 (POST /2/tweets) firmando con OAuth 1.0a (claves de usuario
// que se generan en console.x.com y no vencen). Fotos con POST /2/media/upload; videos por partes
// (initialize → append → finalize → status). X cobra por uso (pay-per-use): hay que tener créditos.
import { createHmac, randomBytes } from "node:crypto";
import { PublishError, required, sleep } from "@/lib/publishers/http";
import { mediaOf, type Creds, type PublishInput, type Publisher } from "@/lib/publishers/types";

const API = "https://api.x.com";
const KEYS = ["apiKey", "apiSecret", "accessToken", "accessSecret"];

/** Codificación de OAuth 1.0a (RFC 3986): más estricta que encodeURIComponent. */
export function oauthEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Encabezado Authorization de OAuth 1.0a (HMAC-SHA1). Solo se firman los parámetros de la URL:
 * los cuerpos JSON o multipart no entran en la firma.
 */
export function oauthHeader(
  method: string,
  url: string,
  creds: Creds,
  extraParams: Record<string, string> = {},
  fixed?: { nonce: string; timestamp: string },
): string {
  const u = new URL(url);
  const params: Record<string, string> = { ...extraParams };
  u.searchParams.forEach((v, k) => (params[k] = v));
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: fixed?.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: fixed?.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const all = { ...params, ...oauth };
  const paramString = Object.keys(all)
    .map((k) => [oauthEncode(k), oauthEncode(all[k])] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = `${method.toUpperCase()}&${oauthEncode(`${u.origin}${u.pathname}`)}&${oauthEncode(paramString)}`;
  const key = `${oauthEncode(creds.apiSecret)}&${oauthEncode(creds.accessSecret)}`;
  const signature = createHmac("sha1", key).update(base).digest("base64");
  return (
    "OAuth " +
    Object.entries({ ...oauth, oauth_signature: signature })
      .map(([k, v]) => `${oauthEncode(k)}="${oauthEncode(v)}"`)
      .join(", ")
  );
}

function clean(creds: Creds): Creds {
  required(creds, KEYS);
  return Object.fromEntries(KEYS.map((k) => [k, creds[k].trim()]));
}

/** Llama a la API de X con la firma OAuth y convierte los errores en mensajes claros. */
async function xFetch<T>(method: "GET" | "POST", url: string, creds: Creds, body?: BodyInit, json = false): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: oauthHeader(method, url, creds), ...(json ? { "Content-Type": "application/json" } : {}) },
    body,
    cache: "no-store",
  });
  const raw = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    // respuesta que no es JSON
  }
  if (!res.ok) {
    const errors = parsed.errors as { message?: string }[] | undefined;
    const msg = String(parsed.detail ?? errors?.[0]?.message ?? parsed.title ?? raw.slice(0, 300) ?? "sin detalle");
    if (res.status === 401) throw new PublishError(`401: X rechazó las claves (token inválido o revocado). Vuelve a generarlas y conéctalo otra vez. (${msg})`);
    if (res.status === 402 || /credit/i.test(msg)) throw new PublishError(`${res.status}: tu cuenta de desarrollador de X no tiene créditos. Carga créditos en console.x.com. (${msg})`);
    if (res.status === 403 && /duplicate/i.test(msg)) throw new PublishError(`403: X no deja publicar exactamente el mismo texto dos veces. Cambia un poco el mensaje. (${msg})`);
    if (res.status === 403)
      throw new PublishError(`403: Forbidden — X no dio permiso para publicar. Revisa que la app tenga «Read and write» y genera de nuevo el Access Token. (${msg})`);
    if (res.status === 429) throw new PublishError(`429: X dice que publicaste demasiado seguido. Inténtalo más tarde. (${msg})`);
    throw new PublishError(`${res.status}: ${msg}`);
  }
  return parsed as T;
}

async function download(url: string): Promise<{ data: Blob; type: string; size: number }> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new PublishError(`No se pudo descargar el archivo para X (${res.status}).`);
  const data = await res.blob();
  return { data, type: (res.headers.get("content-type") || data.type || "").split(";")[0], size: data.size };
}

type MediaData = { data: { id: string; processing_info?: { state: string; check_after_secs?: number; error?: { message?: string } } } };

async function uploadPhoto(creds: Creds, mediaUrl: string, alt?: string): Promise<string> {
  const file = await download(mediaUrl);
  const body = new FormData();
  body.set("media", file.data, "image");
  body.set("media_category", "tweet_image");
  const r = await xFetch<MediaData>("POST", `${API}/2/media/upload`, creds, body);
  if (alt) {
    // Texto alternativo (POST /2/media/metadata). Es opcional: si X no lo acepta, la foto se publica igual.
    await xFetch("POST", `${API}/2/media/metadata`, creds, JSON.stringify({ id: r.data.id, metadata: { alt_text: { text: alt.slice(0, 1000) } } }), true).catch(() => undefined);
  }
  return r.data.id;
}

/** X acepta hasta 4 fotos (o 1 video) por publicación. */
export const X_MAX_PHOTOS = 4;

async function uploadVideo(creds: Creds, mediaUrl: string): Promise<string> {
  const file = await download(mediaUrl);
  const init = await xFetch<MediaData>(
    "POST",
    `${API}/2/media/upload/initialize`,
    creds,
    JSON.stringify({ media_type: file.type || "video/mp4", total_bytes: file.size, media_category: "tweet_video" }),
    true,
  );
  const id = init.data.id;
  const CHUNK = 4 * 1024 * 1024;
  for (let i = 0, part = 0; i < file.size; i += CHUNK, part++) {
    const body = new FormData();
    body.set("segment_index", String(part));
    body.set("media", file.data.slice(i, i + CHUNK), "chunk");
    await xFetch("POST", `${API}/2/media/upload/${id}/append`, creds, body);
  }
  let info = (await xFetch<MediaData>("POST", `${API}/2/media/upload/${id}/finalize`, creds)).data.processing_info;
  // X procesa el video antes de poder usarlo en una publicación.
  for (let i = 0; info && info.state !== "succeeded" && i < 30; i++) {
    if (info.state === "failed") throw new PublishError(`X no pudo procesar el video: ${info.error?.message ?? "formato no válido"}.`);
    await sleep(Math.min(info.check_after_secs ?? 3, 10) * 1000);
    info = (await xFetch<MediaData>("GET", `${API}/2/media/upload?command=STATUS&media_id=${id}`, creds)).data.processing_info;
  }
  if (info && info.state !== "succeeded") throw new PublishError("X tardó demasiado en procesar el video. Inténtalo de nuevo en unos minutos.");
  return id;
}

async function publish(input: PublishInput, rawCreds: Creds) {
  const creds = clean(rawCreds);
  const files = mediaOf(input);
  const ids: string[] = [];
  if (files[0]?.type === "video") ids.push(await uploadVideo(creds, files[0].url));
  else {
    const photos = files.filter((m) => m.type === "photo").slice(0, input.kind === "carousel" ? X_MAX_PHOTOS : 1);
    for (const p of photos) ids.push(await uploadPhoto(creds, p.url, p.alt));
  }
  const r = await xFetch<{ data: { id: string } }>(
    "POST",
    `${API}/2/tweets`,
    creds,
    JSON.stringify({ text: input.text, ...(ids.length ? { media: { media_ids: ids } } : {}) }),
    true,
  );
  const extra = files.filter((m) => m.type === "photo").length - X_MAX_PHOTOS;
  const detail = ids.length > 1 ? `Publicado en X con ${ids.length} fotos${extra > 0 ? ` (X acepta hasta ${X_MAX_PHOTOS}; las otras ${extra} no se enviaron)` : ""}` : "Publicado en X";
  return { url: `https://x.com/i/web/status/${r.data.id}`, detail, id: r.data.id };
}

export const x: Publisher = {
  publish,
  async test(rawCreds) {
    const creds = clean(rawCreds);
    const me = await xFetch<{ data: { username: string; name: string } }>("GET", `${API}/2/users/me`, creds);
    return `Conectado como @${me.data.username}`;
  },
};
