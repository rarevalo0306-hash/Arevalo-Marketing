// El guardia del equipo: lo que decide, con reglas simples, si MATYA puede seguir enviando a un canal.
// Esta parte es pura (sin base de datos ni red). La lee `pieceLimits` para no proponer piezas a un canal frenado.

/**
 * Los canales cuyos **dos** últimos envíos del agente fallaron (`failed`): se frenan hasta que el dueño revise la conexión.
 * Cada canal se juzga por separado y cuentan los dos más nuevos por `createdAt`, sin importar el orden en que llegan.
 * Un solo envío (o un solo fallo) no frena; lo pendiente u omitido no cuenta como fallo. La lista sale ordenada y sin repetidos.
 */
export function brakedChannels(
  targets: { channel: string; status: string; createdAt: Date }[],
): string[] {
  const byChannel = new Map<string, { status: string; at: number }[]>();
  for (const t of targets) {
    const list = byChannel.get(t.channel) ?? [];
    list.push({ status: t.status, at: t.createdAt.getTime() });
    byChannel.set(t.channel, list);
  }
  const braked: string[] = [];
  for (const [channel, list] of byChannel) {
    // Newest first. Equal times keep the order they arrived in (a stable sort).
    const [last, before] = [...list].sort((a, b) => b.at - a.at);
    if (last?.status === "failed" && before?.status === "failed") braked.push(channel);
  }
  return braked.sort();
}
