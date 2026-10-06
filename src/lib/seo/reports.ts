// Guardar y leer los reportes de SEO de un negocio (tabla SeoReport). Se guarda cada corrida para ver el avance.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type SeoKind =
  | "audit"
  | "ai"
  | "gsc"
  | "keywords"
  | "rank"
  | "competitors"
  | "gap"
  | "article"
  | "maprank"
  | "onpage"
  // Tu Perfil de Google (src/lib/seo/gbp.ts): el perfil, las reseñas y la tarea de reseñas que quedó en la cola.
  | "gbp"
  | "reviews"
  | "reviews-task"
  // Visitas de la competencia (traffic.ts), enlaces (backlinks.ts) y páginas que compiten entre sí (cannibal.ts).
  | "traffic"
  | "backlinks"
  | "backlinks-locked"
  | "cannibal";

export async function saveReport(businessId: string, kind: SeoKind, data: Prisma.InputJsonValue) {
  return db.seoReport.create({ data: { businessId, kind, data } });
}

/** Los últimos reportes de un tipo, del más nuevo al más viejo. */
export async function latestReports(businessId: string, kind: SeoKind, take = 1) {
  return db.seoReport.findMany({ where: { businessId, kind }, orderBy: { createdAt: "desc" }, take });
}
