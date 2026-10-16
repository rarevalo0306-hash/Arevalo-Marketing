// El guardia del equipo: lo que decide, con reglas simples, si MATYA puede programar una pieza, a qué hora sale (siempre dentro
// del horario de publicación del negocio) y si puede seguir enviando a un canal. `brakedChannels`, `refusalOf`, `approvedAfterReviews` y `pieceScheduleAt` son puras (sin base
// de datos ni red); las demás leen con el cliente que les pasan (la transacción de quien llama, dentro del candado del
// negocio, o `db`), nunca con otra conexión. `pieceLimits` lee `brakedOf` para no proponer piezas a un canal frenado.
import type { AgentRun, AgentWorkspace, Prisma } from "@prisma/client";
import { businessTz, localDay } from "@/lib/business-tz";
import { stormSchedule, stormWindow } from "@/lib/storm";
import { AgentError } from "./access";
import { Piece, type PieceFormat } from "./plan";

/**
 * A refusal before anything was written or spent: the step that throws it reserved nothing and its transaction rolled back.
 * `workOne` ends the run `blocked` (not `uncertain`, which is for an outcome nobody knows) and the draft stays a draft.
 */
export class Refusal extends AgentError {}

/**
 * Los canales cuyos **dos** últimos envíos del agente fallaron (`failed`): se frenan hasta que el dueño revise la conexión.
 * Cada canal se juzga por separado y cuentan los dos más nuevos por `createdAt` (el momento del envío: quien llama pasa la hora
 * programada de la publicación), sin importar el orden en que llegan. Un solo envío (o un solo fallo) no frena; lo pendiente u
 * omitido no cuenta como fallo. La lista sale ordenada y sin repetidos.
 *
 * `reconnectedAt`: cuándo se guardó por última vez la conexión de cada canal (`Connection.updatedAt`). El freno solo mira los
 * envíos **posteriores** a esa fecha: lo que pasó en ese momento o antes ya no cuenta. Así, reconectar libera el canal, un
 * solo fallo nuevo no lo frena otra vez y dos fallos nuevos seguidos sí. Sin fecha, se miran todos los envíos.
 * Importante: esa fecha solo la mueve un guardado del dueño. Los procesos de fondo que reescriben una conexión (como
 * `writeConnection` en `google-data.ts`) conservan `updatedAt` a propósito; quien agregue otro escritor debe hacer lo mismo,
 * o un refresco automático liberaría un canal que sigue fallando.
 */
export function brakedChannels(
  targets: { channel: string; status: string; createdAt: Date }[],
  reconnectedAt: Record<string, Date | undefined> = {},
): string[] {
  const byChannel = new Map<string, { status: string; at: number }[]>();
  for (const t of targets) {
    const list = byChannel.get(t.channel) ?? [];
    list.push({ status: t.status, at: t.createdAt.getTime() });
    byChannel.set(t.channel, list);
  }
  const braked: string[] = [];
  for (const [channel, list] of byChannel) {
    // Only what happened after the owner last saved the connection counts (a missing or invalid date counts everything).
    const saved = Object.hasOwn(reconnectedAt, channel) ? reconnectedAt[channel]?.getTime() : undefined;
    const since = saved === undefined || Number.isNaN(saved) ? -Infinity : saved;
    // Newest first. Equal times keep the order they arrived in (a stable sort).
    const [last, before] = list.filter((d) => d.at > since).sort((a, b) => b.at - a.at);
    if (last?.status === "failed" && before?.status === "failed") braked.push(channel);
  }
  return braked.sort();
}

/**
 * The braked channels among `channels` for one business: the agent's last two settled deliveries (sent or failed) of each
 * channel, timed by when their post went out, against when the owner last saved that channel's connection. Read with
 * `client` for `businessId` only; queries one channel after another (it may be a transaction's client).
 */
