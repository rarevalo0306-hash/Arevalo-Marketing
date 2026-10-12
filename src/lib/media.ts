import { randomBytes } from "crypto";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import { bi } from "@/lib/i18n";
import { isPublicHttpsUrl } from "@/lib/net-guard";

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

/**
 * Nombres que se sirven desde /media/…: 24 letras hex ("a1b2….jpg") o, para las fotos que se publican, un nombre
 * con palabras clave para Google ("portones-enrollables-managua-a1b2c3d4e5f6.jpg": palabras + 12 hex).
 */
export const SAFE_MEDIA_NAME = /^(?:[a-f0-9]{24}|[a-z0-9]{1,30}(?:-[a-z0-9]{1,30}){0,9}-[a-f0-9]{12})\.(jpg|png|webp|gif|mp4|mov|webm)$/;

function supabase() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export const usesSupabaseStorage = () => supabase() !== null;

// Documentos que se guardan como referencia (por ejemplo, el manual de marca). No se publican.
const DOC_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function newName(contentType: string, kind: "media" | "document" = "media"): string {
  if (kind === "document") {
    const ext = DOC_TYPES[contentType];
    if (!ext) throw bi("Formato no permitido. Usa PDF, JPG, PNG o WEBP.", "File type not allowed. Use PDF, JPG, PNG or WEBP.");
    return `${randomBytes(12).toString("hex")}.${ext}`;
  }
  const ext = TYPES[contentType];
  if (!ext) throw bi("Formato no permitido. Usa JPG, PNG, WEBP, GIF, MP4, MOV o WEBM.", "File type not allowed. Use JPG, PNG, WEBP, GIF, MP4, MOV or WEBM.");
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
    if (!created.ok && created.status !== 409) throw bi(`No se pudo crear el bucket "${BUCKET}" en Supabase: ${await created.text()}`, `Couldn't create the "${BUCKET}" bucket in Supabase: ${await created.text()}`);
  } else if (!res.ok) {
    throw bi(`No se pudo leer el bucket "${BUCKET}" en Supabase: ${await res.text()}`, `Couldn't read the "${BUCKET}" bucket in Supabase: ${await res.text()}`);
  }
  bucketReady = true;
}

/**
 * Dirección temporal para que el navegador suba el archivo directo a Supabase
 * (sin pasar por el servidor, que en Vercel tiene un límite de 4.5 MB por petición).
 */
export async function createSignedUpload(contentType: string, folder: string, kind: "media" | "document" = "media"): Promise<{ uploadUrl: string; publicUrl: string }> {
  const sb = supabase();
  if (!sb) throw bi("Supabase Storage no está configurado.", "Supabase Storage isn't set up.");
  await ensureBucket(sb);
  const objectPath = `${folder}/${newName(contentType, kind)}`;
  const res = await fetch(`${sb.url}/storage/v1/object/upload/sign/${BUCKET}/${objectPath}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sb.key}`, apikey: sb.key },
  });
  if (!res.ok) throw bi(`Supabase no dio permiso para subir: ${await res.text()}`, `Supabase didn't allow the upload: ${await res.text()}`);
  const { url } = (await res.json()) as { url: string };
  return {
    uploadUrl: `${sb.url}/storage/v1${url}`,
    publicUrl: `${sb.url}/storage/v1/object/public/${BUCKET}/${objectPath}`,
  };
}

/** true si la dirección es un archivo de la carpeta del negocio en tu almacenamiento. */
export function isOwnFile(url: string, folder: string): boolean {
  const sb = supabase();
  if (!sb) return false;
  const prefix = `${sb.url}/storage/v1/object/public/${BUCKET}/${folder}/`;
  // Sin "..", ni escrito como %2e / %2f / %5c, ni barra invertida: fetch y el navegador los convierten y la dirección
  // saldría a la carpeta de otro negocio.
  return url.startsWith(prefix) && !url.includes("..") && !/%2e|%2f|%5c|\\/i.test(url.slice(prefix.length));
}

/**
 * Copia a tu almacenamiento un archivo creado por la IA (las URLs de fal.ai son temporales).
 * Devuelve la dirección pública para guardar en la publicación.
 */
