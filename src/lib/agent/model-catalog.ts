// La lista de modelos que el dueño elige en «IA de cada agente»: el precio oficial de cada uno y para qué sirve. Solo modelos que
// responden directo, sin un paso de razonamiento: MATYA limita cada respuesta (MAX_OUTPUT en metered.ts) y, en los modelos que razonan,
// lo que piensan cuenta dentro de ese límite y puede dejar la respuesta cortada. Los precios son los de la página oficial de cada
// proveedor el día MODEL_PRICES_VERIFIED_AT; si uno cambia, se cambia aquí junto con la fecha. Sin servidor ni base de datos: la
// pantalla de configuración también la lee.
import type { ModelChoice } from "./schema";

/** El día en que se comprobaron todos los precios de la lista en la página de cada proveedor. */
export const MODEL_PRICES_VERIFIED_AT = "2026-10-16";

export type CatalogModel = {
  provider: ModelChoice["provider"];
  model: string;
  /** El nombre que ve el dueño. */
  name: string;
  /** Dólares por millón de tokens, como los publica el proveedor: lo que el agente lee (entrada) y lo que escribe (salida). */
  input: number;
  output: number;
  recommended?: true;
  /** Para qué sirve, en una frase. */
  use: { es: string; en: string };
};

export const MODEL_CATALOG: readonly CatalogModel[] = [
  {
    provider: "openai",
    model: "gpt-4.1-mini",
    name: "GPT-4.1 mini",
    input: 0.4,
    output: 1.6,
    recommended: true,
    use: {
      es: "Buena calidad a buen precio. Sirve para todos los agentes.",
      en: "Good quality at a good price. Works for every agent.",
    },
  },
  {
    provider: "openai",
    model: "gpt-4.1",
    name: "GPT-4.1",
    input: 2,
    output: 8,
    use: {
      es: "El que mejor escribe y decide de la lista, y cuesta unas 5 veces más. Úsalo en Redacción o en el Director si quieres más calidad.",
      en: "The best writer and decision-maker on the list, at about 5 times the price. Use it for Copywriting or the Director if you want more quality.",
    },
  },
  {
    provider: "openai",
    model: "gpt-4.1-nano",
    name: "GPT-4.1 nano",
    input: 0.1,
    output: 0.4,
    use: {
      es: "El más barato de OpenAI. Para tareas cortas y simples; para escribir o revisar lo que se publica, mejor GPT-4.1 mini.",
      en: "OpenAI's cheapest. For short, simple tasks; to write or review what gets published, GPT-4.1 mini is better.",
    },
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash-Lite",
    input: 0.1,
    output: 0.4,
    use: {
      es: "Muy barato y rápido, de Google. Sirve para SEO e investigación; para escribir lo que se publica, mejor GPT-4.1 mini.",
      en: "Very cheap and fast, from Google. Good for SEO and research; to write what gets published, GPT-4.1 mini is better.",
    },
  },
];

/** "provider:model", como se guardan los precios. */
export const catalogId = (m: { provider: string; model: string }) => `${m.provider}:${m.model}`;

/** El modelo de la lista con ese "provider:model", o undefined si no está en la lista. */
export function catalogEntry(id: string): CatalogModel | undefined {
  return MODEL_CATALOG.find((m) => catalogId(m) === id);
}

/** 0.4 → "$0.40", 2 → "$2.00": los precios de la lista, siempre con dos decimales. */
export const catalogUsd = (n: number) => `$${n.toFixed(2)}`;
