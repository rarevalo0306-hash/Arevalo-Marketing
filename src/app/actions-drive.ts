"use server";

// Carpeta de Google Drive del negocio: conectar, probar y revisar ahora. TODO (agente CORE): implementar.
export type DriveResult = { ok: boolean; message: string };

/** Revisa la carpeta ahora: trae lo nuevo y la IA lo mira. */
export async function syncDriveNow(businessId: string): Promise<DriveResult> {
  void businessId;
  return { ok: false, message: "" };
}
