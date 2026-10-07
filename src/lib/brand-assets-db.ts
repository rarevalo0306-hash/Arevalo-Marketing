// Leer y cambiar Business.brandAssets en la base de datos. Cada cambio vuelve a leer lo último guardado dentro de
// una transacción, para que leer el manual y crear el kit al mismo tiempo no se pisen.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readBrandAssets, type BrandAssets } from "@/lib/brand-assets";

export async function loadBrandAssets(businessId: string): Promise<BrandAssets> {
  const b = await db.business.findUnique({ where: { id: businessId }, select: { brandAssets: true } });
  return readBrandAssets(b?.brandAssets);
}

export async function updateBrandAssets(businessId: string, change: (cur: BrandAssets) => BrandAssets): Promise<BrandAssets> {
  return db.$transaction(async (tx) => {
    // Bloquea la fila del negocio hasta terminar este cambio.
    await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR UPDATE`;
    const b = await tx.business.findUnique({ where: { id: businessId }, select: { brandAssets: true } });
    const next = change(readBrandAssets(b?.brandAssets));
    await tx.business.update({ where: { id: businessId }, data: { brandAssets: next as unknown as Prisma.InputJsonValue } });
    return next;
  });
}
