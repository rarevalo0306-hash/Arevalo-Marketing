// Piezas del equipo: plantillas de pasos, validador de lo que propone la IA y una sola vuelta de corrección.
// Módulo puro: sin base de datos ni red. Lo consumen la cola, el despacho y la revisión.
import { z } from "zod";
import type { AgentKeyEnum } from "./schema";

/** `matya` = paso sin IA (código del motor). */
export type AgentKey = z.infer<typeof AgentKeyEnum> | "matya";
export type PlanStep = { id: string; agent: AgentKey; attempt: number };

export const PieceFormat = z.enum(["post", "carrusel", "video", "articulo"]);
export type PieceFormat = z.infer<typeof PieceFormat>;

export const Piece = z.object({
  id: z.string().regex(/^p([1-9]|1[0-2])$/),
  topic: z.string().trim().min(3).max(200),
  objective: z.string().max(300).default(""),
  channels: z.array(z.string()).min(1).max(6),
  format: PieceFormat,
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  keyword: z.string().max(80).default(""),
});
export type Piece = z.infer<typeof Piece>;

export const TEAM_STEPS = ["plan", "research", "strategy", "dispatch"] as const;

const TEMPLATES: Record<PieceFormat, readonly string[]> = {
  post: ["copy", "design", "review", "prepare", "schedule", "verify"],
  carrusel: ["copy", "design", "review", "prepare", "schedule", "verify"],
  video: [
    "copy",
    "design",
    "video",
    "render",
    "video_wait",
    "review",
    "prepare",
    "schedule",
    "verify",
  ],
  articulo: ["article", "review", "article_publish"],
};

// Steps that call an agent; every other step is plain code (`matya`).
const AGENT_OF: Readonly<Record<string, AgentKey>> = {
  copy: "copy",
  design: "design",
  video: "video",
  review: "review",
  article: "copy",
};

const step = (id: string, attempt = 0): PlanStep => ({
  id,
  agent: AGENT_OF[id.replace(/-r\d+$/, "")] ?? "matya",
  attempt,
});

/** The fixed steps of one piece. A new array on every call. */
export function stepsForPiece(format: PieceFormat): PlanStep[] {
  return TEMPLATES[format].map((id) => step(id));
}

export type PieceLimits = {
  remainingPosts: number;
  channels: string[];
  allowSocial: boolean;
  allowWebArticles: boolean;
  /** YYYY-MM-DD, in the business's local time. */
  today: string;
  recentTopics: string[];
};

const normalizeTopic = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** The id of whatever the model sent, or "?"; never throws (getters, proxies). */
function idOf(item: unknown): string {
  try {
    if (typeof item !== "object" || item === null) return "?";
    const id = (item as { id?: unknown }).id;
    return typeof id === "string" ? id : "?";
  } catch {
    return "?";
  }
}

/**
 * Keeps only the pieces the business allows today and says why it dropped each
 * of the others. It never throws, whatever the model proposed. Rules, in order:
 * format, channel, permission, date, repeated, quota. The first one that fails
 * drops the piece; a dropped piece uses no quota and does not mark its topic as seen.
 */
export function validatePieces(
  raw: unknown,
  limits: PieceLimits,
): { pieces: Piece[]; dropped: { id: string; reason: string }[] } {
  const pieces: Piece[] = [];
  const dropped: { id: string; reason: string }[] = [];
  const drop = (id: string, reason: string) => dropped.push({ id, reason });
  const allowed = new Set(limits.channels);
  const seenTopics = new Set(
    limits.recentTopics.filter((t) => typeof t === "string").map(normalizeTopic),
  );
  const seenIds = new Set<string>();
  const quota = Number.isFinite(limits.remainingPosts)
    ? Math.max(0, Math.floor(limits.remainingPosts))
    : 0;

  // What the model sent is untrusted: reading it may throw (getters, proxies).
  let length: number;
  try {
    if (!Array.isArray(raw)) {
      drop("?", "formato");
      return { pieces, dropped };
    }
    length = raw.length;
  } catch {
    drop("?", "formato");
    return { pieces, dropped };
  }
  for (let i = 0; i < length; i++) {
    let item: unknown;
    let parsed: ReturnType<typeof Piece.safeParse>;
    try {
      item = (raw as unknown[])[i];
      parsed = Piece.safeParse(item);
    } catch {
      drop(idOf(item), "formato");
      continue;
    }
    if (!parsed.success) {
      drop(idOf(item), "formato");
      continue;
    }
    const piece = parsed.data;
    // Never youtube, and only the channels that are connected.
    const channels = [...new Set(piece.channels)].filter(
      (c) => c !== "youtube" && allowed.has(c),
    );
    if (!channels.length) {
      drop(piece.id, "sin canal");
      continue;
    }
    const web = piece.format === "articulo";
    if (web ? !limits.allowWebArticles : !limits.allowSocial) {
      drop(piece.id, "no permitido");
      continue;
    }
    if (piece.date !== undefined && piece.date < limits.today) {
      drop(piece.id, "fecha pasada");
      continue;
    }
    const topic = normalizeTopic(piece.topic);
    if (seenTopics.has(topic) || seenIds.has(piece.id)) {
      drop(piece.id, "repetido");
      continue;
    }
    if (pieces.length >= quota) {
      drop(piece.id, "sin cupo");
      continue;
    }
    seenTopics.add(topic);
    seenIds.add(piece.id);
    pieces.push({ ...piece, channels });
  }
  return { pieces, dropped };
}

export type ReviewProblem = {
  kind: string;
  detail: string;
  sendBackTo: "copy" | "design";
};

/**
 * The only correction round: send the problems back, then review once more.
 * Never adds `video`, `render` or `video_wait`; a video piece only redoes
 * its text and image. An article has no design, so everything goes to the writer.
 */
export function reworkSteps(
  problems: ReviewProblem[],
  attempt: number,
  format: PieceFormat = "post",
): PlanStep[] {
  if (attempt >= 1) return [];
  const toCopy = problems.some((p) => p.sendBackTo === "copy");
  const toDesign = problems.some((p) => p.sendBackTo === "design");
  if (format === "articulo") {
    return problems.length
      ? ["article-r1", "review-r1"].map((id) => step(id, 1))
      : [];
  }
  const ids: string[] = [];
  if (toCopy) ids.push("copy-r1");
  if (toDesign || toCopy) ids.push("design-r1");
  if (ids.length) ids.push("review-r1");
  return ids.map((id) => step(id, 1));
}

/**
 * The step ids of a stored plan (raw JSON from the database), or null when it
 * is not a plan we know how to read.
 */
export function stepsOfPlan(plan: unknown): string[] | null {
  try {
    if (typeof plan !== "object" || plan === null || Array.isArray(plan))
      return null;
    const { kind, steps } = plan as { kind?: unknown; steps?: unknown };
    if (kind === "team") return [...TEAM_STEPS];
    if (kind !== "piece" || !Array.isArray(steps)) return null;
    const ids: string[] = [];
    for (const s of steps) {
      if (typeof s !== "object" || s === null) return null;
      const id = (s as { id?: unknown }).id;
      if (typeof id !== "string") return null;
      ids.push(id);
    }
    return ids;
  } catch {
    return null;
  }
}
