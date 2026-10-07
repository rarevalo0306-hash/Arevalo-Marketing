"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { GSC_CHANNEL } from "@/lib/seo/gsc";

/** Quita la conexión con Search Console desde Conexiones (los reportes guardados se quedan). */
export async function disconnectGscFromConnections(businessId: string) {
  await db.connection.deleteMany({ where: { businessId, channel: GSC_CHANNEL } });
  revalidatePath(`/b/${businessId}/conexiones`);
  revalidatePath(`/b/${businessId}/seo`);
}
