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

/** The most pieces one plan can have: their ids run p1..p12 (the pattern of `Piece.id`), and the strategy and the director never ask for more. */
export const MAX_PIECES = 12;

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

/** Why `validatePieces` drops a piece, in the order it checks them. */
export const DROP_REASONS = [
  "formato",
  "sin canal",
  "no permitido",
  "fecha pasada",
  "repetido",
  "sin cupo",
] as const;
export type DropReason = (typeof DROP_REASONS)[number];

/** A topic as it is compared: without accents, in lower case and with one space between words. */
export const normalizeTopic = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** True when YYYY-MM-DD is a real calendar day (2026-02-30 and 2026-13-45 are not). */
function isRealDate(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return (
    t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
  );
}

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
 * format (including an impossible date), channel (an article only goes to the website, any other format never does),
 * permission, past date, repeated, quota. The first one that fails
 * drops the piece; a dropped piece uses no quota and does not mark its topic as seen.
 */
export function validatePieces(
  raw: unknown,
  limits: PieceLimits,
): { pieces: Piece[]; dropped: { id: string; reason: DropReason }[] } {
  const pieces: Piece[] = [];
  const dropped: { id: string; reason: DropReason }[] = [];
  const drop = (id: string, reason: DropReason) => dropped.push({ id, reason });
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
    // The date is later turned into a schedule time: it must be a real day.
    if (piece.date !== undefined && !isRealDate(piece.date)) {
      drop(piece.id, "formato");
      continue;
    }
    // Never youtube, and only the channels that are connected. The website (`seo`) is the channel of articles and of
    // nothing else: an article keeps only `seo`, every other format drops it.
    const web = piece.format === "articulo";
    const channels = [...new Set(piece.channels)].filter(
      (c) => c !== "youtube" && allowed.has(c) && (web ? c === "seo" : c !== "seo"),
    );
    if (!channels.length) {
      drop(piece.id, "sin canal");
      continue;
    }
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

/** The most pieces the director asked for (`maxPieces` of its stored `plan` output), or null when there is none we can read. */
export function directorMax(plan: unknown): number | null {
  try {
    if (typeof plan !== "object" || plan === null || Array.isArray(plan))
      return null;
    const max = (plan as { maxPieces?: unknown }).maxPieces;
    return typeof max === "number" && Number.isSafeInteger(max) && max >= 0
      ? max
      : null;
  } catch {
    return null;
  }
}

/**
 * The limits with the places left also held to what the director asked for. It never raises them. A plan output we
 * cannot read adds no cap: the workspace's own limits still hold.
 */
export function capByDirector(limits: PieceLimits, plan: unknown): PieceLimits {
  const max = directorMax(plan);
  return max === null
    ? limits
    : { ...limits, remainingPosts: Math.min(limits.remainingPosts, max) };
}

export const ReviewProblemSchema = z.object({
  kind: z.string(),
  detail: z.string(),
  sendBackTo: z.enum(["copy", "design"]),
});
export type ReviewProblem = z.infer<typeof ReviewProblemSchema>;

/** The problems a stored review output (`{ approved, problems }`) lists; anything unreadable is skipped. */
export function problemsOf(output: unknown): ReviewProblem[] {
  const list =
    output && typeof output === "object" && !Array.isArray(output)
      ? (output as { problems?: unknown }).problems
      : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap((p) => {
    const r = ReviewProblemSchema.safeParse(p);
    return r.success ? [r.data] : [];
  });
}

/**
 * The only correction round: send the problems back, then review once more.
 * Never adds `video`, `render` or `video_wait`; a video piece only redoes
 * its text and image. An article has no design, so everything goes to the writer.
 * `[]` means "no automatic round; the caller sends the piece to approval"
 * (the round was already used, or no problem can be routed).
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
    // An empty piece plan is corrupt: null makes the caller block it loudly.
    if (kind !== "piece" || !Array.isArray(steps) || !steps.length) return null;
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
