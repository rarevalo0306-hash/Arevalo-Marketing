import { bi, type BiError } from "@/lib/i18n";
import { getAccessToken, notConfigured, readServiceAccount } from "@/lib/google-sa";

// Google Drive (API v3) con la cuenta de servicio: datos de la carpeta, la lista de fotos y videos (con subcarpetas y
// accesos directos), descargar un archivo y su miniatura. Solo lectura.

const API = "https://www.googleapis.com/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
/** Hasta qué profundidad se entra en subcarpetas (la carpeta principal es 0). */
export const MAX_DEPTH = 4;
const MAX_FILES = 5000;

const FILE_FIELDS =
  "id,name,mimeType,size,modifiedTime,createdTime,thumbnailLink,trashed,imageMediaMetadata(width,height,time,rotation),videoMediaMetadata(width,height,durationMillis),shortcutDetails(targetId,targetMimeType)";

/** Lo que se guarda de cada foto o video de la carpeta. */
export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  kind: "photo" | "video";
  /** Subcarpeta dentro de la carpeta principal ("" si está en la principal). */
  folderPath: string;
  sizeBytes: number;
  modifiedTime: string;
  width: number;
  height: number;
  durationSec: number;
  takenAt: Date | null;
  thumbnailLink: string;
};

type RawFile = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  thumbnailLink?: string;
  trashed?: boolean;
  imageMediaMetadata?: {
    width?: number;
    height?: number;
    time?: string;
    rotation?: number;
  };
  videoMediaMetadata?: {
    width?: number;
    height?: number;
    durationMillis?: string;
  };
  shortcutDetails?: { targetId?: string; targetMimeType?: string };
};

const saEmail = () => readServiceAccount()?.client_email ?? "";

/** Traduce un error de la API de Drive a palabras simples (en los dos idiomas). */
export function driveApiError(status: number, body: string, email = saEmail()): BiError {
  let reason = "";
  let message = "";
  try {
    const e = (
      JSON.parse(body) as {
        error?: {
          message?: string;
          status?: string;
          errors?: { reason?: string }[];
          details?: { reason?: string }[];
        };
      }
    ).error;
    reason = [e?.errors?.[0]?.reason, e?.details?.find((d) => d.reason)?.reason, e?.status].filter(Boolean).join(" ");
    message = e?.message ?? "";
  } catch {
    message = body.slice(0, 200);
  }
  const all = `${reason} ${message}`;
  if (/accessNotConfigured|SERVICE_DISABLED|has not been used in project|is disabled/i.test(all)) {
    return bi(
      "Falta activar la «Google Drive API» en el proyecto de Google Cloud de la cuenta de servicio. Actívala y vuelve a intentar en unos minutos.",
      'The "Google Drive API" needs to be turned on in the service account\'s Google Cloud project. Turn it on and try again in a few minutes.',
    );
  }
  if (status === 429 || /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|dailyLimitExceeded|RESOURCE_EXHAUSTED/i.test(all)) {
    return bi(
      "Google Drive llegó a su límite de consultas por ahora. La app vuelve a intentarlo sola más tarde.",
      "Google Drive has hit its request limit for now. The app will try again on its own later.",
    );
  }
  if (status === 404 || status === 403) {
    const who = email || "el correo de la cuenta de servicio";
    const whoEn = email || "the service account email";
    return bi(
      `La app no puede ver la carpeta. Comparte la carpeta con ${who} como Lector.`,
      `The app can't see the folder. Share the folder with ${whoEn} as Viewer.`,
    );
  }
  if (status === 401) {
    return bi(
      "Google rechazó el acceso de la cuenta de servicio. Revisa la llave en GOOGLE_SERVICE_ACCOUNT_JSON.",
      "Google rejected the service account's access. Check the key in GOOGLE_SERVICE_ACCOUNT_JSON.",
    );
  }
  return bi(
    `Google Drive respondió con un error (${status}). Intenta de nuevo más tarde.`,
    `Google Drive answered with an error (${status}). Try again later.`,
  );
}

