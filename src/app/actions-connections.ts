"use server";

import { revalidatePath } from "next/cache";
import { disconnectGoogleData } from "@/lib/data-deletion";
import { GSC_CHANNEL } from "@/lib/seo/gsc";

/** Quita la conexión con Search Console desde Conexiones (revoca Google y elimina el reporte guardado de esta conexión). */
export async function disconnectGscFromConnections(businessId: string) {
  await disconnectGoogleData(businessId, GSC_CHANNEL);
  revalidatePath(`/b/${businessId}/conexiones`);
  revalidatePath(`/b/${businessId}/seo`);
}
