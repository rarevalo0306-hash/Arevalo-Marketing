// Ejecuta un paso de un encargo del equipo (el propio equipo o una de sus piezas): lo hace un agente con su modelo
// y sus herramientas cerradas, o un manejador de MATYA (código del motor) registrado por el nombre del paso.
import type { AgentRun } from "@prisma/client";
import { db } from "@/lib/db";
import { AgentError } from "./access";
import { agentFor, planStepOf } from "./agents";
import { resolveModel } from "./models";
import { isArticleStep } from "./plan";
import type { StepResult } from "./queue";
import { languageOf, type Context } from "./schema";
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

export async function executeTeamStep(
  run: AgentRun,
  stepId: string,
): Promise<StepResult> {
  const def = agentFor(stepId, run.plan);
  const step = planStepOf(stepId, run.plan);
  if (!def || !step) {
    const handler = MATYA_STEPS.get(baseOf(stepId));
    if (!handler) throw new AgentError("Paso no disponible.");
    return handler(run, stepId);
  }
  // A missing price or connection raises its own AgentError: the agent never runs on another model.
  // The article writer is the exception: it pays Google and the business's own AI, not the agent's model.
  const model = def.usesModel && !isArticleStep(stepId)
    ? resolveModel(
        def.key,
        await db.agentWorkspace.findUniqueOrThrow({
          where: { businessId: run.businessId },
        }),
      )
    : null;
  return def.run({
    run,
    step,
    context: run.context as unknown as Context,
    language: languageOf(run.prompt),
    model,
    tools: toolsFor(def, run),
  });
}
