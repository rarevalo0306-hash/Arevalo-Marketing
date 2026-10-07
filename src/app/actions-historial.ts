"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { retryTargets } from "@/lib/publish";
import { explainFailure, explainSent } from "@/lib/publish-errors";

export type RetryLine = {
  channel: string;
  /** sent | failed | skipped | held (no se reintentó: el dueño tiene que hacer algo antes) */
  status: string;
  message: string;
  action?: { label: string; href: string };
  url?: string;
};
export type RetryState = { ok: boolean; message: string; lines: RetryLine[] } | null;

/**
 * Reintentar desde el Historial: un canal (targetId) o todos los que fallaron.
 * Devuelve cómo quedó cada canal en palabras sencillas para mostrarlo al momento.
 */
export async function retryFromHistory(_prev: RetryState, f: FormData): Promise<RetryState> {
  const { lang, t } = await getT();
  const businessId = String(f.get("businessId") ?? "");
  const postId = String(f.get("postId") ?? "");
  const targetId = String(f.get("targetId") ?? "");
  const force = f.get("force") === "1";
  const post = await db.post.findFirst({ where: { id: postId, businessId }, select: { id: true } });
  if (!post) return { ok: false, message: t("No encontramos esta publicación. Recarga la página.", "We couldn't find this post. Reload the page."), lines: [] };

  let outcome;
  try {
    outcome = await retryTargets(postId, { targetIds: targetId ? [targetId] : undefined, force });
  } catch (e) {
    console.error("[historial] reintento:", e);
    return { ok: false, message: t("No se pudo reintentar ahora. Espera un momento y prueba otra vez.", "Couldn't retry right now. Wait a moment and try again."), lines: [] };
  }
  revalidatePath(`/b/${businessId}/historial`);
  revalidatePath(`/b/${businessId}/conexiones`);

  if (outcome.state === "busy")
    return { ok: false, message: t("Esta publicación se está publicando en este momento. Espera un minuto y recarga la página.", "This post is being published right now. Wait a minute and reload the page."), lines: [] };

  const lines: RetryLine[] = [
    ...outcome.results.map((r): RetryLine => {
      if (r.status === "sent") return { channel: r.channel, status: "sent", message: explainSent(r.channel, r.detail, lang), url: r.externalUrl || undefined };
      const ex = explainFailure(r.channel, r.detail, lang, businessId);
      return { channel: r.channel, status: r.status, message: ex.message, action: ex.action };
    }),
    ...outcome.held.map((h): RetryLine => {
      const ex = explainFailure(h.channel, h.detail, lang, businessId);
      return {
        channel: h.channel,
        status: "held",
        message: t(`No lo volvimos a intentar porque fallaría igual. ${ex.message}`, `We didn't try again because it would fail the same way. ${ex.message}`),
        action: ex.action,
      };
    }),
  ];
  if (outcome.state === "nothing" && !lines.length) return { ok: true, message: t("No había nada que reintentar.", "There was nothing to retry."), lines };
  const sent = outcome.results.filter((r) => r.status === "sent").length;
  const ok = sent > 0 && sent === outcome.results.length && !outcome.held.length;
  const message = ok
    ? t("¡Listo! Ya se publicó.", "Done! It's posted now.")
    : sent > 0
      ? t("Se publicó en una parte. Mira abajo lo que falta.", "Part of it is posted. See below what's left.")
      : outcome.results.some((r) => r.status === "failed")
        ? t("Volvió a fallar.", "It failed again.")
        : t("Antes de reintentar hay que arreglar algo.", "Something needs fixing before retrying.");
  return { ok, message, lines };
}
