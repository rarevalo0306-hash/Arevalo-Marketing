import type { z } from "zod";
import { AgentError } from "./access";
import { callCeiling, keyFor, modelConfig, type ModelConfig } from "./metered";
import { AgentKeyEnum, ModelChoice, ModelPrice } from "./schema";

type Agent = z.infer<typeof AgentKeyEnum>;
type Env = Record<string, string | undefined>;
type Rates = { input: number; output: number };

/**
 * Prices verified on the provider's official page, per million tokens in US dollars.
 * Key: "provider:model". Only prices checked that day belong here (`verifiedAt`, ISO date);
 * when they cannot be verified the table stays empty and the owner sets them in the settings.
 */
export const PRICE_TABLE: Record<
  string,
  { input: number; output: number; verifiedAt: string }
> = {};

function entry(raw: unknown, key: string): unknown {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)[key]
    : undefined;
}

/** Price order: the business's own, then the verified table, then the MATYA_AGENT_* rates of that same model. */
function priceFor(id: string, prices: unknown, env: Env): Rates | undefined {
  const own = ModelPrice.safeParse(entry(prices, id));
  if (own.success) return own.data;
  const table = PRICE_TABLE[id];
  if (table) return table;
  if (id !== `${env.MATYA_AGENT_PROVIDER}:${env.MATYA_AGENT_MODEL}`) return;
  const rates = ModelPrice.safeParse({
    input: Number(env.MATYA_AGENT_INPUT_USD_PER_MILLION),
    output: Number(env.MATYA_AGENT_OUTPUT_USD_PER_MILLION),
  });
  return rates.success ? rates.data : undefined;
}

/**
 * The model, price and key one agent call uses. The agent's own choice, or the
 * MATYA_AGENT_* model when it has none (or an invalid one). Without a verified
 * price or without the provider's key the agent does not work: it never falls
 * back to another model or provider.
 */
export function resolveModel(
  agent: Agent,
  ws: { agentModels: unknown; modelPrices: unknown },
  env: Env = process.env,
): ModelConfig {
  const choice =
    ModelChoice.safeParse(entry(ws.agentModels, agent)).data ??
    ModelChoice.safeParse({
      provider: env.MATYA_AGENT_PROVIDER,
      model: env.MATYA_AGENT_MODEL,
    }).data;
  // Neither a choice nor a usable default model: modelConfig raises the usual setup error.
  if (!choice) return modelConfig(env);
  const id = `${choice.provider}:${choice.model}`;
  const price = priceFor(id, ws.modelPrices, env);
  if (!price)
    throw new AgentError(
      `Falta el precio verificado del modelo ${id} para el agente ${agent}.`,
    );
  const key = keyFor(choice.provider, env);
  if (!key) throw new AgentError(`Falta la conexión del modelo de ${agent}.`);
  return { ...choice, inputRate: price.input, outputRate: price.output, key };
}

/** Most an agent call can cost, in cents (what the budget reserves before the call). */
export function agentCeiling(
  agent: Agent,
  ws: { agentModels: unknown; modelPrices: unknown },
  env: Env = process.env,
) {
  return callCeiling(resolveModel(agent, ws, env));
}
