// Archivos de la biblioteca: la copia guardada de una foto o video de Drive. TODO (agente CORE): implementar.

/**
 * La dirección pública de la copia guardada del archivo (la crea si falta, por ejemplo los videos, que se copian
 * desde Drive solo cuando se usan). Lanza un error en palabras simples si no se puede.
 */
export async function ensureStoredCopy(itemId: string): Promise<string> {
  void itemId;
  throw new Error("not implemented");
}
