import { randomBytes } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "uploads");

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

/** Guarda un archivo subido y devuelve su ruta pública relativa (/media/…). */
export async function saveUpload(file: File): Promise<{ path: string; type: "photo" | "video" }> {
  const ext = TYPES[file.type];
  if (!ext) throw new Error("Formato no permitido. Usa JPG, PNG, WEBP, GIF, MP4, MOV o WEBM.");
  await mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${randomBytes(12).toString("hex")}.${ext}`;
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