export async function brakedOf(
  client: Prisma.TransactionClient,
  businessId: string,
  channels: string[],
  connections: { channel: string; updatedAt: Date }[],
): Promise<string[]> {
  const deliveries: { channel: string; status: string; createdAt: Date }[] = [];
  for (const channel of new Set(channels)) {
    const rows = await client.postTarget.findMany({
      where: {
        channel,
        status: { in: ["sent", "failed"] },
        post: { businessId, id: { startsWith: "agent-" } },
      },
      select: { channel: true, status: true, post: { select: { scheduledAt: true } } },
      orderBy: { post: { scheduledAt: "desc" } },
      take: 2,
    });
    // `PostTarget` has no date of its own: a delivery happens when its post goes out, so its time is the post's
    // `scheduledAt` (never null). Not `createdAt`: the agent makes the post as a draft and schedules it later, possibly
    // days later after an approval wait.
    deliveries.push(...rows.map((t) => ({ channel: t.channel, status: t.status, createdAt: t.post.scheduledAt })));
  }
  // Saving a channel's connection again (the owner reconnected it) restarts its brake count: `updatedAt` is that moment.
  // This relies on one invariant: only an owner's save moves `Connection.updatedAt`. The background writers that rewrite a
  // connection (`writeConnection` in google-data.ts) keep `updatedAt` on purpose; any new writer must do the same.
  return brakedChannels(deliveries, Object.fromEntries(connections.map((c) => [c.channel, c.updatedAt])));
}

const REVIEW_STEP = /^review(-r\d+)?$/;

/**
 * Whether `approvedAt` is an approval of the reviewed piece: later than the end of every review of it (`review`,
 * `review-r<n>`). An earlier approval, such as a video's cost, does not count; a review that has not finished lets nothing
 * through. A run with no review only needs the approval.
 */
export function approvedAfterReviews(
  approvedAt: Date | null,
  reviews: { name: string; finishedAt: Date | null }[],
): boolean {
  if (!approvedAt) return false;
  const own = reviews.filter((r) => REVIEW_STEP.test(r.name));
  if (own.some((r) => !r.finishedAt)) return false;
  return own.every((r) => approvedAt.getTime() > r.finishedAt!.getTime());
}

/** `approvedAfterReviews` for a run, reading its review steps with `client` (scoped to the run's business). */
export async function approvedAfterReview(
  client: Prisma.TransactionClient,
  run: Pick<AgentRun, "id" | "businessId" | "approvedAt">,
): Promise<boolean> {
  if (!run.approvedAt) return false;
  const reviews = await client.agentStep.findMany({
    where: { runId: run.id, run: { businessId: run.businessId }, name: { startsWith: "review" } },
    select: { name: true, finishedAt: true },
  });
  return approvedAfterReviews(run.approvedAt, reviews);
}

/**
 * The business's time zone (`businessTz`) and its local day of `now` (`AgentBudget.day`, the same key `beginStep` and
 * `claimAgentPost` use), from one read of the business row.
 */
export async function todayOf(
  client: Prisma.TransactionClient,
  businessId: string,
  now: Date,
): Promise<{ day: string; tz: string }> {
  const business = await client.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { timezone: true },
  });
  const tz = businessTz(business);
  return { day: localDay(now, tz), tz };
}

/** What the guard decides on, already read. */
export type GuardFacts = {
  ws: Pick<
    AgentWorkspace,
    | "pausedAt"
    | "teamMode"
    | "enabled"
    | "allowPublish"
    | "mode"
    | "allowSocial"
    | "allowWebArticles"
    | "channels"
    | "maxPostsPerDay"
  >;
  /** The piece's format; null when the run is no piece we can read (it then follows the rules of a social post). */
  format: PieceFormat | null;
  /** The run has an approval given after its last review (`approvedAfterReviews`). */
  approved: boolean;
  /** Where the post would go (its targets). */
  channels: string[];
  /** The business's connected channels. */
  connected: string[];
  /** The braked channels (`brakedOf`). */
  braked: string[];
  /** The agent's posts already scheduled today (`AgentBudget.posts`). */
  posts: number;
};

const KEEP = " La publicación quedó como borrador.";

/** How each switch is told to the owner: when a step of the team stops (`step`) or when a piece is not scheduled (`schedule`). */
const SWITCH_WORDS = {
  step: {
    paused: "MATYA está en pausa: el equipo no sigue hasta que la reanudes.",
    teamOff: "El modo equipo está apagado: el equipo no sigue con este trabajo.",
    off: "MATYA está apagada: actívala para que el equipo siga con este trabajo.",
  },
  schedule: {
    paused: "MATYA está en pausa: no se programa nada hasta que la reanudes.",
    teamOff: "El modo equipo está apagado: las piezas del equipo no se programan.",
    off: "MATYA está apagada: actívala para programar sus piezas.",
  },
} as const;

