import { channelDef, notesFor, type ChannelId, type MediaType } from "@/lib/channels";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { publicMediaUrl } from "@/lib/media";
import { PUBLISHERS } from "@/lib/publishers";

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
  const input = {
    ...draft,
    mediaUrl: publicMediaUrl(post.mediaUrl),
    businessName: post.business.name,
    contacts: post.business.contacts,
  };

  for (const target of post.targets.filter((t) => t.status === "pending")) {
    const channel = target.channel as ChannelId;
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
    } else {
      const blocking = notesFor(channel, draft).filter((n) => n.blocking);
      if (blocking.length) {
        detail = blocking.map((n) => n.text).join(" ");
      } else {
        try {
          const res = await PUBLISHERS[channel].publish(input, decryptJson(conn.secret));
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

  const targets = await db.postTarget.findMany({ where: { postId } });
  const sent = targets.filter((t) => t.status === "sent").length;
  const final = sent === targets.length ? "done" : sent > 0 ? "partial" : "failed";
  await db.post.update({ where: { id: postId }, data: { status: final } });
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

/** Vuelve a intentar los canales que fallaron o se saltaron. */
export async function retryPost(postId: string): Promise<void> {
  await db.postTarget.updateMany({
    where: { postId, status: { in: ["failed", "skipped"] } },
    data: { status: "pending", detail: "" },
  });
  await db.post.updateMany({
    where: { id: postId, status: { in: ["failed", "partial", "done"] } },
    data: { status: "scheduled", scheduledAt: new Date() },
  });
  await publishPost(postId);
}
