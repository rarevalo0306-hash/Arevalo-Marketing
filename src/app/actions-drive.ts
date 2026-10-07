"use server";

// Carpeta de Google Drive del negocio: conectar, revisar ahora y desconectar.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getFolder } from "@/lib/drive";
import { serviceAccountEmail, serviceAccountEnabled } from "@/lib/google-sa";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { driveFolderId } from "@/lib/library-shape";
import { syncLibrary, syncMessage } from "@/lib/library-sync";

export type DriveResult = { ok: boolean; message: string };

function refresh(businessId: string) {
  revalidatePath(`/b/${businessId}/conexiones`);
  revalidatePath(`/b/${businessId}/fotos`);
}

/** Revisa la carpeta ahora: trae lo nuevo y la IA lo mira. */
export async function syncDriveNow(businessId: string): Promise<DriveResult> {
  const { lang, t } = await getT();
  try {
    const b = await db.business.findUnique({
      where: { id: businessId },
      select: { driveFolderId: true },
    });
    if (!b)
      return {
        ok: false,
        message: t("Negocio no encontrado.", "Business not found."),
      };
    if (!b.driveFolderId)
      return {
        ok: false,
        message: t("Primero conecta una carpeta de Google Drive.", "Connect a Google Drive folder first."),
      };
    const r = await syncLibrary(businessId, { lang, budgetMs: 55_000 });
    refresh(businessId);
    return { ok: r.ok, message: syncMessage(r, t) };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** Conecta la carpeta: revisa que el link sea de una carpeta y que la app la pueda ver, y guarda su nombre. */
export async function saveDriveFolder(businessId: string, link: string): Promise<DriveResult> {
  const { lang, t } = await getT();
  if (!serviceAccountEnabled()) {
    return {
      ok: false,
      message: t(
        "Falta configurar la cuenta de servicio de Google en el servidor (GOOGLE_SERVICE_ACCOUNT_JSON).",
        "The Google service account isn't set up on the server yet (GOOGLE_SERVICE_ACCOUNT_JSON).",
      ),
    };
  }
  const id = driveFolderId(String(link ?? ""));
  if (!id) {
    return {
      ok: false,
      message: t(
        "Ese link no parece de una carpeta de Google Drive. Abre la carpeta en Drive, toca «Compartir» → «Copiar vínculo» y pégalo aquí.",
        'That link doesn\'t look like a Google Drive folder. Open the folder in Drive, tap "Share" → "Copy link" and paste it here.',
      ),
    };
  }
  try {
    const folder = await getFolder(id);
    const prev = await db.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { driveFolderId: true },
    });
    await db.business.update({
      where: { id: businessId },
      data: {
        driveFolderId: folder.id,
        driveFolderName: folder.name,
        driveError: "",
        ...(prev.driveFolderId !== folder.id ? { driveSyncedAt: null } : {}),
      },
    });
    refresh(businessId);
    return {
      ok: true,
      message: t(
        `Listo: la carpeta «${folder.name}» quedó conectada. Presiona «Revisar ahora» para traer las fotos.`,
        `Done: the folder "${folder.name}" is connected. Press "Check now" to bring in the photos.`,
      ),
    };
  } catch (e) {
    const email = serviceAccountEmail();
    const msg = errorText(e, lang);
    return {
      ok: false,
      message: msg || t(`Comparte la carpeta con ${email} como Lector.`, `Share the folder with ${email} as Viewer.`),
    };
  }
}

/** Deja de leer la carpeta. Las fotos ya copiadas se quedan en la biblioteca. */
export async function disconnectDrive(businessId: string): Promise<DriveResult> {
  const { t } = await getT();
  await db.business.update({
    where: { id: businessId },
    data: {
      driveFolderId: "",
      driveFolderName: "",
      driveError: "",
      driveSyncedAt: null,
    },
  });
  refresh(businessId);
  return {
    ok: true,
    message: t(
      "Carpeta desconectada. Las fotos que ya se copiaron se quedan en tu biblioteca.",
      "Folder disconnected. Photos already copied stay in your library.",
    ),
  };
}
