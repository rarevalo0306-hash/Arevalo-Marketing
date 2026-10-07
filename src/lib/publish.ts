import { channelDef, notesFor, type ChannelId, type MediaType } from "@/lib/channels";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { publicMediaUrl } from "@/lib/media";
import { decideReconnect } from "@/lib/connection-health";
import { mediaForChannel } from "@/lib/media-formats";
import { PUBLISHERS } from "@/lib/publishers";
import { readStudy, topKeywords } from "@/lib/study-shape";

/**
 * Publica una publicación en sus canales pendientes.
 * Solo un proceso puede tomarla a la vez (pasa de "scheduled" a "publishing" de forma atómica).
 */
export async function publishPost(postId: string): Promise<void> {
  const claimed = await db.post.updateMany({
    where: { id: postId, status: "scheduled" },
    data: { status: "publishing" },
  });
  if (claimed.count === 0) return;

  const post = await db.post.findUniqueOrThrow({
    where: { id: postId },
    include: { targets: true, business: { include: { connections: true, contacts: true } } },
  });
  const draft = {
    text: post.text,
    subject: post.subject,
    seoTitle: post.seoTitle,
    mediaType: post.mediaType as MediaType,
  };
  const study = readStudy(post.business.study);
  const input = {
    ...draft,
    mediaUrl: publicMediaUrl(post.mediaUrl),
    businessName: post.business.name,
    contacts: post.business.contacts,
    keywords: study ? topKeywords(study, 15) : [],
  };

  const variants = (post.variants ?? {}) as Partial<Record<ChannelId, string>>;

  try {
    for (const target of post.targets.filter((t) => t.status === "pending")) {
      const channel = target.channel as ChannelId;
      // Cada canal puede tener su propio texto (por ejemplo, el que escribió la IA para Instagram o SMS).
      const text = variants[channel]?.trim() || post.text;
      const channelDraft = { ...draft, text };
      const def = channelDef(channel);
      const conn = post.business.connections.find((c) => c.channel === channel);
      let status = "failed";
      let detail = "";
      let externalUrl = "";
      if (!def) {
        detail = "Canal desconocido";
      } else if (!conn) {
        status = "skipped";
        detail = `${def.name} no está conectado para este negocio`;
      } else if (audienceGap(channel, post.business.contacts)) {
        // Sin nadie a quien enviarle: se salta (no es un error) y se explica por qué.
        status = "skipped";
        detail = audienceGap(channel, post.business.contacts);
      } else {
        const blocking = notesFor(channel, channelDraft).filter((n) => n.blocking);
        if (blocking.length) {
          detail = blocking.map((n) => n.text).join(" ");
        } else {
          try {
            const res = await PUBLISHERS[channel].publish({ ...input, text, mediaUrl: await mediaForChannel(post, channel) }, decryptJson(conn.secret));
            status = "sent";
            detail = res.detail;
            externalUrl = res.url ?? "";
          } catch (e) {
            detail = (e as Error).message || "Error desconocido";
          }
        }
      }
      await db.postTarget.update({
        where: { id: target.id },
        data: { status, detail: detail.slice(0, 1000), externalUrl, sentAt: status === "sent" ? new Date() : null },
      });
    }
  } finally {
    // Aunque algo falle a medias, la publicación nunca se queda en "Publicando…" para siempre.
    await finishPost(postId);
  }
}

async function finishPost(postId: string): Promise<void> {
  const targets = await db.postTarget.findMany({ where: { postId } });
  const sent = targets.filter((t) => t.status === "sent").length;
  const final = sent === targets.length ? "done" : sent > 0 ? "partial" : "failed";
  await db.post.update({ where: { id: postId }, data: { status: final } });
}

type Reachable = { email: string; phone: string; emailOptIn: boolean; smsOptIn: boolean };

/** Email y SMS sin contactos que hayan aceptado: devuelve el motivo para saltar el canal ("" si hay a quién enviar). */
export function audienceGap(channel: string, contacts: Reachable[]): string {
  if (channel === "email" && !contacts.some((c) => c.emailOptIn && c.email.includes("@")))
    return "No tienes contactos que hayan aceptado recibir correos, así que no se envió el email.";
  if (channel === "sms" && !contacts.some((c) => c.smsOptIn && c.phone.trim()))
    return "No tienes contactos que hayan aceptado recibir textos, así que no se envió el mensaje de texto.";
  return "";
}

