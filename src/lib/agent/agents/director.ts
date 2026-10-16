// El Director: lee el encargo (o las señales de la mañana) y decide el objetivo y cuántas piezas hacen falta.
// Una sola llamada pagada. Si el encargo era una pregunta, la responde y el encargo termina aquí.
import { z } from "zod";
import { AgentError } from "../access";
import { boundedContext, boundedJson } from "../bounded-context";
import { meteredAsk } from "../metered";
import { SYSTEM } from "../prompts";
import type { StepResult } from "../queue";
import type { Context } from "../schema";
import type { AgentInput } from "./types";

export const DirectorPlan = z.object({
  reply: z.string().max(4000).default(""),
  goal: z.string().max(500),
  maxPieces: z.number().int().min(0).max(12),
});
export type DirectorPlan = z.infer<typeof DirectorPlan>;

/** Most characters of the morning signals sent to the model. */
const SIGNALS_MAX = 6000;

const instructions = (language: "es" | "en") =>
  SYSTEM +
  " You are the director of the marketing team. Decide the goal of this request and how many pieces of content the team must make (maxPieces, 0 to 12)." +
  " If the request is a question, answer it in reply and use maxPieces 0; otherwise leave reply empty." +
  ' If "signals" is given (yesterday\'s results, empty days, pending work, rank drops, what is left of today\'s budget and posts), plan from it and never ask for more pieces than signals.remaining.posts.' +
  " If nothing is worth doing, explain why in reply and use maxPieces 0." +
  ` Write goal and reply in ${language === "en" ? "English" : "Spanish"}.`;

/** The `plan` step of a team run. */
export async function runDirector(input: AgentInput): Promise<StepResult> {
  if (!input.model)
    throw new AgentError("Falta configurar el modelo del Director.");
  // The morning signals come with the run (the daily plan puts them in its context), already collected by the server.
  const signals = boundedJson(
    (input.run.context as { signals?: unknown } | null)?.signals,
    SIGNALS_MAX,
  );
  const context: Context & { signals?: unknown } = { ...input.context };
  delete context.signals;
  const r = await meteredAsk(
    DirectorPlan,
    instructions(input.language),
    {
      context: boundedContext(context),
      request: input.run.prompt,
      ...(signals === undefined ? {} : { signals }),
    },
    input.model,
  );
  const data = { ...r.value, usage: r.usage };
  const reply = r.value.reply.trim();
  // A question: the answer is the whole job.
  if (reply && r.value.maxPieces === 0)
    return { data, cents: r.usage.cents, text: reply, state: "completed" };
  return { data, cents: r.usage.cents };
}
