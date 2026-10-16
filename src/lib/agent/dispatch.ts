// El paso `dispatch` del equipo (código del motor, sin IA): revisa las piezas que propuso la estrategia contra los límites de
// hoy y crea un encargo hijo por cada pieza válida. Lo que no cabe se descarta con su motivo y se lo cuenta al dueño.
import type { AgentRun } from "@prisma/client";
import { db } from "@/lib/db";
import { AgentError } from "./access";
import { pieceLimits } from "./limits";
import { capByDirector, validatePieces, type DropReason, type Piece, type PieceLimits } from "./plan";
import { spawnPieces, type StepResult } from "./queue";
import { languageOf } from "./schema";
import { registerMatyaStep } from "./team-execution";
import { readStepOutput } from "./tools";

// Where the numbers come from lives in limits.ts (the strategy agent reads them too); re-exported for whoever dispatches.
export { pieceLimits } from "./limits";

type Language = "es" | "en";
type Dropped = { id: string; reason: DropReason };

const FORMAT: Record<Piece["format"], Record<Language, string>> = {
  post: { es: "publicación", en: "post" },
  carrusel: { es: "carrusel", en: "carousel" },
  video: { es: "video", en: "video" },
  articulo: { es: "artículo", en: "article" },
};

/** Each reason `validatePieces` gives, in plain words for the owner (after "por" / "for"). */
const WHY: Record<DropReason, Record<Language, string>> = {
  formato: { es: "por formato no válido", en: "for an invalid format" },
  "sin canal": { es: "por no tener un canal conectado y permitido", en: "for having no connected, allowed channel" },
  "no permitido": { es: "por un tipo de contenido que no está permitido", en: "for a kind of content that is not allowed" },
  "fecha pasada": { es: "por una fecha que ya pasó", en: "for a date that already passed" },
  repetido: { es: "por un tema repetido", en: "for a repeated topic" },
  "sin cupo": { es: "por falta de cupo de publicaciones", en: "for lack of room in the posting limit" },
};

/** "Sin cupo" when the director's own maximum is what ran out (not the day's limit): the owner is told the plan asked for `n`. */
const overPlan = (n: number, language: Language) =>
  language === "es"
    ? `por pasar de ${n === 1 ? "la pieza" : `las ${n} piezas`} que pidió el plan`
    : `for going over the ${n} ${n === 1 ? "piece" : "pieces"} the plan asked for`;

/** "2 por falta de cupo de publicaciones, 1 por un tema repetido" (the most common reason first). */
function reasons(dropped: Dropped[], language: Language, planMax?: number): string {
  const counts = new Map<DropReason, number>();
  for (const d of dropped) counts.set(d.reason, (counts.get(d.reason) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([reason, n]) =>
        `${n} ${reason === "sin cupo" && planMax !== undefined ? overPlan(planMax, language) : (WHY[reason]?.[language] ?? reason)}`,
    )
    .join(", ");
}

/**
 * What the owner reads when the dispatch ends: the pieces created (topic and format) and the proposals dropped, with the
 * reasons in plain words. With nothing created it says why, whatever the cause: a cancelled job, no places left today, no
 * channel, or a strategy with nothing to propose. `planMax`: set when the director's own maximum, and not the day's limit,
 * is what cut the pieces: then "no room" is worded as "the plan asked for N".
 */
export function dispatchText(
  created: Piece[],
  dropped: Dropped[],
  limits: Pick<PieceLimits, "remainingPosts" | "channels">,
  language: Language,
  opts: { cancelled?: boolean; planMax?: number } = {},
): string {
  const { cancelled = false, planMax } = opts;
  const es = language === "es";
  if (cancelled)
    return es
      ? "El encargo se canceló: no creé piezas."
      : "The job was cancelled: I created no pieces.";
  const lost = dropped.length
    ? es
      ? ` Descarté ${dropped.length} ${dropped.length === 1 ? "propuesta" : "propuestas"}: ${reasons(dropped, language, planMax)}.`
      : ` I dropped ${dropped.length} ${dropped.length === 1 ? "proposal" : "proposals"}: ${reasons(dropped, language, planMax)}.`
    : "";
  if (created.length) {
    const list = created
      .map((p) => `«${p.topic}» (${FORMAT[p.format][language]})`)
      .join(", ");
    return es
      ? `Creé ${created.length} ${created.length === 1 ? "pieza" : "piezas"}: ${list}.${lost}`
      : `I created ${created.length} ${created.length === 1 ? "piece" : "pieces"}: ${list}.${lost}`;
  }
  if (dropped.length)
    return es
      ? `No creé piezas nuevas.${lost}`
      : `I created no new pieces.${lost}`;
  // Nothing was proposed: say whether there was any room to propose.
  if (limits.remainingPosts <= 0)
    return es
      ? "Hoy no hay cupo de publicaciones, así que no creé piezas nuevas."
      : "There is no room left in today's posting limit, so I created no new pieces.";
  if (!limits.channels.length)
    return es
      ? "No hay un canal conectado y permitido para publicar, así que no creé piezas nuevas."
      : "There is no connected, allowed channel to publish on, so I created no new pieces.";
  return es
    ? "La estrategia no propuso piezas nuevas."
    : "The strategy proposed no new pieces.";
}

/** The `dispatch` step of a team run. */
async function dispatch(run: AgentRun): Promise<StepResult> {
  const language = languageOf(run.prompt);
  // Both outputs are the run's own (`readStepOutput` is scoped to the run and its business).
  const strategy = await readStepOutput(run, "strategy");
  if (strategy === null) throw new AgentError("Falta completar el paso anterior.");
  const ws = await db.agentWorkspace.findUniqueOrThrow({
    where: { businessId: run.businessId },
  });
  // The director's own maximum also holds; the workspace's limits hold even if its plan cannot be read.
  const day = await pieceLimits(run.businessId, ws, new Date());
  const limits = capByDirector(day, await readStepOutput(run, "plan"));
  // When the plan's maximum (not the day's room) is the lower one, that is what the owner is told ran out.
  const planMax = limits.remainingPosts < day.remainingPosts ? limits.remainingPosts : undefined;
  const proposed =
    typeof strategy === "object" && !Array.isArray(strategy)
      ? (strategy as { pieces?: unknown }).pieces
      : undefined;
  const { pieces, dropped } = validatePieces(proposed, limits);
  // A job cancelled meanwhile creates nothing (`spawnPieces` returns no runs): then nothing was created.
  const children = pieces.length ? await spawnPieces(run, pieces) : [];
  const cancelled = pieces.length > 0 && children.length === 0;
  const created = cancelled ? [] : pieces;
  return {
    data: { pieces: created, dropped },
    text: dispatchText(created, dropped, limits, language, { cancelled, planMax }),
    state: "completed",
  };
}

registerMatyaStep("dispatch", dispatch);