/**
 * Why no step of the team's work (a team run or one of its pieces) may start now, or null: everything paused, team mode off or
 * MATYA off, the first that applies in this order (the pause is what the owner did last and must undo first). Checked before each
 * of those steps reserves anything (`stepCost`) and again when it begins (`beginStep`), so a switch the owner turned off in the
 * middle of a plan stops the next step at no cost; the steps that only observe (`isObserveStep`) are not stopped. The publishing
 * permission is not one of them: the team may still prepare a piece, which then waits at its schedule step (`workOne`) or is
 * refused by the guard there. `words`: how the reason is told (`switchesRefusal` tells it as a piece that is not scheduled).
 */
export function teamRefusal(
  ws: Pick<GuardFacts["ws"], "pausedAt" | "teamMode" | "enabled">,
  words: keyof typeof SWITCH_WORDS = "step",
): string | null {
  const say = SWITCH_WORDS[words];
  if (ws.pausedAt) return say.paused;
  if (!ws.teamMode) return say.teamOff;
  if (!ws.enabled) return say.off;
  return null;
}
/**
 * Why nothing of the team's pieces may go on now because of the switches, or null: `teamRefusal`'s three (told as a piece that
 * is not scheduled), then the publishing permission off. `refusalOf` starts with these; a piece's steps that spend money check
 * them too before they reserve anything.
 */
export function switchesRefusal(
  ws: Pick<GuardFacts["ws"], "pausedAt" | "teamMode" | "enabled" | "allowPublish">,
): string | null {
  return (
    teamRefusal(ws, "schedule") ??
    (ws.allowPublish ? null : "El permiso de publicación de MATYA está apagado.")
  );
}
const list = (channels: string[]) => channels.join(", ");

/**
 * Why a piece may not be scheduled, or null when it may. The checks go in this order and the first one that fails is the
 * answer: everything paused; team mode, MATYA or the publishing permission off; approval mode without an approval after the
 * review; a social piece (anything but `articulo`) without permission for social posts; no channel, YouTube (never the
 * agent's), a channel the owner does not allow (the website `seo` is only an article's, and only with web articles allowed;
 * an article goes nowhere else), one that is not connected or one that is braked; and the day's limit of posts.
 */
export function refusalOf(f: GuardFacts): string | null {
  const { ws } = f;
  const article = f.format === "articulo";
  const off = switchesRefusal(ws);
  if (off) return off + KEEP;
  if (ws.mode === "approval" && !f.approved)
    return "La pieza necesita tu aprobación después de su revisión para programarse." + KEEP;
  if (!article && !ws.allowSocial)
    return "Las publicaciones en redes sociales no están permitidas para MATYA." + KEEP;
  const channels = [...new Set(f.channels)];
  if (!channels.length) return "La pieza no tiene canales a los que publicar." + KEEP;
  if (channels.includes("youtube"))
    return "MATYA nunca publica en YouTube: esa subida la aprueba una persona." + KEEP;
  const permitted = (c: string) =>
    c === "seo" ? article && ws.allowWebArticles : !article && ws.channels.includes(c);
  const outside = channels.filter((c) => !permitted(c));
  if (outside.length) return `MATYA no tiene permiso para publicar en ${list(outside)}.` + KEEP;
  const offline = channels.filter((c) => !f.connected.includes(c));
  if (offline.length)
    return `Estos canales no están conectados: ${list(offline)}. Revisa Conexiones.` + KEEP;
  const braked = channels.filter((c) => f.braked.includes(c));
  if (braked.length)
    return (
      `Estos canales están frenados porque sus dos últimos envíos fallaron: ${list(braked)}. Revisa la conexión y vuelve a guardarla.` +
      KEEP
    );
  if (f.posts >= ws.maxPostsPerDay) return "Se alcanzó el límite diario de publicaciones de MATYA." + KEEP;
  return null;
}

/**
 * Why an article may not be written now, or null: the guard's own checks for a website article without the one that only
 * matters when it is published (an approval after the review). Everything paused; team mode, MATYA or the publishing permission
 * off; web articles not allowed; the website not connected; the day's limit of posts already reached (`posts`: a published
 * article counts as one, so an article that could not be published today is not paid for). Same words as `refusalOf`, without
 * its "stayed as a draft": nothing exists yet.
 */
