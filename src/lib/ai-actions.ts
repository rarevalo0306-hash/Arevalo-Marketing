// Registro de lo que hizo la IA (tabla AiAction): cada publicación, anuncio, pausa o parada queda anotada con una
// frase para el dueño. Lo usan las campañas, los anuncios y el reporte diario. Nunca rompe lo que se estaba haciendo:
// si no se puede guardar, solo se avisa en la consola.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type AiActor = "auto" | "approved" | "owner";

export type AiActionInput = {
  businessId: string;
  campaignId?: string | null;
  /** Con un punto: post.draft | post.published | ad.created | campaign.stopped | limit.reached … */
  kind: string;
  summary: { es: string; en: string };
  detail?: Prisma.InputJsonValue;
  actor?: AiActor;
  costCents?: number;
  postId?: string | null;
};

export async function logAiAction(a: AiActionInput): Promise<void> {
  try {
    await db.aiAction.create({
      data: {
        businessId: a.businessId,
        campaignId: a.campaignId ?? null,
        kind: a.kind.slice(0, 60),
        summary: { es: a.summary.es.slice(0, 500), en: a.summary.en.slice(0, 500) },
        detail: a.detail ?? Prisma.JsonNull,
        actor: a.actor ?? "auto",
        costCents: Math.max(0, Math.round(a.costCents ?? 0)),
        postId: a.postId ?? null,
      },
    });
  } catch (e) {
    console.error("logAiAction", e);
  }
}

/** Lo último que hizo la IA en un negocio (o en una campaña), lo más nuevo primero. */
export function recentAiActions(businessId: string, opts: { campaignId?: string; since?: Date; limit?: number } = {}) {
  return db.aiAction.findMany({
    where: { businessId, ...(opts.campaignId ? { campaignId: opts.campaignId } : {}), ...(opts.since ? { createdAt: { gte: opts.since } } : {}) },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 50,
  });
}
