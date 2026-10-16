// El guardia del equipo: lo que decide, con reglas simples, si MATYA puede seguir enviando a un canal.
// Esta parte es pura (sin base de datos ni red). La lee `pieceLimits` para no proponer piezas a un canal frenado.

/**
 * Los canales cuyos **dos** últimos envíos del agente fallaron (`failed`): se frenan hasta que el dueño revise la conexión.
 * Cada canal se juzga por separado y cuentan los dos más nuevos por `createdAt` (el momento del envío: quien llama pasa la hora
 * programada de la publicación), sin importar el orden en que llegan. Un solo envío (o un solo fallo) no frena; lo pendiente u
 * omitido no cuenta como fallo. La lista sale ordenada y sin repetidos.
 *
 * `reconnectedAt`: cuándo se guardó por última vez la conexión de cada canal (`Connection.updatedAt`). El freno solo mira los
 * envíos **posteriores** a esa fecha: lo que pasó en ese momento o antes ya no cuenta. Así, reconectar libera el canal, un
 * solo fallo nuevo no lo frena otra vez y dos fallos nuevos seguidos sí. Sin fecha, se miran todos los envíos.
 * Importante: esa fecha solo la mueve un guardado del dueño. Los procesos de fondo que reescriben una conexión (como
 * `writeConnection` en `google-data.ts`) conservan `updatedAt` a propósito; quien agregue otro escritor debe hacer lo mismo,
 * o un refresco automático liberaría un canal que sigue fallando.
 */
export function brakedChannels(
  targets: { channel: string; status: string; createdAt: Date }[],
  reconnectedAt: Record<string, Date | undefined> = {},
): string[] {
  const byChannel = new Map<string, { status: string; at: number }[]>();
  for (const t of targets) {
    const list = byChannel.get(t.channel) ?? [];
    list.push({ status: t.status, at: t.createdAt.getTime() });
    byChannel.set(t.channel, list);
  }
  const braked: string[] = [];
  for (const [channel, list] of byChannel) {
    // Only what happened after the owner last saved the connection counts (a missing or invalid date counts everything).
    const saved = Object.hasOwn(reconnectedAt, channel) ? reconnectedAt[channel]?.getTime() : undefined;
    const since = saved === undefined || Number.isNaN(saved) ? -Infinity : saved;
    // Newest first. Equal times keep the order they arrived in (a stable sort).
    const [last, before] = list.filter((d) => d.at > since).sort((a, b) => b.at - a.at);
    if (last?.status === "failed" && before?.status === "failed") braked.push(channel);
  }
  return braked.sort();
}
