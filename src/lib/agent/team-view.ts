// La vista del equipo: en qué columna del tablero está cada encargo, cómo va y qué espera del dueño.
// Módulo puro y seguro para el cliente: sin base de datos, sin red y sin el registro de agentes (`agents/index`, solo del servidor).
// Lo consumen las pantallas Hoy y Equipo, los emails de alerta y la sección del reporte diario; `loadTeamRuns` (team-load.ts) lo llena.
import { TEAM_STEPS, isArticleStep, problemsOf, stepsOfPlan } from "./plan";

export type TeamStepView = {
  name: string;
  /** The agent key that did the step ("" in old runs, "matya" for plain code). */
  agent: string;
  /** `provider:model` of the AI call, or "". */
  model: string;
  attempt: number;
  status: string;
  output: Record<string, unknown> | null;
  error: string;
  chargedCents: number;
  createdAt: string;
  finishedAt: string | null;
};
export type TeamRunView = {
  id: string;
  kind: "team" | "piece";
  origin: string;
  parentRunId: string | null;
  status: string;
  stage: number;
  /** The stored plan, raw: read it with `stepsOfPlan` / `pieceInfo`, never trust its shape. */
  plan: unknown;
  error: string;
  chargedCents: number;
  createdAt: string;
  /** The run's last `assistant` message: what the owner reads while it waits ("" if none). */
  message: string;
  steps: TeamStepView[];
};
export type TeamAgentView = {
  key: string;
  label: { es: string; en: string };
  usesModel: boolean;
  /** `provider:model` the agent works with (its own choice or the MATYA_AGENT_* default); "" when it makes no AI call. */
  model: string;
  /** The business chose a model for this agent (otherwise it uses the default). */
  own: boolean;
  ready: boolean;
  /** Why the agent cannot work yet (the setup message), or "". */
  problem: string;
  /** Today's steps and what they cost, in the business's local day. */
  steps: number;
  cents: number;
};
export type TeamSnapshot = { today: string; tz: string; runs: TeamRunView[]; agents: TeamAgentView[] };