/** Publica todo lo programado cuya hora ya llegó. */
export async function publishDue(): Promise<number> {
  const due = await db.post.findMany({
    where: { status: "scheduled", scheduledAt: { lte: new Date() } },
    select: { id: true },
    orderBy: { scheduledAt: "asc" },
    take: 20,
  });
  for (const p of due) await publishPost(p.id);
  return due.length;
}

export type RetryTargetResult = { targetId: string; channel: string; status: string; detail: string; externalUrl: string };
export type RetryOutcome = {
  /** retried: se volvió a intentar; busy: se está publicando ahora mismo; nothing: no había nada que reintentar. */
  state: "retried" | "busy" | "nothing";
  /** Cómo quedó cada canal que se reintentó. */
  results: RetryTargetResult[];
  /** Canales que NO se reintentaron porque el dueño tiene que hacer algo antes (por ejemplo, volver a conectar Facebook). */
  held: { targetId: string; channel: string; detail: string }[];
};

/**
 * Vuelve a intentar los canales que fallaron o se saltaron (o solo `targetIds`).
 * Los que fallaron porque hay que volver a conectar la cuenta NO se reintentan (fallarían igual) a menos que
 * la conexión se haya vuelto a guardar después del fallo, o que se pida `force`.
 */
export async function retryTargets(postId: string, opts: { targetIds?: string[]; force?: boolean } = {}): Promise<RetryOutcome> {
  const post = await db.post.findUnique({
    where: { id: postId },
    include: { targets: true, business: { select: { connections: { select: { channel: true, updatedAt: true } } } } },
  });
  if (!post) return { state: "nothing", results: [], held: [] };
  if (post.status === "publishing" || post.status === "scheduled") return { state: "busy", results: [], held: [] };
  if (post.status === "draft") return { state: "nothing", results: [], held: [] };

  // "pending" en una publicación ya terminada = quedó a medias (se cortó); también se reintenta.
  const candidates = post.targets.filter(
    (t) => ["failed", "skipped", "pending"].includes(t.status) && (!opts.targetIds || opts.targetIds.includes(t.id)),
  );
  const held: RetryOutcome["held"] = [];
  const go: string[] = [];
  for (const t of candidates) {
    const conn = post.business.connections.find((c) => c.channel === t.channel);
    const blocked = !opts.force && decideReconnect({ channel: t.channel, status: t.status, detail: t.detail, at: post.scheduledAt }, conn?.updatedAt);
    if (blocked) held.push({ targetId: t.id, channel: t.channel, detail: t.detail });
    else go.push(t.id);
  }
  if (!go.length) return { state: "nothing", results: [], held };

  // Se marca todo junto (en una transacción) para que el publicador automático no tome la publicación a medias.
  const [, claimed] = await db.$transaction([
    db.postTarget.updateMany({
      where: { id: { in: go }, postId, post: { status: { in: ["failed", "partial", "done"] } } },
      data: { status: "pending", detail: "" },
    }),
    // scheduledAt = hora de este intento (así se sabe cuándo falló por última vez).
    db.post.updateMany({
      where: { id: postId, status: { in: ["failed", "partial", "done"] } },
      data: { status: "scheduled", scheduledAt: new Date() },
    }),
  ]);
  if (claimed.count === 0) return { state: "busy", results: [], held };
  await publishPost(postId);

  const after = await db.postTarget.findMany({ where: { id: { in: go } } });
  return {
    state: "retried",
    results: after.map((t) => ({ targetId: t.id, channel: t.channel, status: t.status, detail: t.detail, externalUrl: t.externalUrl })),
    held,
  };
}

/** Vuelve a intentar los canales que fallaron o se saltaron (menos los que necesitan que el dueño vuelva a conectar). */
export async function retryPost(postId: string): Promise<RetryOutcome> {
  return retryTargets(postId);
}
