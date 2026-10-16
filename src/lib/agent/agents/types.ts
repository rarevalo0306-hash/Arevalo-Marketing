import type { AgentRun } from "@prisma/client";
import type { ModelConfig } from "../metered";
import type { AgentKey, PlanStep } from "../plan";
import type { StepResult } from "../queue";
import type { Context } from "../schema";
import type { ToolName, Tools } from "../tools";

/** What an agent receives to do one step. `model` is null only for an agent that does not use one. */
export type AgentInput = {
  run: AgentRun;
  step: PlanStep;
  context: Context;
  language: "es" | "en";
  model: ModelConfig | null;
  tools: Tools;
};

export type AgentDef = {
  key: Exclude<AgentKey, "matya">;
  label: { es: string; en: string };
  /** The only tools this agent may use (see `toolsFor`). */
  tools: readonly ToolName[];
  usesModel: boolean;
  run(input: AgentInput): Promise<StepResult>;
};
