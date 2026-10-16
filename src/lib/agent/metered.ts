import { z } from "zod";
import { AgentError } from "./access";

export type ModelConfig = {
  provider: "openai" | "claude" | "gemini";
  model: string;
  inputRate: number;
  outputRate: number;
  key: string;
};
export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cents: number;
  model: string;
};
const Env = z.object({
  provider: z.enum(["openai", "claude", "gemini"]),
  model: z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),
  inputRate: z.coerce.number().positive().max(1000),
  outputRate: z.coerce.number().positive().max(2000),
});
export function modelConfig(env: Record<string, string | undefined> = process.env): ModelConfig {
  const parsed = Env.safeParse({
    provider: env.MATYA_AGENT_PROVIDER,
    model: env.MATYA_AGENT_MODEL,
    inputRate: env.MATYA_AGENT_INPUT_USD_PER_MILLION,
    outputRate: env.MATYA_AGENT_OUTPUT_USD_PER_MILLION,
  });
  if (!parsed.success)
    throw new AgentError(
      "Falta configurar el modelo y sus tarifas verificadas para MATYA. El resumen de actividad sigue disponible.",
    );
  const p = parsed.data;
  const key = keyFor(p.provider, env);
  if (!key) throw new AgentError("Falta la conexión del modelo de MATYA.");
  return { ...p, key };
}
/** The API key of a provider, or undefined when it is not connected. */
export function keyFor(
  provider: ModelConfig["provider"],
  env: Record<string, string | undefined>,
) {
  return env[
    provider === "openai"
      ? "OPENAI_API_KEY"
      : provider === "claude"
        ? "ANTHROPIC_API_KEY"
        : "GEMINI_API_KEY"
  ];
}
export function usageCents(
  c: Pick<ModelConfig, "inputRate" | "outputRate">,
  input: number,
  output: number,
) {
  return Math.ceil((input * c.inputRate + output * c.outputRate) / 10000);
}
export const MAX_OUTPUT = 3000;
export const MAX_PROMPT_BYTES = 32000;
export function callCeiling(c: ModelConfig) {
  return usageCents(c, MAX_PROMPT_BYTES + 4096, MAX_OUTPUT);
}

/** The two texts of a call: the instruction (system + the schema the answer must match) and the user message (the context as JSON). */
function promptTexts(schema: z.ZodType, system: string, context: unknown) {
  const shape = JSON.stringify(z.toJSONSchema(schema));
  return {
    instruction: system + "\nReturn ONLY valid JSON matching this schema: " + shape,
    user: JSON.stringify(context),
  };
}
/**
 * The bytes `meteredAsk` measures against `MAX_PROMPT_BYTES`: the system text, the schema it appends and the context.
 * An agent measures with this before the call (see `fitPayload`), so what it sends is never refused for its size.
 */
export function promptBytes(schema: z.ZodType, system: string, context: unknown): number {
  const { instruction, user } = promptTexts(schema, system, context);
  return Buffer.byteLength(instruction + user);
}

/** Exactly one provider request. Never silently retry/fall back a potentially billable call. */
export async function meteredAsk<T extends z.ZodType>(
  schema: T,
  system: string,
  context: unknown,
  config = modelConfig(),
): Promise<{ value: z.infer<T>; usage: Usage }> {
  const { instruction, user } = promptTexts(schema, system, context);
  if (Buffer.byteLength(instruction + user) > MAX_PROMPT_BYTES)
    throw new AgentError(
      "El contexto supera el límite de esta tarea. Reduce el encargo.",
    );
  let url: string;
  let headers: Record<string, string>;
  let body: unknown;
  if (config.provider === "openai") {
    url = "https://api.openai.com/v1/chat/completions";
    headers = { Authorization: `Bearer ${config.key}` };
    body = {
      model: config.model,
      max_completion_tokens: MAX_OUTPUT,
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    };
  } else if (config.provider === "claude") {
    url = "https://api.anthropic.com/v1/messages";
    headers = { "x-api-key": config.key, "anthropic-version": "2023-06-01" };
    body = {
      model: config.model,
      max_tokens: MAX_OUTPUT,
      system: instruction,
      messages: [{ role: "user", content: user }],
    };
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
    headers = { "x-goog-api-key": config.key };
    body = {
      systemInstruction: { parts: [{ text: instruction }] },
      contents: [{ parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT,
        responseMimeType: "application/json",
      },
    };
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(65000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new AgentError(
      `El proveedor de IA respondió ${response.status}. El trabajo se detuvo sin reintentar el cargo.`,
    );
  const data = await response.json();
  let text: string;
  let input: number;
  let output: number;
  if (config.provider === "openai") {
    text = data.choices?.[0]?.message?.content ?? "";
    input = data.usage?.prompt_tokens;
    output = data.usage?.completion_tokens;
  } else if (config.provider === "claude") {
    text =
      data.content
        ?.filter((x: { type: string }) => x.type === "text")
        .map((x: { text: string }) => x.text)
        .join("") ?? "";
    input = data.usage?.input_tokens;
    output = data.usage?.output_tokens;
  } else {
    text =
      data.candidates?.[0]?.content?.parts
        ?.map((x: { text?: string }) => x.text ?? "")
        .join("") ?? "";
    input = data.usageMetadata?.promptTokenCount;
    output =
      (data.usageMetadata?.candidatesTokenCount ?? Number.NaN) +
      (data.usageMetadata?.thoughtsTokenCount ?? 0);
  }
  if (
    !Number.isInteger(input) ||
    input < 0 ||
    !Number.isInteger(output) ||
    output < 0 ||
    text.length > 50000
  )
    throw new AgentError(
      "El proveedor no devolvió un consumo verificable. Se conserva la reserva hasta revisar el resultado.",
    );
  const value = schema.parse(
    JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")),
  );
  return {
    value,
    usage: {
      inputTokens: input,
      outputTokens: output,
      cents: usageCents(config, input, output),
      model: config.model,
    },
  };
}