async function driveGet(path: string, params: Record<string, string> = {}): Promise<Response> {
  if (!readServiceAccount()) throw notConfigured();
  const token = await getAccessToken();
  const qs = new URLSearchParams({ supportsAllDrives: "true", ...params });
  const res = await fetch(`${API}${path}?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw driveApiError(res.status, await res.text());
  return res;
}

async function getRaw(id: string): Promise<RawFile> {
  return (await (await driveGet(`/files/${encodeURIComponent(id)}`, { fields: FILE_FIELDS })).json()) as RawFile;
}

/** Los datos de un archivo (por ejemplo, para pedir su miniatura cuando hace falta). null si ya no es foto ni video. */
export async function getFileInfo(id: string): Promise<DriveFile | null> {
  return toFile(await getRaw(id), "");
}

/** Nombre de la carpeta (sigue un acceso directo a una carpeta). Error simple si no es carpeta o no está compartida. */
export async function getFolder(id: string): Promise<{ id: string; name: string }> {
  let f = await getRaw(id);
  if (f.mimeType === SHORTCUT && f.shortcutDetails?.targetMimeType === FOLDER && f.shortcutDetails.targetId) f = await getRaw(f.shortcutDetails.targetId);
  if (f.trashed) throw bi("Esa carpeta está en la papelera de Google Drive.", "That folder is in the Google Drive trash.");
  if (f.mimeType !== FOLDER)
    throw bi(
      "Ese link es de un archivo, no de una carpeta. Abre la carpeta en Drive y copia su link.",
      "That link is a file, not a folder. Open the folder in Drive and copy its link.",
    );
  return { id: f.id, name: f.name ?? "" };
}

const kindOf = (mime: string): "photo" | "video" | null => (mime.startsWith("image/") ? "photo" : mime.startsWith("video/") ? "video" : null);

/** "2023:05:01 14:22:10" (EXIF) → fecha. */
function exifTime(s: string | undefined): Date | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s ?? "");
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return isNaN(d.getTime()) || +m[1] < 1990 ? null : d;
}

function toFile(f: RawFile, folderPath: string, name = f.name ?? ""): DriveFile | null {
  const mime = f.mimeType ?? "";
  const kind = kindOf(mime);
  if (!kind || f.trashed) return null;
  const im = f.imageMediaMetadata;
  const vm = f.videoMediaMetadata;
  const rotated = (im?.rotation ?? 0) % 2 === 1;
  return {
    id: f.id,
    name,
    mimeType: mime,
    kind,
    folderPath,
    sizeBytes: Number(f.size ?? 0) || 0,
    modifiedTime: f.modifiedTime ?? f.createdTime ?? "",
    width: (rotated ? im?.height : im?.width) ?? vm?.width ?? 0,
    height: (rotated ? im?.width : im?.height) ?? vm?.height ?? 0,
    durationSec: vm?.durationMillis ? Math.round(Number(vm.durationMillis) / 100) / 10 : 0,
    takenAt: exifTime(im?.time),
    thumbnailLink: f.thumbnailLink ?? "",
  };
}

/**
 * Todas las fotos y videos de la carpeta y sus subcarpetas (hasta 4 niveles), siguiendo accesos directos y sin lo que
 * está en la papelera. Pide las páginas que haga falta.
 */
export async function listMedia(folderId: string, maxDepth = MAX_DEPTH): Promise<DriveFile[]> {
  const out = new Map<string, DriveFile>();
  const seenFolders = new Set<string>([folderId]);
  const queue: { id: string; path: string; depth: number }[] = [{ id: folderId, path: "", depth: 0 }];
  while (queue.length && out.size < MAX_FILES) {
    const folder = queue.shift()!;
    let pageToken = "";
    do {
      const params: Record<string, string> = {
        q: `'${folder.id.replace(/'/g, "")}' in parents and trashed = false`,
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: "1000",
        includeItemsFromAllDrives: "true",
        orderBy: "createdTime",
      };
      if (pageToken) params.pageToken = pageToken;
      const page = (await (await driveGet("/files", params)).json()) as {
        files?: RawFile[];
        nextPageToken?: string;
      };
      for (const f of page.files ?? []) {
        if (f.trashed) continue;
        const childPath = folder.path ? `${folder.path}/${f.name ?? ""}` : (f.name ?? "");
        if (f.mimeType === FOLDER) {
          if (folder.depth < maxDepth && !seenFolders.has(f.id)) {
            seenFolders.add(f.id);
            queue.push({ id: f.id, path: childPath, depth: folder.depth + 1 });
          }
        } else if (f.mimeType === SHORTCUT) {
          const target = f.shortcutDetails?.targetId;
          const tMime = f.shortcutDetails?.targetMimeType ?? "";
          if (!target) continue;
          if (tMime === FOLDER) {
            if (folder.depth < maxDepth && !seenFolders.has(target)) {
              seenFolders.add(target);
              queue.push({
                id: target,
                path: childPath,
                depth: folder.depth + 1,
              });
            }
          } else if (kindOf(tMime) && !out.has(target)) {
            // Acceso directo a una foto o video: se guarda el archivo de verdad (con el nombre del acceso directo).
            try {
              const file = toFile(await getRaw(target), folder.path, f.name ?? "");
              if (file) out.set(file.id, file);
            } catch {
              // Sin permiso para el archivo original: se ignora.
            }
          }
        } else {
          const file = toFile(f, folder.path);
          if (file && !out.has(file.id)) out.set(file.id, file);
        }
      }
      pageToken = page.nextPageToken ?? "";
    } while (pageToken && out.size < MAX_FILES);
  }
  return [...out.values()];
}

/** Descarga el archivo completo (con un límite de tamaño). */
export async function downloadFile(id: string, maxBytes: number): Promise<Buffer> {
  const res = await driveGet(`/files/${encodeURIComponent(id)}`, {
    alt: "media",
  });
  const len = Number(res.headers.get("content-length") ?? 0);
  const tooBig = () => bi(`El archivo pesa más de ${Math.round(maxBytes / 1e6)} MB.`, `The file is larger than ${Math.round(maxBytes / 1e6)} MB.`);
  if (len > maxBytes) {
    await res.body?.cancel();
    throw tooBig();
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw tooBig();
  return buf;
}

/** La dirección de la miniatura de Drive en el tamaño pedido (las de Drive terminan en "=s220"). */
export const thumbnailAt = (link: string, size: number) =>
  /=s\d+(-[a-z0-9-]*)?$/i.test(link) ? link.replace(/=s\d+(-[a-z0-9-]*)?$/i, `=s${size}`) : `${link}${link.includes("=") ? "" : `=s${size}`}`;

/** Descarga la miniatura que Drive hizo del archivo (sirve para videos y fotos HEIC). null si no hay. */
export async function getThumbnail(link: string, size = 800): Promise<Buffer | null> {
  if (!link) return null;
  const url = thumbnailAt(link, size);
  const token = await getAccessToken().catch(() => "");
  const tries: Record<string, string>[] = token ? [{ Authorization: `Bearer ${token}` }, {}] : [{}];
  for (const headers of tries) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok && (res.headers.get("content-type") ?? "").startsWith("image/")) return Buffer.from(await res.arrayBuffer());
    } catch {
      // se prueba sin permiso
    }
  }
  return null;
}

/** Link para abrir la carpeta en Google Drive. */
export const folderLink = (id: string) => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;