export async function storeRemote(sourceUrl: string, folder: string, headers?: Record<string, string>): Promise<{ url: string; type: "photo" | "video" }> {
  const res = await fetch(sourceUrl, headers ? { headers } : undefined);
  if (!res.ok) throw bi(`No se pudo descargar el archivo creado por la IA (${res.status}).`, `Couldn't download the file the AI created (${res.status}).`);
  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim() || (sourceUrl.endsWith(".mp4") ? "video/mp4" : "image/jpeg");
  return storeBuffer(Buffer.from(await res.arrayBuffer()), contentType, folder);
}

/** Guarda un archivo (por ejemplo una imagen que la IA devolvió directamente) en tu almacenamiento. */
export async function storeBuffer(data: Buffer, contentType: string, folder: string, fixedName?: string): Promise<{ url: string; type: "photo" | "video" }> {
  const name = fixedName ?? newName(contentType);
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
    headers: { Authorization: `Bearer ${sb.key}`, apikey: sb.key, "Content-Type": contentType, ...(fixedName ? { "x-upsert": "true" } : {}) },
    body: new Uint8Array(data),
  });
  if (!up.ok) throw bi(`No se pudo guardar el archivo en Supabase: ${await up.text()}`, `Couldn't save the file in Supabase: ${await up.text()}`);
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

// ---------- Copias por canal y datos del diseño ----------

/**
 * Nombre con palabras clave (SEO) para una foto que se publica: "portones-enrollables-managua-a1b2c3d4e5f6.jpg".
 * `slug` ya viene limpio (seoSlug en src/lib/post-keywords.ts); `hex` fija el nombre (si no, uno al azar).
 * Sin palabras, el nombre de siempre (24 hex).
 */
export function seoMediaName(slug: string, ext: "jpg" | "png" | "webp", hex?: string): string {
  const clean = slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").split("-").filter(Boolean).slice(0, 9).map((w) => w.slice(0, 30)).join("-").slice(0, 60).replace(/-$/, "");
  const id = (hex && /^[a-f0-9]{12,}$/.test(hex) ? hex : randomBytes(12).toString("hex"));
  return clean ? `${clean}-${id.slice(0, 12)}.${ext}` : `${id.slice(0, 24).padEnd(24, "0")}.${ext}`;
}

/** Nombre fijo (24 letras hex + extensión) para una copia, así no se vuelve a crear si ya existe. */
export const fixedMediaName = (hex24: string, ext: "jpg" | "png") => `${hex24.slice(0, 24)}.${ext}`;

/** Dirección pública de un archivo con nombre fijo en la carpeta del negocio. */
export function mediaUrlFor(folder: string, name: string): string {
  const sb = supabase();
  return sb ? `${sb.url}/storage/v1/object/public/${BUCKET}/${folder}/${name}` : `/media/${name}`;
}

/** true si ya existe un archivo con ese nombre fijo. */
export async function mediaExists(folder: string, name: string): Promise<boolean> {
  const sb = supabase();
  if (!sb) return stat(path.join(UPLOAD_DIR, name)).then(() => true, () => false);
  const res = await fetch(mediaUrlFor(folder, name), { method: "HEAD" }).catch(() => null);
  return Boolean(res?.ok);
}

/** Lee un archivo guardado (local /media/… o una dirección https). */
export async function readMedia(stored: string): Promise<Buffer> {
  const local = /^\/media\/([^/]+)$/.exec(stored);
  if (local && SAFE_MEDIA_NAME.test(local[1])) return readFile(path.join(UPLOAD_DIR, local[1]));
  if (!/^https:\/\//i.test(stored)) throw bi("La foto necesita una dirección pública.", "The photo needs a public web address.");
  // Solo direcciones públicas de internet, también en cada redirección (como mucho 3): nunca la red interna.
  let url = stored;
  for (let hops = 0; ; hops++) {
    if (!(await isPublicHttpsUrl(url))) throw bi("La foto no está en una dirección pública de internet.", "The photo isn't at a public web address.");
    const res = await fetch(url, { redirect: "manual" });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) {
      if (!res.ok) throw bi(`No se pudo descargar la foto (${res.status}).`, `Couldn't download the photo (${res.status}).`);
      return Buffer.from(await res.arrayBuffer());
    }
    res.body?.cancel().catch(() => undefined);
    if (hops >= 3) throw bi("No se pudo descargar la foto: redirige demasiadas veces.", "Couldn't download the photo: too many redirects.");
    url = URL.canParse(next, url) ? new URL(next, url).href : "";
  }
}

