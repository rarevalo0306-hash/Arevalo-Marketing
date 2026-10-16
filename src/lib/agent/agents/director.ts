// El Director: lee el encargo (o las señales de la mañana) y decide el objetivo y cuántas piezas hacen falta.
// Una sola llamada pagada. Si no hacen falta piezas (una pregunta, o nada que valga la pena), el encargo termina aquí con un texto.
import { z } from "zod";
import { AgentError } from "../access";
import {
  boundedContext,
  boundedJson,
  contextShrinks,
  contextWithout,
  fitPayload,
  shrinkKey,
  type BoundedContext,
  type Shrink,
} from "../bounded-context";
import { meteredAsk, promptBytes } from "../metered";
import { SYSTEM } from "../prompts";
import type { StepResult } from "../queue";
import type { AgentInput } from "./types";

export const DirectorPlan = z.object({
  reply: z.string().max(4000).default(""),
  goal: z.string().max(500),
  maxPieces: z.number().int().min(0).max(12),
});
export type DirectorPlan = z.infer<typeof DirectorPlan>;

/** What the owner reads when the plan needs no pieces and the model gave no text. */
const NOTHING_NEEDED = {
  es: "No hace falta contenido nuevo por ahora.",
  en: "No new content is needed right now.",
} as const;

/** Signals that are never cut: how much budget and how many posts are left bounds what the plan may ask for. */
const KEEP_SIGNALS = new Set(["remaining"]);
/** Most items kept of each list in the signals, and most characters of each text in them, before anything is measured. */
const SIGNALS_ITEMS = 30;
const SIGNALS_TEXT = 300;
/** Items of each list in the signals that survive the first round of trimming. */
const SIGNALS_FLOOR = 5;

const instructions = (language: "es" | "en") =>
  SYSTEM +
  " You are the director of the marketing team. Decide the goal of this request and how many pieces of content the team must make (maxPieces, 0 to 12)." +
  " If the request is a question, answer it in reply and use maxPieces 0; otherwise leave reply empty." +
  ' If "signals" is given (yesterday\'s results, empty days, pending work, rank drops, what is left of today\'s budget and posts), plan from it and never ask for more pieces than signals.remaining.posts.' +
  " If nothing is worth doing, explain why in reply and use maxPieces 0." +
  ` Write goal and reply in ${language === "en" ? "English" : "Spanish"}.`;

type Payload = { signals?: unknown; request: string; context: BoundedContext };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The morning signals with each list and text cut to a sane size, by key: what must stay (`remaining`) is left as it is. */
function capSignals(signals: unknown): unknown {
  if (!isObject(signals)) return boundedJson(signals, 4000);
  return Object.fromEntries(
    Object.entries(signals).map(([key, value]) => [
      key,
      KEEP_SIGNALS.has(key) || !Array.isArray(value)
        ? value
        : value
            .slice(0, SIGNALS_ITEMS)
            .map((x) => (typeof x === "string" ? x.slice(0, SIGNALS_TEXT) : x)),
    ]),
  );
}

/**
 * Trims the signals one step at a time: the last item of the longest list that has more than `floor` items. With a
 * `floor` of 0 it ends by dropping the biggest other part. `KEEP_SIGNALS` stays whole either way.
 */
const shrinkSignals =
  (floor: number): Shrink<Payload> =>
  (payload) => {
    const signals = payload.signals;
    if (signals === undefined) return null;
    if (!isObject(signals)) return floor === 0 ? { ...payload, signals: undefined } : null;
    const size = (v: unknown) => JSON.stringify(v)?.length ?? 0;
    const lists = Object.entries(signals).filter(
      ([key, v]) => !KEEP_SIGNALS.has(key) && Array.isArray(v) && v.length > floor,
    );
    if (lists.length) {
      const [key, list] = lists.sort((a, b) => size(b[1]) - size(a[1]))[0];
      return { ...payload, signals: { ...signals, [key]: (list as unknown[]).slice(0, -1) } };
    }
    if (floor > 0) return null;
    const rest = Object.entries(signals)
      .filter(([key]) => !KEEP_SIGNALS.has(key))
      .sort((a, b) => size(b[1]) - size(a[1]));
    if (!rest.length) return null;
    const gone = rest[0][0];
    return { ...payload, signals: Object.fromEntries(Object.entries(signals).filter(([key]) => key !== gone)) };
  };

/** The `plan` step of a team run. */
export async function runDirector(input: AgentInput): Promise<StepResult> {
  if (!input.model)
    throw new AgentError("Falta configurar el modelo del Director.");
  // The morning signals come with the run (the daily plan puts them in its context), already collected by the server.
  const signals = (input.run.context as { signals?: unknown } | null)?.signals;
  const system = instructions(input.language);
  const fitted = fitPayload<Payload>(
    {
      ...(signals === undefined || signals === null ? {} : { signals: capSignals(signals) }),
      request: input.run.prompt,
      context: boundedContext(contextWithout(input.context, "signals")),
    },
    (payload) => promptBytes(DirectorPlan, system, payload),
    // The long lists of signals first (down to a few items each); then the context, lowest value first; only then the rest of the
    // signals. What is left of the budget (`remaining`) and the request are never cut.
    [
      shrinkSignals(SIGNALS_FLOOR),
      ...contextShrinks().map((shrink) => shrinkKey<Payload, "context">("context", shrink)),
      shrinkSignals(0),
    ],
  );
  const r = await meteredAsk(DirectorPlan, system, fitted.payload, input.model);
  const data = { ...r.value, usage: r.usage };
  // No pieces to make ends the job: a question gets its answer; if there is no text, the owner is told nothing is needed.
  if (r.value.maxPieces === 0)
    return {
      data,
      cents: r.usage.cents,
      text: r.value.reply.trim() || NOTHING_NEEDED[input.language],
      state: "completed",
    };
  return { data, cents: r.usage.cents };
}
