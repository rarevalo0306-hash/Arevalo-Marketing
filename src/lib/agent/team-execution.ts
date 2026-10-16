// Ejecuta un paso de un encargo del equipo (el propio equipo o una de sus piezas): lo hace un agente con su modelo
// y sus herramientas cerradas, o un manejador de MATYA (código del motor) registrado por el nombre del paso.
// El modelo de un paso se resuelve UNA vez, antes de reservar (`stepModel`, desde `stepCost`): se reserva el tope de una llamada
// de ese modelo y el agente llama con ese mismo modelo, a esa misma tarifa. Así lo cobrado nunca pasa de lo reservado.
import type { AgentRun } from "@prisma/client";
import { AgentError } from "./access";
import { agentFor, planStepOf, type AgentDef } from "./agents";
import { Refusal } from "./guard";
import type { ModelConfig } from "./metered";
import { resolveModel } from "./models";
import { isArticleStep } from "./plan";
import type { StepResult } from "./queue";
import { languageOf, type Context } from "./schema";
import { oneCall, Unspent } from "./spend";
import { toolsFor } from "./tools";

export type MatyaStepHandler = (
  run: AgentRun,
  stepId: string,
) => Promise<StepResult>;

const MATYA_STEPS = new Map<string, MatyaStepHandler>();

/** The step name without its rework round (`-r<n>`) or its wait number (`:<n>`). */
const baseOf = (stepId: string) =>
  stepId.replace(/:\d+$/, "").replace(/-r\d+$/, "");

/** Registers the code that does a step that has no agent (`dispatch`, `prepare`, `schedule`...), by its base name. */
export function registerMatyaStep(
  base: string,
  handler: MatyaStepHandler,
): void {
  MATYA_STEPS.set(base, handler);
}

/**
 * Whether the agent does this step with its own model (one paid call). The article writer is the exception: its draft pays
 * Google and the business's own AI, not the agent's model, and reserves its own estimate (`pieceStepCost`).
 */
const usesAgentModel = (def: AgentDef, stepId: string) =>
  def.usesModel && !isArticleStep(stepId);

/**
 * The model a team or piece step is reserved for and then called with, or null when no agent model does it (MATYA's own code,
 * the design and video agents, an article's draft). Resolved once, before anything is reserved: a missing price or key is a
 * `Refusal` with `resolveModel`'s own words, so the run ends blocked with nothing reserved or charged, and the agent never runs
 * on another model. What the step reserves for it is `callCeiling` of it, which is `agentCeiling(agent, ws)`.
 */
export function stepModel(
  run: Pick<AgentRun, "plan">,
  stepId: string,
  ws: { agentModels: unknown; modelPrices: unknown },
): ModelConfig | null {
  const def = agentFor(stepId, run.plan);
  if (!def || !usesAgentModel(def, stepId)) return null;
  try {
    return resolveModel(def.key, ws);
  } catch (e) {
    if (e instanceof AgentError) throw new Refusal(e.message, e.status);
    throw e;
  }
}

/**
 * Who does a step of a team or a piece and with which model, as `beginStep` records it: the agent of the plan (`matya` for the
 * engine's own steps), `"provider:model"` for a step done with a model (`""` otherwise) and the round. Undefined for any other
 * run: the old flows record what they always did.
 */
export function stepMeta(
  run: Pick<AgentRun, "kind" | "plan">,
  stepId: string,
  model?: ModelConfig | null,
): { agent: string; model: string; attempt: number } | undefined {
  if (run.kind !== "team" && run.kind !== "piece") return undefined;
  const step = planStepOf(stepId, run.plan);
  return {
    agent: step?.agent ?? "matya",
    model: model ? `${model.provider}:${model.model}` : "",
    attempt: step?.attempt ?? 0,
  };
}

/**
 * Does one step of a team or a piece. `reserved` is the model the step was reserved for (`stepModel`, through `stepCost`): an
 * agent that uses a model calls with exactly that one, and the model is never resolved a second time here. Without it such a
 * step does not run (an internal error, as an `Unspent`: nothing was called, so nothing is charged). A model step makes at most
 * one paid call, and if it fails before that call started the error comes out as an `Unspent` (`workOne` releases the
 * reservation).
 */
export async function executeTeamStep(
  run: AgentRun,
  stepId: string,
  reserved?: ModelConfig,
): Promise<StepResult> {
  const def = agentFor(stepId, run.plan);
  const step = planStepOf(stepId, run.plan);
  if (!def || !step) {
    const handler = MATYA_STEPS.get(baseOf(stepId));
    if (!handler) throw new AgentError("Paso no disponible.");
    return handler(run, stepId);
  }
  const usesModel = usesAgentModel(def, stepId);
  const model = usesModel ? (reserved ?? null) : null;
  if (usesModel && !model)
    throw new Unspent(
      "Error interno: el paso no recibió el modelo para el que se reservó. No se hizo ninguna llamada.",
    );
  const input = {
    run,
    step,
    context: run.context as unknown as Context,
    language: languageOf(run.prompt),
    model,
    tools: toolsFor(def, run),
  };
  return model ? oneCall(() => def.run(input)) : def.run(input);
}
