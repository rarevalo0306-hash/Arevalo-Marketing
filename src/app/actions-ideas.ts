"use server";

// Ideas de publicaciones: "✦ Más ideas con IA" (Inicio y Publicar).
import { aiEnabled } from "@/lib/ai";
import { type ContentIdea, loadAllIdeas, recentOpenings } from "@/lib/content-ideas";
import { aiMoreIdeas } from "@/lib/content-ideas-ai";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";

export type MoreIdeasResult = { ok: true; ideas: ContentIdea[] } | { ok: false; error: string };

/** 10 ideas más de la IA, a partir de las oportunidades de SEO guardadas y sin repetir lo publicado. */
export async function moreIdeas(businessId: string): Promise<MoreIdeasResult> {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { name: true, website: true, aiProfile: true, aiText: true, study: true } });
  if (!b) return { ok: false, error: t("Negocio no encontrado", "Business not found") };
  if (!aiEnabled()) return { ok: false, error: t("Falta configurar la IA en la app.", "AI isn't set up in the app yet.") };
  try {
    const [all, recent] = await Promise.all([loadAllIdeas(businessId, lang), recentOpenings(businessId)]);
    const ideas = await aiMoreIdeas(b, { top: all.ideas.filter((x) => x.source !== "season"), recent, lang });
    if (!ideas.length) return { ok: false, error: t("La IA no devolvió ideas. Intenta de nuevo.", "The AI didn't return any ideas. Try again.") };
    return { ok: true, ideas };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}
