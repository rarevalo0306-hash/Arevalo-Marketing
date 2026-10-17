// Leer los números que escribe el dueño en la configuración del Centro MATYA (límites en dólares, publicaciones al día,
// horas). Vacío o con letras devuelve null: nunca se convierte en cero sin que el dueño lo escriba.
import { parseMoney } from "@/lib/ads-shape";
import { catalogEntry } from "@/lib/agent/model-catalog";
import type { Settings } from "@/lib/agent/schema";
import type { TeamAgentView } from "@/lib/agent/team-view";

/** "5", "1.50", "2,5" (coma decimal), "$12.50" o "1,000" → centavos; null si no es una cantidad válida. */
export function readUsd(text: string): number | null {
  const s = text.trim();
  if (!s) return null;
  // Una coma seguida de 1 o 2 cifras al final es la coma decimal ("2,5" = 2.50); con 3 cifras es de miles ("1,000").
  return parseMoney(/^\$?\d+,\d{1,2}$/.test(s) ? s.replace(",", ".") : s);
}

/** "4" → 4; null si está vacío, tiene decimales o letras. */
export function readCount(text: string): number | null {
  const s = text.trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** Centavos → "5.00" (lo que se muestra en el campo). */
export const formatUsd = (cents: number) => (Math.max(0, Math.round(cents)) / 100).toFixed(2);

/** The most a price per million tokens can be, per side: the same limits as `ModelPrice` in the schema (a test keeps them equal). */
export const RATE_MAX = { input: 1000, output: 2000 } as const;

/**
 * "0.15", "2,5" (coma decimal) o "$3" → dólares por millón de tokens, con hasta 4 decimales; null si está vacío, tiene letras,
 * es cero o pasa de 2000. Una coma es siempre la coma decimal: aquí no hay separador de miles.
 */
export function readRate(text: string): number | null {
  let s = text.trim().replace(/^\$\s*/, "");
  if (/^[^,]*,[^,.]*$/.test(s)) s = s.replace(",", ".");
  if (!/^(?:\d+(?:\.\d{1,4})?|\.\d{1,4})$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 2000 ? n : null;
}

/** Un precio de un lado (entrada o salida) dentro de lo que el servidor guarda; null si no lo es. */
export function readPrice(text: string, side: keyof typeof RATE_MAX): number | null {
  const n = readRate(text);
  return n !== null && n <= RATE_MAX[side] ? n : null;
}

/** Un precio sin ceros de sobra: 0.15 → "0.15", 3 → "3". */
export const formatRate = (n: number) => String(Number(n.toFixed(4)));

/** El nombre de un modelo como lo acepta el esquema (letras, números y . _ : -, hasta 100), sin los espacios de los lados; null si no sirve. */
export function readModelName(text: string): string | null {
  const s = text.trim();
  return /^[a-zA-Z0-9_.:-]{1,100}$/.test(s) ? s : null;
}

/** El modelo elegido para un agente (null lo quita: vuelve al modelo por defecto). No toca el objeto que recibe. */
export function setAgentModel(
  models: Settings["agentModels"],
  agent: string,
  choice: { provider: string; model: string } | null,
): Settings["agentModels"] {
  const next: Record<string, { provider: string; model: string }> = { ...models };
  if (choice) next[agent] = { provider: choice.provider, model: choice.model };
  else delete next[agent];
  return next as Settings["agentModels"];
}

/**
 * Los precios de los modelos que algún agente usa: los elegidos en `models` y el modelo por defecto (`defaults`, el que usan los agentes
 * sin modelo propio, ver `defaultModelIds`), cuyo precio guardado manda sobre el de las variables MATYA_AGENT_*. Los de modelos que
 * ya nadie usa se van al guardar, y también los de los modelos de la lista (model-catalog.ts): esos usan el precio oficial, que la
 * pantalla no deja escribir, y uno guardado de antes no debe quedar mandando sin verse.
 */
export function pruneModelPrices(
  prices: Settings["modelPrices"],
  models: Settings["agentModels"],
  defaults: readonly string[] = [],
): Settings["modelPrices"] {
  const used = new Set([...Object.values(models).map((m) => `${m.provider}:${m.model}`), ...defaults]);
  return Object.fromEntries(Object.entries(prices).filter(([id]) => used.has(id) && !catalogEntry(id)));
}

/** The default model (`provider:model`) as the team's view shows it: the model of each agent that calls an AI with no model of its own. */
export function defaultModelIds(agents: readonly TeamAgentView[] | undefined): string[] {
  return [...new Set((agents ?? []).filter((a) => a.usesModel && !a.own && a.model).map((a) => a.model))];
}

/**
 * What submitting the settings form does (a click on «Guardar» or Enter in a field). Something marked: nothing is saved and the
 * fields that stayed quiet until touched say what is wrong. A request already running: nothing at all (no second save).
 */
export function submitDecision(invalid: readonly string[], busy: boolean): { save: boolean; reveal: boolean } {
  if (busy) return { save: false, reveal: false };
  return invalid.length ? { save: false, reveal: true } : { save: true, reveal: false };
}
