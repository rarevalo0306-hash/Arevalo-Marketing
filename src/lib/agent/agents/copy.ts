// El agente de redacción: escribe el texto de una pieza (post, carrusel o video) con la misma función que usa el flujo de campañas.
// Lee la investigación y el plan del equipo, y en la vuelta de corrección los problemas que encontró la revisión. Una sola llamada pagada.
// El artículo (`article`) es de otra tarea: por ahora este agente no lo hace.
import { AgentError } from "../access";
import { oneLine } from "../bounded-context";
import { writeCopy } from "../content-steps";
import { Piece, problemsOf } from "../plan";
import type { StepResult } from "../queue";
import type { AgentInput } from "./types";

/** Longest texts of the piece and of the team's goal that reach the prompt, and most research opportunities sent. */
const TOPIC_MAX = 200;
const OBJECTIVE_MAX = 300;
const KEYWORD_MAX = 80;
const GOAL_MAX = 500;
const KIND_MAX = 40;
const DETAIL_MAX = 400;
const SOURCE_MAX = 80;
const ITEMS_MAX = 15;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `v[key]` of whatever it is, or undefined; never throws (stored JSON, getters). */
function field(v: unknown, key: string): unknown {
  try {
    return isObject(v) ? v[key] : undefined;
  } catch {
    return undefined;
  }
}

/** The opportunities the team's research found (its `items`), cut short; the saved-report digest is not sent. */
function researchOf(output: unknown) {
  const items = field(output, "items");
  return {
    items: (Array.isArray(items) ? items : [])
      .filter(isObject)
      .slice(0, ITEMS_MAX)
      .map((i) => ({
        kind: oneLine(field(i, "kind"), KIND_MAX),
        detail: oneLine(field(i, "detail"), DETAIL_MAX),
        source: oneLine(field(i, "source"), SOURCE_MAX),
      })),
  };
}

const LABELS = {
  es: {
    piece: "Pieza",
    format: "formato",
    channels: "canales",
    topic: "Tema",
    objective: "Objetivo",
    keyword: "Palabra clave",
    goal: "Meta del equipo",
    language: "Escribe los textos en español.",
  },
  en: {
    piece: "Piece",
    format: "format",
    channels: "channels",
    topic: "Topic",
    objective: "Objective",
    keyword: "Keyword",
    goal: "Team goal",
    language: "Write the copy in English.",
  },
} as const;

/** What the owner's team asked this piece to be, in the owner's language: the piece, then the team's goal. */
function requestOf(piece: Piece, goal: string, language: "es" | "en") {
  const t = LABELS[language];
  return [
    `${t.piece} ${piece.id} · ${t.format}: ${piece.format} · ${t.channels}: ${piece.channels.map((c) => oneLine(c, 20)).join(", ")}`,
    `${t.topic}: ${oneLine(piece.topic, TOPIC_MAX)}`,
    ...(piece.objective ? [`${t.objective}: ${oneLine(piece.objective, OBJECTIVE_MAX)}`] : []),
    ...(piece.keyword ? [`${t.keyword}: ${oneLine(piece.keyword, KEYWORD_MAX)}`] : []),
    ...(goal ? [`${t.goal}: ${goal}`] : []),
    t.language,
  ].join("\n");
}

/** The `copy` step of a piece, and each of its rework rounds (`copy-r<n>`). */
export async function runCopy(input: AgentInput): Promise<StepResult> {
  // `article` and `article-r<n>` are for the article writer, which does not exist yet.
  if (!/^copy(-r\d+)?$/.test(input.step.id))
    throw new AgentError("Agente no disponible.");
  if (!input.model)
    throw new AgentError("Falta configurar el modelo del agente de redacción.");
  const piece = Piece.safeParse(field(input.context, "piece"));
  if (!piece.success) throw new AgentError("La pieza no tiene un plan válido.");

  // The piece reads its own steps first and then the team's (its research and plan).
  const readStep = input.tools.use("readStepOutput");
  const rework = input.step.attempt >= 1;
  const [plan, research, review] = await Promise.all([
    readStep("plan"),
    readStep("research"),
    rework ? readStep("review") : null,
  ]);
  const r = await writeCopy({
    context: input.context,
    research: researchOf(research),
    request: requestOf(piece.data, oneLine(field(plan, "goal"), GOAL_MAX), input.language),
    piece: piece.data,
    // The latest review (`review`, or its latest round): every problem it found, for the writer to fix.
    notes: rework ? problemsOf(review) : [],
    model: input.model,
  });
  return {
    data: { ...r.value, usage: r.usage },
    cents: r.usage.cents,
  };
}