/**
 * Nota que acompaña a una foto guardada (mismo nombre + ".json"): cómo se hizo, para poder volver
 * a dibujar el diseño en el tamaño de cada red. Solo para archivos de tu almacenamiento.
 */
function sidecarPlace(stored: string): { local: string } | { url: string; objectPath: string } | null {
  const local = /^\/media\/([^/]+)\.(jpg|png|webp)$/.exec(stored);
  if (local && SAFE_MEDIA_NAME.test(`${local[1]}.${local[2]}`)) return { local: path.join(UPLOAD_DIR, `${local[1]}.json`) };
  const sb = supabase();
  const prefix = sb ? `${sb.url}/storage/v1/object/public/${BUCKET}/` : "";
  if (!sb || !stored.startsWith(prefix) || stored.includes("..")) return null;
  const objectPath = stored.slice(prefix.length).replace(/\.(jpg|png|webp)$/, ".json");
  if (!objectPath.endsWith(".json")) return null;
  return { url: `${prefix}${objectPath}`, objectPath };
}

export async function writeSidecar(stored: string, data: unknown): Promise<void> {
  const place = sidecarPlace(stored);
  if (!place) return;
  const body = Buffer.from(JSON.stringify(data));
  if ("local" in place) {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(place.local, body);
    return;
  }
  const sb = supabase()!;
  await fetch(`${sb.url}/storage/v1/object/${BUCKET}/${place.objectPath}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sb.key}`, apikey: sb.key, "Content-Type": "application/json", "x-upsert": "true" },
    body: new Uint8Array(body),
  });
}

export async function readSidecar(stored: string): Promise<unknown> {
  const place = sidecarPlace(stored);
  if (!place) return null;
  try {
    if ("local" in place) return JSON.parse(await readFile(place.local, "utf8"));
    const res = await fetch(place.url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Remove only this business's folder, including derived images, JSON sidecars and documents. */
export async function deleteBusinessMedia(businessId: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]+$/.test(businessId)) throw new Error('Invalid business ID');
  const sb = supabase();
  if (!sb) throw bi('No se puede confirmar el borrado de archivos: configura Supabase Storage antes de eliminar el negocio.', 'File deletion cannot be verified: configure Supabase Storage before deleting the business.');
  const headers = { Authorization: `Bearer ${sb.key}`, apikey: sb.key, 'Content-Type': 'application/json' };
  const root = `${businessId}/`;
  const pending = [businessId];
  const files: string[] = [];
  for (let index = 0; index < pending.length; index++) {
    const folder = pending[index];
    for (let offset = 0; ; offset += 1000) {
      const r = await fetch(`${sb.url}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST', headers,
        body: JSON.stringify({ prefix: folder, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
      });
      if (!r.ok) throw new Error(`Storage listing failed (${r.status})`);
      const entries = await r.json() as { name: string; id?: string | null }[];
      for (const entry of entries) {
        if (!entry.name || entry.name.includes('/') || entry.name === '.' || entry.name === '..') throw new Error('Unsafe storage entry');
        const key = `${folder}/${entry.name}`;
        if (!key.startsWith(root)) throw new Error('Storage entry outside business folder');
        if (entry.id) files.push(key); else pending.push(key);
      }
      if (entries.length < 1000) break;
    }
  }
  for (let start = 0; start < files.length; start += 100) {
    const r = await fetch(`${sb.url}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE', headers, body: JSON.stringify({ prefixes: files.slice(start, start + 100) }),
    });
    if (!r.ok) throw new Error(`Storage deletion failed (${r.status})`);
  }
}
