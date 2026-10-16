// Los siete agentes del equipo. Cada uno trabaja con sus herramientas cerradas y, si las usa, con su propio modelo.
import { AgentError } from "../access";
import type { AgentKey, PlanStep } from "../plan";
import type { StepResult } from "../queue";
import { runCopy } from "./copy";
import { runDesign } from "./design";
import { runDirector } from "./director";
import { runReview } from "./review";
import { runSeo } from "./seo";
import { runStrategy } from "./strategy";
import type { AgentDef } from "./types";

export type { AgentDef, AgentInput } from "./types";

/** Placeholder until each agent exists (video). */
const unavailable = async (): Promise<StepResult> => {
  throw new AgentError("Agente no disponible.");
};

export const AGENTS: Record<Exclude<AgentKey, "matya">, AgentDef> = {
  director: {
    key: "director",
    label: { es: "Director", en: "Director" },
    tools: ["readContext", "readSignals", "readCalendar"],
    usesModel: true,
    run: runDirector,
  },
  seo: {
    key: "seo",
    label: { es: "SEO e investigación", en: "SEO and research" },
    tools: ["readContext", "readSeoReports"],
    usesModel: true,
    run: runSeo,
  },
  strategy: {
    key: "strategy",
    label: { es: "Estrategia de contenido", en: "Content strategy" },
    tools: ["readContext", "readStepOutput", "readCalendar"],
    usesModel: true,
    run: runStrategy,
  },
  copy: {
    key: "copy",
    label: { es: "Redacción", en: "Copywriting" },
    tools: ["readContext", "readStepOutput", "channelRules", "writeArticle"],
    usesModel: true,
    run: runCopy,
  },
  design: {
    key: "design",
    label: { es: "Diseño", en: "Design" },
    tools: [
      "readContext",
      "readStepOutput",
      "brandKit",
      "listLibrary",
      "renderDesign",
    ],
    // The design step makes no AI call: the library, the brand's templates and the stored image.
    usesModel: false,
    run: runDesign,
  },
  video: {
    key: "video",
    label: { es: "Video", en: "Video" },
    tools: ["readContext", "readStepOutput", "listLibrary", "videoQuote"],
    usesModel: true,
    run: unavailable,
  },
  review: {
    key: "review",
    label: { es: "Revisión editorial", en: "Editorial review" },
    tools: ["readContext", "readStepOutput", "channelRules", "readCalendar"],
    usesModel: true,
    run: runReview,
  },
};

/** Who does each step of the team's own plan; `matya` = plain code of the engine. */
const TEAM_AGENT: Readonly<Record<string, AgentKey>> = {
  plan: "director",
  research: "seo",
  strategy: "strategy",
  dispatch: "matya",
};

/** The plan step of a stored plan (raw JSON from the database) for a step id, or null. Never throws. */
export function planStepOf(stepId: string, plan: unknown): PlanStep | null {
  try {
    if (typeof plan !== "object" || plan === null || Array.isArray(plan))
      return null;
    const { kind, steps } = plan as { kind?: unknown; steps?: unknown };
    if (kind === "team")
      return Object.hasOwn(TEAM_AGENT, stepId)
        ? { id: stepId, agent: TEAM_AGENT[stepId], attempt: 0 }
        : null;
    if (kind !== "piece" || !Array.isArray(steps)) return null;
    // The exact id first; then the step without its `:<n>` (the n-th wait of a video).
    for (const id of [stepId, stepId.replace(/:\d+$/, "")]) {
      for (const s of steps) {
        if (typeof s !== "object" || s === null || s.id !== id) continue;
        return {
          id: stepId,
          agent: typeof s.agent === "string" ? (s.agent as AgentKey) : "matya",
          attempt:
            Number.isSafeInteger(s.attempt) && s.attempt >= 0 ? s.attempt : 0,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** The agent that does this step of a stored plan, or null when MATYA's own code does it (or the plan is unreadable). */
export function agentFor(stepId: string, plan: unknown): AgentDef | null {
  const agent = planStepOf(stepId, plan)?.agent;
  return agent !== undefined && Object.hasOwn(AGENTS, agent)
    ? AGENTS[agent as keyof typeof AGENTS]
    : null;
}
