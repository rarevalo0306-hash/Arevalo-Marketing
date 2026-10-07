// "Necesita volver a conectarse": se deduce del último intento de publicar en cada canal.
// Si el último intento falló porque el permiso o la clave ya no sirven (por ejemplo, Facebook quitó el permiso)
// y la conexión no se ha vuelto a guardar desde entonces, el canal necesita que el dueño lo vuelva a conectar.

import { db } from "@/lib/db";
import { classifyFailure, isReconnectKind } from "@/lib/publish-errors";

export type LastAttempt = {
  status: string;
  detail: string;
  channel: string;
  /** Cuándo se intentó publicar (sentAt si salió; si no, la hora del último intento de la publicación). */
  at: Date;
};

export type ReconnectInfo = {
  /** Desde cuándo falla. */
  since: Date;
  /** El error original de la red social. */
  detail: string;
};

/**
 * Regla pura (fácil de probar): necesita reconectarse si el último intento falló por permisos/clave
 * y la conexión se guardó ANTES de ese intento (si la volvió a conectar después, ya no se marca).
 */
export function decideReconnect(last: LastAttempt | null | undefined, connectionUpdatedAt: Date | null | undefined): ReconnectInfo | null {
  if (!last || !connectionUpdatedAt) return null;
  if (last.status !== "failed") return null;
  if (!isReconnectKind(classifyFailure(last.detail, last.channel))) return null;
  if (connectionUpdatedAt.getTime() > last.at.getTime()) return null;
  return { since: last.at, detail: last.detail };
}

/** Último intento real (enviado o fallido) por canal; los saltados y pendientes no cuentan. */
async function lastAttempts(businessId: string, channels?: string[]): Promise<Map<string, LastAttempt>> {
  const rows = await db.postTarget.findMany({
    where: {
      status: { in: ["sent", "failed"] },
      ...(channels ? { channel: { in: channels } } : {}),
      post: { businessId },
    },
    select: { channel: true, status: true, detail: true, sentAt: true, post: { select: { scheduledAt: true } } },
    orderBy: { post: { scheduledAt: "desc" } },
    take: 200,
  });
  const out = new Map<string, LastAttempt>();
  for (const r of rows) {
    const at = r.sentAt ?? r.post.scheduledAt;
    const prev = out.get(r.channel);
    if (!prev || at.getTime() > prev.at.getTime()) out.set(r.channel, { channel: r.channel, status: r.status, detail: r.detail, at });
  }
  return out;
}

/** ¿Este canal del negocio necesita volver a conectarse? null = está bien (o no hay datos para saberlo). */
export async function connectionNeedsReconnect(businessId: string, channel: string): Promise<ReconnectInfo | null> {
  const conn = await db.connection.findUnique({ where: { businessId_channel: { businessId, channel } }, select: { updatedAt: true } });
  if (!conn) return null;
  const last = (await lastAttempts(businessId, [channel])).get(channel);
  return decideReconnect(last, conn.updatedAt);
}

/** Lo mismo para todos los canales conectados del negocio, en una sola consulta (para la pantalla de Conexiones). */
export async function connectionsNeedingReconnect(businessId: string): Promise<Record<string, ReconnectInfo>> {
  const conns = await db.connection.findMany({ where: { businessId }, select: { channel: true, updatedAt: true } });
  if (!conns.length) return {};
  const last = await lastAttempts(businessId, conns.map((c) => c.channel));
  const out: Record<string, ReconnectInfo> = {};
  for (const c of conns) {
    const info = decideReconnect(last.get(c.channel), c.updatedAt);
    if (info) out[c.channel] = info;
  }
  return out;
}
