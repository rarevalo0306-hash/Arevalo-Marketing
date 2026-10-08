// Link de subida para los técnicos (/subir/<token>): revisar el link, limitar abusos, dar la dirección para subir
// directo a Cloudflare R2 y, cuando el archivo llegó, guardarlo en la biblioteca para que la IA lo mire.
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { BiError } from "@/lib/i18n";
import { deleteObject, headObject, isLibraryKey, newKey, presignPut, publicUrl, r2Enabled } from "@/lib/r2";
import {
  checkUploadFile,
  cleanName,
  cleanNote,
  FRAME_MAX_BYTES,
  IMAGE_MAX_BYTES,
  TOKEN_RE,
  UPLOAD_EXTS,
  UPLOAD_TYPES,
  VIDEO_MAX_BYTES,
  type UploadType,
} from "@/lib/upload-rules";

/** Error con el código HTTP para las rutas /api/subir. */
export class UploadError extends BiError {
  constructor(
    es: string,
    en: string,
    readonly status = 400,
  ) {
    super(es, en);
  }
}

// ---------- El link ----------

/** Link nuevo: 32 letras, números, - y _ (24 bytes al azar). */
export const newUploadToken = () => randomBytes(24).toString("base64url");

/** Comparación en tiempo constante (se comparan los sha256, que siempre miden lo mismo). */
export function tokenEquals(given: string, stored: string): boolean {
  if (!stored) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(stored).digest();
  return timingSafeEqual(a, b) && given.length === stored.length;
}

export type UploadBusiness = { id: string; name: string; color: string; logoUrl: string; logoLightUrl: string };

/** El negocio de ese link, o null si el link no existe (o lo cambiaron). */
export async function businessForToken(token: string): Promise<UploadBusiness | null> {
  if (!TOKEN_RE.test(token)) return null;
  const list = await db.business.findMany({
    where: { uploadToken: { not: "" } },
    select: { id: true, name: true, color: true, logoUrl: true, logoLightUrl: true, uploadToken: true },
  });
  let found: UploadBusiness | null = null;
  // Se comparan todos, sin cortar en el primero.
  for (const b of list) if (tokenEquals(token, b.uploadToken)) found = { id: b.id, name: b.name, color: b.color, logoUrl: b.logoUrl, logoLightUrl: b.logoLightUrl };
  return found;
}

// ---------- Límite de pedidos (en memoria, por link + IP) ----------

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    readonly max: number,
    readonly windowMs: number,
  ) {}

  /** true si todavía puede; cuenta el pedido. */
  take(key: string, now = Date.now()): boolean {
    const from = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 5000) this.prune(now);
    return true;
  }

  private prune(now: number) {
    const from = now - this.windowMs;
    for (const [k, list] of this.hits) if (!list.some((t) => t > from)) this.hits.delete(k);
  }
}

const TEN_MIN = 10 * 60_000;
/** Por link + IP: 30 archivos + 30 imágenes de video por tanda, con reintentos de sobra. */
const signLimit = new RateLimiter(150, TEN_MIN);
const doneLimit = new RateLimiter(150, TEN_MIN);
/** Links que no existen, por IP (para que no se puedan adivinar). */
const badLimit = new RateLimiter(20, TEN_MIN);

/** La IP de quien pide (Vercel la pone en x-forwarded-for). */
export function clientIp(h: Headers): string {
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip")?.trim() || "local";
}

const LINK_GONE = () =>
  new UploadError("Este link ya no sirve. Pídele uno nuevo a tu jefe.", "This link doesn't work anymore. Ask your boss for a new one.", 404);
const TOO_MANY = () =>
  new UploadError(
    "Demasiados intentos seguidos. Espera unos minutos y vuelve a intentar.",
    "Too many tries in a row. Wait a few minutes and try again.",
    429,
  );

/** Revisa el link y el límite de pedidos. Devuelve el negocio o lanza un UploadError. */
export async function guard(token: string, ip: string, which: "sign" | "done"): Promise<UploadBusiness> {
  const b = await businessForToken(token);
  if (!b) {
    if (!badLimit.take(`bad:${ip}`)) throw TOO_MANY();
    throw LINK_GONE();
  }
  if (!(which === "sign" ? signLimit : doneLimit).take(`${b.id}:${token.slice(0, 8)}:${ip}`)) throw TOO_MANY();
  if (!r2Enabled())
    throw new UploadError(
      "La subida de fotos todavía no está lista en la app. Avísale a tu jefe.",
      "Photo uploads aren't ready in the app yet. Let your boss know.",
      503,
    );
  return b;
}

// ---------- Firmar (antes de subir) ----------

export type SignBody = { name?: unknown; type?: unknown; size?: unknown; frame?: unknown };
export type Signed = { key: string; url: string; contentType: string };

