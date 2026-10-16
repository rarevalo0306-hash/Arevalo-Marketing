// Una sola llamada de pago en cada paso de un agente del equipo con modelo, y saber si el paso llegó a hacerla.
// El paso reservó el tope de UNA llamada (`agentCeiling`): una segunda nunca sale. Si el paso falla antes de empezar su llamada,
// no gastó nada: lo reservado se libera y el trabajo queda bloqueado (`failRun` con `unspent`), no "incierto", que es para un
// resultado que nadie conoce. Fuera de esos pasos (las campañas, los pasos de MATYA) esto no hace nada.
import { AsyncLocalStorage } from "node:async_hooks";
import { AgentError } from "./access";

/** A step that failed before it started any paid call: what it reserved was not spent, so it is released, not charged. */
export class Unspent extends AgentError {}

const step = new AsyncLocalStorage<{ calls: number }>();

/**
 * Called right before a paid request leaves (the provider's call in `meteredAsk`, a tool that pays someone). Inside `oneCall` it
 * counts that call and refuses a second one before it is sent: the step reserved what one call can cost at most. Outside it does
 * nothing.
 */
export function paidCall(): void {
  const current = step.getStore();
  if (!current) return;
  if (current.calls >= 1)
    throw new AgentError("Este paso ya hizo su llamada de pago: no se hizo otra.");
  current.calls++;
}

/**
 * Runs one team agent's model step: at most one paid call (`paidCall`), and a refusal (`AgentError`) raised before that call
 * started comes out as an `Unspent` with the same words, so the step's reservation is released. Anything raised after the call
 * started, or that is no `AgentError` (a bug), is passed on as it is: then what happened is not known and the reservation is kept.
 */
export async function oneCall<T>(fn: () => Promise<T>): Promise<T> {
  const current = { calls: 0 };
  try {
    return await step.run(current, fn);
  } catch (error) {
    if (current.calls === 0 && error instanceof AgentError && !(error instanceof Unspent))
      throw new Unspent(error.message, error.status);
    throw error;
  }
}
