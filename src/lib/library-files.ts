// Archivos de la biblioteca: la copia guardada de una foto o video de Drive. Las fotos se copian al revisarlas; los
// videos solo cuando se usan en una publicación (son pesados).
import { db } from "@/lib/db";
import { downloadFile } from "@/lib/drive";
import { bi } from "@/lib/i18n";
import { copyPhotoFromDrive } from "@/lib/library-sync";
import { storeBuffer } from "@/lib/media";

/** Videos más pesados no se copian. */
export const VIDEO_MAX_BYTES = 150 * 1024 * 1024;

const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "video/mp4",
  "video/quicktime": "video/quicktime",
  "video/webm": "video/webm",
  "video/x-m4v": "video/mp4",
};

/** Tipo de video que acepta el almacenamiento (MP4, MOV o WEBM). null si es otro formato. */
export function videoContentType(mime: string, name: string): string | null {
  if (VIDEO_TYPES[mime]) return VIDEO_TYPES[mime];
  if (/\.(mp4|m4v)$/i.test(name)) return "video/mp4";
  if (/\.mov$/i.test(name)) return "video/quicktime";
  if (/\.webm$/i.test(name)) return "video/webm";
  return null;
}

/**
 * La dirección pública de la copia guardada del archivo (la crea si falta, por ejemplo los videos, que se copian
 * desde Drive solo cuando se usan). Lanza un error en palabras simples si no se puede.
 */
export async function ensureStoredCopy(itemId: string): Promise<string> {
  const item = await db.libraryItem.findUnique({ where: { id: itemId } });
  if (!item) throw bi("Esa foto o video ya no está en la biblioteca.", "That photo or video is no longer in the library.");
  if (item.url) return item.url;
  if (item.status === "gone") throw bi("Ese archivo ya no está en la carpeta de Google Drive.", "That file is no longer in the Google Drive folder.");

  if (item.kind === "video") {
    const mb = Math.round(item.sizeBytes / 1e6);
    if (item.sizeBytes > VIDEO_MAX_BYTES) {
      throw bi(
        `El video pesa ${mb} MB y el límite para usarlo es 150 MB. Sube a la carpeta una versión más corta o comprimida.`,
        `The video is ${mb} MB and the limit to use it is 150 MB. Upload a shorter or compressed version to the folder.`,
      );
    }
    const type = videoContentType(item.mimeType, item.name);
    if (!type)
      throw bi(
        "Ese video está en un formato que las redes no aceptan. Usa MP4 o MOV.",
        "That video is in a format social networks don't accept. Use MP4 or MOV.",
      );
    let data: Buffer;
    try {
      data = await downloadFile(item.externalId, VIDEO_MAX_BYTES);
    } catch (e) {
      if (e instanceof Error && /MB/.test(e.message)) {
        throw bi(
          "El video pesa más de 150 MB, el límite para usarlo. Sube a la carpeta una versión más corta o comprimida.",
          "The video is larger than 150 MB, the limit to use it. Upload a shorter or compressed version to the folder.",
        );
      }
      throw e;
    }
    const { url } = await storeBuffer(data, type, item.businessId);
    await db.libraryItem.update({
      where: { id: item.id },
      data: { url, sizeBytes: Math.min(data.length, 2_147_483_647) },
    });
    return url;
  }

  // Foto sin copia (todavía sin revisar, o la copia se perdió): se copia ahora.
  const copy = await copyPhotoFromDrive(item);
  await db.libraryItem.update({
    where: { id: item.id },
    data: { url: copy.url, thumbUrl: item.thumbUrl || copy.thumbUrl },
  });
  return copy.url;
}
