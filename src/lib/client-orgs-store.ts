// Organizaciones de cliente (ClientOrg) en la base de datos. Cada cuenta (Organization) agrupa sus negocios en
// organizaciones de cliente; esta parte solo asegura que siempre haya una donde poner un negocio nuevo.
import { db } from "@/lib/db";

/** El nombre de la organización que se crea sola. Es dato guardado: igual en español y en inglés. */
export const DEFAULT_CLIENT_ORG_NAME = "Mis compañías";

/**
 * El id de la organización más antigua de la cuenta; si la cuenta no tiene ninguna, crea «Mis compañías».
 * Dentro de una transacción que primero toma un candado por cuenta, así dos negocios nuevos al mismo tiempo en una
 * cuenta sin organizaciones crean una sola.
 */
export async function ensureDefaultClientOrg(organizationId: string): Promise<string> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('client-org:' || ${organizationId}::text))`;
    const oldest = await tx.clientOrg.findFirst({ where: { organizationId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
    if (oldest) return oldest.id;
    const made = await tx.clientOrg.create({ data: { organizationId, name: DEFAULT_CLIENT_ORG_NAME }, select: { id: true } });
    return made.id;
  });
}
