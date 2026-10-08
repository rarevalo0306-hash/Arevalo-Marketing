// Link de subida para los técnicos: qué archivos se aceptan y cuánto pueden pesar. Sin servidor ni base de datos:
// lo usan la página /subir (navegador), las rutas /api/subir y las pruebas.

/** Fotos hasta 40 MB, videos hasta 500 MB, 30 archivos por tanda. */
export const IMAGE_MAX_BYTES = 40 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
export const MAX_FILES = 30;
/** La imagen de un video que saca el navegador (para que la IA lo mire). */
export const FRAME_MAX_BYTES = 3 * 1024 * 1024;
/** La nota «¿Qué trabajo es?». */
export const NOTE_MAX = 120;

export const UPLOAD_TYPES = {
  "image/jpeg": { ext: "jpg", kind: "photo" },
  "image/png": { ext: "png", kind: "photo" },
  "image/webp": { ext: "webp", kind: "photo" },
  "image/heic": { ext: "heic", kind: "photo" },
  "image/heif": { ext: "heif", kind: "photo" },
  "video/mp4": { ext: "mp4", kind: "video" },
  "video/quicktime": { ext: "mov", kind: "video" },
  "video/webm": { ext: "webm", kind: "video" },
} as const;
export type UploadType = keyof typeof UPLOAD_TYPES;

/** Extensiones que puede tener la llave de un archivo subido (la imagen de un video es .jpg). */
export const UPLOAD_EXTS = [...new Set(Object.values(UPLOAD_TYPES).map((x) => x.ext))];

const BY_EXT: Record<string, UploadType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  qt: "video/quicktime",
  webm: "video/webm",
};

/** El tipo del archivo: el que dice el navegador, o por la extensión (algunos celulares no lo dicen). null si no se acepta. */
export function uploadType(type: string, name: string): UploadType | null {
  const t = (type || "").toLowerCase().split(";")[0].trim();
  if (t === "image/jpg") return "image/jpeg";
  if (t === "video/x-m4v") return "video/mp4";
  if (t in UPLOAD_TYPES) return t as UploadType;
  if (t && t !== "application/octet-stream") return null;
  const ext = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  return BY_EXT[ext] ?? null;
}

export const fmtMB = (bytes: number) => {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.max(0.1, Math.round(mb * 10) / 10)} MB`;
};

export type FileCheck =
  | { ok: true; type: UploadType; ext: string; kind: "photo" | "video" }
  | { ok: false; es: string; en: string };

/** ¿Se puede subir este archivo? (tipo y tamaño). */
export function checkUploadFile(f: { name: string; type: string; size: number }): FileCheck {
  const type = uploadType(f.type, f.name);
  if (!type)
    return {
      ok: false,
      es: "Ese tipo de archivo no se puede subir. Sube fotos (JPG, PNG, WEBP, HEIC) o videos (MP4, MOV, WEBM).",
      en: "That kind of file can't be uploaded. Upload photos (JPG, PNG, WEBP, HEIC) or videos (MP4, MOV, WEBM).",
    };
  const { ext, kind } = UPLOAD_TYPES[type];
  const size = Number(f.size);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, es: "El archivo está vacío.", en: "The file is empty." };
  if (kind === "photo" && size > IMAGE_MAX_BYTES)
    return { ok: false, es: `La foto pesa ${fmtMB(size)}; el máximo es 40 MB.`, en: `The photo is ${fmtMB(size)}; the limit is 40 MB.` };
  if (kind === "video" && size > VIDEO_MAX_BYTES)
    return {
      ok: false,
      es: `El video pesa ${fmtMB(size)}; el máximo es 500 MB. Graba uno más corto.`,
      en: `The video is ${fmtMB(size)}; the limit is 500 MB. Record a shorter one.`,
    };
  return { ok: true, type, ext, kind };
}

/** La nota del técnico, limpia y corta. */
export const cleanNote = (s: unknown) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NOTE_MAX);

/** El nombre del archivo, limpio y corto. */
export const cleanName = (s: unknown) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

/** El link de subida: 32 letras y números (o - _). */
export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

/** Idioma de la página de subida según el navegador (Accept-Language): inglés si lo prefiere antes que el español. */
export function langFromAcceptLanguage(header: string | null | undefined): "es" | "en" {
  const prefs = String(header ?? "")
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().toLowerCase().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.trim().slice(2) ?? 1);
      return { lang: tag.split("-")[0], q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((p) => (p.lang === "es" || p.lang === "en") && p.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return prefs[0]?.lang === "en" ? "en" : "es";
}