/** La dirección para subir un archivo (o la imagen de un video, con `frame`) directo a R2. */
export function signFor(businessId: string, body: SignBody, now = new Date()): Signed {
  const size = Number(body.size);
  if (body.frame) {
    if (String(body.type) !== "image/jpeg" || !(size > 0) || size > FRAME_MAX_BYTES)
      throw new UploadError("La imagen del video no es válida.", "The video's image isn't valid.");
    const key = newKey(businessId, "jpg", now);
    return { key, url: presignPut(key, "image/jpeg", 900, now), contentType: "image/jpeg" };
  }
  const c = checkUploadFile({ name: cleanName(body.name), type: String(body.type ?? ""), size });
  if (!c.ok) throw new UploadError(c.es, c.en);
  const key = newKey(businessId, c.ext, now);
  // Una hora: un video grande desde el celular puede tardar.
  return { key, url: presignPut(key, c.type, 3600, now), contentType: c.type };
}

// ---------- Listo (el archivo ya está en R2) ----------

export type DoneBody = {
  key?: unknown;
  name?: unknown;
  note?: unknown;
  thumbKey?: unknown;
  width?: unknown;
  height?: unknown;
  durationSec?: unknown;
  lastModified?: unknown;
};

const TYPE_OF_EXT: Record<string, UploadType> = Object.fromEntries(Object.entries(UPLOAD_TYPES).map(([type, v]) => [v.ext, type as UploadType]));

const int = (v: unknown, max: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
};

/** Fecha del archivo según el celular (entre el año 2000 y ahora); si no, ahora. */
export function fileDate(v: unknown, now = new Date()): Date {
  const n = Number(v);
  return Number.isFinite(n) && n > Date.UTC(2000, 0, 1) && n <= now.getTime() + 60_000 ? new Date(Math.min(n, now.getTime())) : now;
}

/**
 * Revisa que el archivo llegó a R2 (y su tamaño) y lo guarda en la biblioteca como "new" para que la IA lo mire.
 * Si se llama dos veces con la misma llave, no se repite.
 */
export async function finishUpload(businessId: string, body: DoneBody, now = new Date()): Promise<{ id: string; kind: "photo" | "video"; created: boolean }> {
  const key = String(body.key ?? "");
  if (!isLibraryKey(key, businessId, UPLOAD_EXTS))
    throw new UploadError("No encontramos ese archivo. Vuelve a subirlo.", "We couldn't find that file. Upload it again.");
  const ext = key.slice(key.lastIndexOf(".") + 1);
  const type = TYPE_OF_EXT[ext];
  const kind = UPLOAD_TYPES[type].kind;

  const existing = await db.libraryItem.findUnique({ where: { businessId_externalId: { businessId, externalId: key } }, select: { id: true } });
  if (existing) return { id: existing.id, kind, created: false };

  const head = await headObject(key);
  if (!head) throw new UploadError("El archivo no llegó completo. Vuelve a intentar.", "The file didn't arrive complete. Try again.", 409);
  const max = kind === "video" ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
  if (head.size > max || head.size <= 0) {
    await deleteObject(key).catch(() => undefined);
    throw new UploadError(
      kind === "video" ? "El video pesa más de 500 MB. Graba uno más corto." : "La foto pesa más de 40 MB.",
      kind === "video" ? "The video is larger than 500 MB. Record a shorter one." : "The photo is larger than 40 MB.",
      413,
    );
  }

  // La imagen del video que sacó el navegador (para que la IA lo mire).
  let thumbUrl = "";
  const thumbKey = String(body.thumbKey ?? "");
  if (kind === "video" && thumbKey && isLibraryKey(thumbKey, businessId, ["jpg"])) {
    const th = await headObject(thumbKey).catch(() => null);
    if (th && th.size > 0 && th.size <= FRAME_MAX_BYTES) thumbUrl = publicUrl(thumbKey);
  }

  const name = cleanName(body.name) || `${kind === "video" ? "video" : "foto"}.${ext}`;
  const when = fileDate(body.lastModified, now);
  const item = await db.libraryItem.upsert({
    where: { businessId_externalId: { businessId, externalId: key } },
    create: {
      businessId,
      source: "upload",
      externalId: key,
      name,
      folderPath: cleanNote(body.note),
      mimeType: type,
      kind,
      // Los videos ya están guardados: se usan tal cual. Las fotos se copian (giradas y más livianas) al revisarlas.
      url: kind === "video" ? publicUrl(key) : "",
      thumbUrl,
      width: int(body.width, 20000),
      height: int(body.height, 20000),
      durationSec: kind === "video" ? Math.min(36_000, Math.max(0, Number(body.durationSec) || 0)) : 0,
      sizeBytes: Math.min(head.size, 2_147_483_647),
      takenAt: when,
      modifiedAt: when,
      status: "new",
    },
    update: {},
    select: { id: true },
  });
  return { id: item.id, kind, created: true };
}

// ---------- Para la tarjeta del dueño ----------

/** Cuántos archivos llegaron por el link y cuántos faltan por revisar. */
export async function uploadStats(businessId: string): Promise<{ total: number; pending: number }> {
  const [total, pending] = await Promise.all([
    db.libraryItem.count({ where: { businessId, source: "upload", status: { not: "gone" } } }),
    db.libraryItem.count({ where: { businessId, source: "upload", status: "new" } }),
  ]);
  return { total, pending };
}