export const BOARD_COLUMNS = ["investigacion", "estrategia", "redaccion", "diseno", "revision", "programada", "publicada"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];
export type BoardState = "working" | "waiting" | "attention" | "done" | "cancelled";

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** The step the run is at (`plan.steps[stage].id`, or the team's fixed step), or null past the end of the plan or when it cannot be read. */
export function currentStepId(run: TeamRunView): string | null {
  return stepsOfPlan(run.plan)?.[run.stage] ?? null;
}

/** A step without its round (`-r<n>`) or its wait number (`:<n>`): `copy-r2` is `copy`, `video_wait:3` is `video_wait`. */
const baseOf = (stepId: string) => stepId.replace(/-r\d+$/, "").replace(/:\d+$/, "");

const COLUMN_OF: Readonly<Record<string, BoardColumn>> = {
  copy: "redaccion",
  article: "redaccion",
  design: "diseno",
  video: "diseno",
  render: "diseno",
  video_wait: "diseno",
  review: "revision",
  prepare: "programada",
  schedule: "programada",
  article_publish: "programada",
  verify: "programada",
};
/** The steps that wait for the owner's go-ahead to publish: a piece parked there is being reviewed by the owner. */
const PUBLISH_STEPS: ReadonlySet<string> = new Set(["prepare", "schedule", "article_publish"]);

function pieceColumn(stepId: string, waiting: boolean): BoardColumn {
  const base = baseOf(stepId);
  if (waiting && PUBLISH_STEPS.has(base)) return "revision";
  // An id this view does not know (a newer step, a damaged plan) is shown where the piece starts.
  return Object.hasOwn(COLUMN_OF, base) ? COLUMN_OF[base] : "redaccion";
}

/**
 * The column a run sits in. A team run is in `investigacion` while it plans and researches, and in `estrategia` from there on
 * (and once it finished). A piece follows its current step; one parked for the owner at a publishing step is in `revision`; one
 * that ran its whole plan and completed is `publicada`; one with a plan we cannot read starts over in `redaccion`.
 */
export function boardColumn(run: TeamRunView): BoardColumn {
  const id = currentStepId(run);
  if (run.kind === "team") return id === TEAM_STEPS[0] || id === TEAM_STEPS[1] ? "investigacion" : "estrategia";
  if (id !== null) return pieceColumn(id, run.status === "waiting_approval");
  const ids = stepsOfPlan(run.plan);
  if (!ids) return "redaccion";
  // The stage is past the end: done, or stopped after its last step (then it stays where that step is).
  return run.status === "completed" ? "publicada" : pieceColumn(ids[ids.length - 1], false);
}

/** How a run is doing. A status this view does not know asks for attention rather than passing as work. */
export function boardState(run: TeamRunView): BoardState {
  switch (run.status) {
    case "queued":
    case "running":
    case "waiting_provider":
      return "working";
    case "waiting_approval":
      return "waiting";
    case "completed":
      return "done";
    case "cancelled":
      return "cancelled";
    default:
      return "attention";
  }
}

/**
 * Whether the team has work going on, for the screen that polls: `pending` is any run in `queued`, `running` or `waiting_provider`
 * (the pieces of a team request are runs of their own, and the request itself completes as soon as it has spawned them);
 * `running` is a run that is working at this moment.
 */
export function teamWorking(team: TeamSnapshot | null): { pending: boolean; running: boolean } {
  const runs = team?.runs ?? [];
  return {
    pending: runs.some((r) => boardState(r) === "working"),
    running: runs.some((r) => r.status === "running"),
  };
}

/** The tick is the worker's once-a-minute call: past this age it is not running. */
export const TICK_STALE_MS = 10 * 60_000;

/**
 * Whether the once-a-minute call is not running: a missing, unreadable or old tick. Both times come from the server (the tick
 * and the moment the snapshot was taken), so the owner's own clock can neither hide the warning nor fake it.
 */
export function isTickStale(capturedAt: string, tickAt: string | null | undefined): boolean {
  const age = tickAt ? Date.parse(capturedAt) - Date.parse(tickAt) : Number.NaN;
  return !(age <= TICK_STALE_MS);
}

export type NeedKind = "video" | "articulo" | "revision" | "publicar";
export type NeedItem = {
  runId: string;
  kind: NeedKind;
  topic: string;
  text: string;
  problems: { kind: string; detail: string }[];
  canRedo: boolean;
};

/** The topic, format and channels of the piece a run makes, or null for a team run or a plan with no readable piece. */
export function pieceInfo(run: TeamRunView): { topic: string; format: string; channels: string[] } | null {
  const piece = asObject(asObject(run.plan)?.piece);
  if (!piece || typeof piece.topic !== "string") return null;
  return {
    topic: piece.topic,
    format: typeof piece.format === "string" ? piece.format : "",
    channels: Array.isArray(piece.channels) ? piece.channels.filter((c): c is string => typeof c === "string") : [],
  };
}

const REVIEW_STEP = /^review(-r\d+)?$/;
/** A pass of an article's publication: the first keeps the step's name, every later one adds `:<n>`. */
const PUBLISH_PASS = /^article_publish(:\d+)?$/;

/** What a team run is about: the goal the director wrote in its `plan` step. */
function goalOf(run: TeamRunView): string {
  const goal = asObject(run.steps.find((s) => s.name === "plan")?.output)?.goal;
  return typeof goal === "string" ? goal : "";
}

function needOf(run: TeamRunView): NeedItem {
  const ids = stepsOfPlan(run.plan);
  const waiting = ids?.[run.stage] ?? null;
  const before = ids && run.stage > 0 ? (ids[run.stage - 1] ?? null) : null;
  const reviews = run.steps.filter((s) => REVIEW_STEP.test(s.name) && s.status === "succeeded");
  const last = run.steps[run.steps.length - 1];
  const failed =
    before !== null &&
    REVIEW_STEP.test(before) &&
    asObject(run.steps.find((s) => s.name === before)?.output)?.approved === false;
  // An article that already prepared its website version and waits again at its publication is waiting for the photo's price.
  const photo = waiting === "article_publish" && last !== undefined && last.status === "succeeded" && PUBLISH_PASS.test(last.name);
  const kind: NeedKind =
    waiting === "render"
      ? "video"
      : (waiting !== null && isArticleStep(waiting)) || photo
        ? "articulo"
        : failed
          ? "revision"
          : "publicar";
  return {
    runId: run.id,
    kind,
    topic: pieceInfo(run)?.topic ?? goalOf(run),
    text: run.message,
    problems: problemsOf(reviews[reviews.length - 1]?.output).map(({ kind, detail }) => ({ kind, detail })),
    // The rule of `redo`: the step before is a review and the one waiting is not a paid article draft.
    canRedo: before !== null && REVIEW_STEP.test(before) && !(waiting !== null && isArticleStep(waiting)),
  };
}

const time = (iso: string) => Date.parse(iso) || 0;

/** What waits for the owner: the runs in `waiting_approval`, oldest first, each with the kind of go-ahead it needs. */
export function needsYou(runs: TeamRunView[]): NeedItem[] {
  return runs
    .filter((r) => r.status === "waiting_approval")
    .sort((a, b) => time(a.createdAt) - time(b.createdAt))
    .map(needOf);
}
