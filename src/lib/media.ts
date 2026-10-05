import { randomBytes } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

// Las fotos y videos van a Supabase Storage (bucket público). Sin Supabase configurado,
// se guardan en el disco del servidor (útil solo en tu computadora).

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "uploads");
const BUCKET = process.env.SUPABASE_MEDIA_BUCKET || "media";

const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export const MEDIA_CONTENT_TYPES: Record<string, string> = Object.fromEntries(
  Object.entries(TYPES).map(([type, ext]) => [ext, type]),
);

export const SAFE_MEDIA_NAME = /^[a-f0-9]{24}\.(jpg|png|webp|gif|mp4|mov|webm)$/;

function supabase() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export const usesSupabaseStorage = () => supabase() !== null;

function newName(contentType: string): string {
  const ext = TYPES[contentType];
  if (!ext) throw new Error("Formato no permitido. Usa JPG, PNG, WEBP, GIF, MP4, MOV o WEBM.");
  return `${randomBytes(12).toString("hex")}.${ext}`;
}

let bucketReady = false;
async function ensureBucket(sb: { url: string; key: string }) {
  if (bucketReady) return;
  const headers = { Authorization: `Bearer ${sb.key}`, apikey: sb.key, "Content-Type": "application/json" };
  const res = await fetch(`${sb.url}/storage/v1/bucket/${BUCKET}`, { headers });
  if (res.status === 404 || res.status === 400) {
    const created = await fetch(`${sb.url}/storage/v1/bucket`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
    });
    if (!created.ok && created.status !== 409) throw new Error(`No se pudo crear el bucket "${BUCKET}" en Supabase: ${await created.text()}`);
  } else if (!res.ok) {
    throw new Error(`No se pudo leer el bucket "${BUCKET}" en Supabase: ${await res.text()}`);
  }
  bucketReady = true;
}

/**
 * Dirección temporal para que el navegador suba el archivo directo a Supabase
 * (sin pasar por el servidor, que en Vercel tiene un límite de 4.5 MB por petición).
 */
export async function createSignedUpload(contentType: string, folder: string): Promise<{ uploadUrl: string; publicUrl: string }> {
  const sb = supabase();
  if (!sb) throw new Error("Supabase Storage no está configurado.");
  await ensureBucket(sb);
  const objectPath = `${folder}/${newName(contentType)}`;
  const res = await fetch(`${sb.url}/storage/v1/object/upload/sign/${BUCKET}/${objectPath}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sb.key}`, apikey: sb.key },
  });
  if (!res.ok) throw new Error(`Supabase no dio permiso para subir: ${await res.text()}`);
  const { url } = (await res.json()) as { url: string };
  return {
    uploadUrl: `${sb.url}/storage/v1${url}`,
    publicUrl: `${sb.url}/storage/v1/object/public/${BUCKET}/${objectPath}`,
  };
}

/**
 * Copia a tu almacenamiento un archivo creado por la IA (las URLs de fal.ai son temporales).
 * Devuelve la dirección pública para guardar en la publicación.
 */
export async function storeRemote(sourceUrl: string, folder: string): Promise<{ url: string; type: "photo" | "video" }> {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`No se pudo descargar el archivo creado por la IA (${res.status}).`);
  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim() || (sourceUrl.endsWith(".mp4") ? "video/mp4" : "image/jpeg");
  const name = newName(contentType);
  const data = Buffer.from(await res.arrayBuffer());
  const type = contentType.startsWith("video/") ? "video" : "photo";
  const sb = supabase();
  if (!sb) {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(path.join(UPLOAD_DIR, name), data);
    return { url: `/media/${name}`, type };
  }
  await ensureBucket(sb);
  const objectPath = `${folder}/${name}`;
  const up = await fetch(`${sb.url}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sb.key}`, apikey: sb.key, "Content-Type": contentType },
    body: data,
  });
  if (!up.ok) throw new Error(`No se pudo guardar el archivo en Supabase: ${await up.text()}`);
  return { url: `${sb.url}/storage/v1/object/public/${BUCKET}/${objectPath}`, type };
}

/** Sin Supabase: guarda en disco y devuelve la ruta pública relativa (/media/…). */
export async function saveUpload(file: File): Promise<{ path: string; type: "photo" | "video" }> {
  const name = newName(file.type);
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, name), Buffer.from(await file.arrayBuffer()));
  return { path: `/media/${name}`, type: file.type.startsWith("video/") ? "video" : "photo" };
}

/** Las redes necesitan una URL absoluta y pública para descargar el archivo. */
export function publicMediaUrl(stored: string): string {
  if (!stored) return "";
  if (/^https?:\/\//i.test(stored)) return stored;
  const base = (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  return base + stored;
}