export function articleRefusal(
  ws: GuardFacts["ws"],
  connected: string[],
  posts = 0,
): string | null {
  const refusal = refusalOf({
    ws: { ...ws, mode: "auto" },
    format: "articulo",
    approved: true,
    channels: ["seo"],
    connected,
    braked: [],
    posts,
  });
  return refusal === null ? null : refusal.replace(KEEP, "");
}

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

/**
 * Checks, inside the caller's transaction (it must hold the business lock, as the schedule step's does), that the piece
 * `run` may be scheduled to `channels` now. Throws a `Refusal` with the reason (`refusalOf`) and writes nothing. `run` and
 * `ws` should be read inside that same transaction; every query is for `run.businessId` only. The day's count is read here
 * and the caller adds the post to it in the same transaction, so two pieces scheduled at the same time never pass
 * `maxPostsPerDay` together. `now` is the moment the caller schedules at (it picks the business's day).
 */
export async function assertCanSchedule(
  tx: Prisma.TransactionClient,
  run: AgentRun,
  ws: AgentWorkspace,
  channels: string[],
  now: Date = new Date(),
): Promise<void> {
  if (ws.businessId !== run.businessId)
    throw new Refusal("El espacio de trabajo no corresponde a este negocio.");
  const businessId = run.businessId;
  const piece = Piece.safeParse(field(run.context, "piece"));
  const connections = await tx.connection.findMany({
    where: { businessId },
    select: { channel: true, updatedAt: true },
  });
  const { day } = await todayOf(tx, businessId, now);
  const budget = await tx.agentBudget.findUnique({
    where: { businessId_day: { businessId, day } },
    select: { posts: true },
  });
  const refusal = refusalOf({
    ws,
    format: piece.success ? piece.data.format : null,
    approved: ws.mode === "approval" ? await approvedAfterReview(tx, run) : false,
    channels,
    connected: connections.map((c) => c.channel),
    braked: await brakedOf(tx, businessId, channels, connections),
    posts: budget?.posts ?? 0,
  });
  if (refusal) throw new Refusal(refusal);
}

/** The industry whose posts offer a public adjuster's services in Florida (`INDUSTRIES` in industry.ts). */
export const OFFER_INDUSTRY = "public-adjusting-fl";

/**
 * When a piece's post goes out, in the business's time zone `tz`: in a minute, as the agent's campaigns (the piece's own
 * `date` is advisory), but always inside the business's posting window (`stormWindow`): from 9 am to before 7 pm local time,
 * and a post outside it waits for the next allowed morning. A public adjuster in Florida (`industry`, the workspace's
 * industry, or the industry the piece was made for, `context.industry.key`, is `OFFER_INDUSTRY`) posts as an offer of
 * services, so never on a Sunday either (Florida 626.854: no contact to offer services from 8 pm to 8 am, nor on Sundays);
 * any other business may post on a Sunday.
 * After a storm (`context.storm.at`, a date) it is never before what the storm rules allow (`stormSchedule`: an hour after the
 * storm in the phase "seguridad", 49 hours in "oferta", the phase "seguridad" unless the context says "oferta"), even when the
 * storm is old and that time already passed; and it goes out inside the window: the offer's for a public adjuster in any phase
 * (R43: a safety piece of a public adjuster never goes out on a Sunday either), the phase's own for any other business.
 */
export function pieceScheduleAt(context: unknown, now: Date, tz: string, industry: string): Date {
  const soon = new Date(now.getTime() + 60000);
  const offer = industry === OFFER_INDUSTRY || field(field(context, "industry"), "key") === OFFER_INDUSTRY;
  const storm = field(context, "storm");
  const at = field(storm, "at");
  const time = typeof at === "string" ? Date.parse(at) : NaN;
  if (Number.isNaN(time)) return stormWindow(soon, offer ? "oferta" : "seguridad", tz);
  const phase = field(storm, "phase") === "oferta" ? "oferta" : "seguridad";
  // The wait follows the storm's phase; the window is the offer's for a public adjuster, whatever the phase.
  const allowed = stormSchedule(new Date(time), 0, phase, tz);
  return stormWindow(allowed.getTime() > soon.getTime() ? allowed : soon, offer ? "oferta" : phase, tz);
}
