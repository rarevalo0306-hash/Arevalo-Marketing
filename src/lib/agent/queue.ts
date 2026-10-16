import { randomUUID } from "node:crypto";
import { Prisma, type AgentRun } from "@prisma/client";
import { db } from "@/lib/db";
import { businessTz, localDay } from "@/lib/business-tz";
import { AgentError } from "./access";
import { loadContext } from "./context";
import {
  MessageInput,
  Settings,
  inferKind,
  stepsFor,
  roleFor,
  type Context,
  type RunKind,
} from "./schema";
import { Refusal, teamRefusal } from "./guard";
import { sourceUrl } from "./network";
import { newsFresh } from "./freshness";
import {
  isArticleStep,
  isObserveStep,
  Piece,
  PieceFormat,
  problemsOf,
  reworkSteps,
  stepsForPiece,
  stepsOfPlan,
  type AgentKey,
  type PlanStep,
} from "./plan";

export const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const LEASE_MS = 4 * 60000;
const terminal = ["completed", "blocked", "uncertain", "cancelled"];
/** The statuses that count as open work. `enqueue`'s cap and the team's piece quota (`pieceLimits`) both count these. */
export const OPEN_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "waiting_provider",
] as const;
/** Most open runs a business may have at once (`enqueue` refuses the next one; a team's pieces count too). */
export const OPEN_RUN_CAP = 8;
/** The owner's requests that stay what they are with team mode on: they are not work for the team. */
const SOLO_KINDS: ReadonlySet<RunKind> = new Set<RunKind>([
  "briefing",
  "pause",
  "radar",
  "verify_news",
]);
/** Context keys that `loadContext`, `enqueue`'s own checks or `spawnPieces` set: never from a caller. */
const OWNED_CONTEXT = new Set<string>([
  "business",
  "industry",
  "revision",
  "capturedAt",
  "objective",
  "memory",
  "knowledge",
  "connections",
  "campaigns",
  "posts",
  "tools",
  "messages",
  "news",
  "campaignId",
  "piece",
] satisfies (keyof Context | "piece")[]);
/** The step ids of a run: its stored plan (team, piece) or the fixed recipe of its kind. */
export function stepsOf(run: Pick<AgentRun, "kind" | "plan">): string[] {
  return stepsOfPlan(run.plan) ?? stepsFor(run.kind as RunKind) ?? [];
}
/** A piece's stored plan with its steps, or null for any other run or an unreadable plan. */
function piecePlan(
  run: Pick<AgentRun, "kind" | "plan">,
): { plan: Record<string, unknown>; steps: PlanStep[] } | null {
  if (run.kind !== "piece" || !stepsOfPlan(run.plan)) return null;
  // stepsOfPlan also reads a team plan, which has no steps list: never map that.
  const plan = run.plan as Record<string, unknown>;
  if (plan.kind !== "piece" || !Array.isArray(plan.steps)) return null;
  const steps = (plan.steps as Record<string, unknown>[]).map((s) => ({
    id: s.id as string,
    agent: (typeof s.agent === "string" ? s.agent : "matya") as AgentKey,
    attempt:
      Number.isSafeInteger(s.attempt) && (s.attempt as number) >= 0
        ? (s.attempt as number)
        : 0,
  }));
  return { plan, steps };
}
/** Who does the piece step at the run's stage, and in which round; undefined outside pieces. */
export function planStepMeta(
  run: Pick<AgentRun, "kind" | "plan" | "stage">,
): { agent: string; attempt: number } | undefined {
  const s = piecePlan(run)?.steps[run.stage];
  return s ? { agent: s.agent, attempt: s.attempt } : undefined;
}
/** A business row is the lock root, even before its workspace/budget row exists. */
export async function locked<T>(
  businessId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "Business" WHERE id = ${businessId} FOR UPDATE`;
      if (!rows.length) throw new AgentError("Negocio no encontrado.", 404);
      return fn(tx);
    },
    { timeout: 15000 },
  );
}
export async function saveSettings(businessId: string, raw: unknown) {
  const value = Settings.parse(raw);
  value.sources.forEach((s) => sourceUrl(s.url));
  value.knowledge.forEach((k) => sourceUrl(k.url));
  return locked(businessId, (tx) =>
    tx.agentWorkspace.upsert({
      where: { businessId },
      create: {
        businessId,
        ...value,
        knowledge: json(value.knowledge),
        sources: json(value.sources),
        agentModels: json(value.agentModels),
        modelPrices: json(value.modelPrices),
      },
      update: {
        ...value,
        knowledge: json(value.knowledge),
        sources: json(value.sources),
        agentModels: json(value.agentModels),
        modelPrices: json(value.modelPrices),
        revision: { increment: 1 },
      },
    }),
  );
}
export async function enqueue(
  businessId: string,
  raw: unknown,
  opts: {
    origin?: "owner" | "daily";
    extraContext?: Record<string, unknown>;
  } = {},
) {
  const input = MessageInput.parse(raw);
  // Never read from `raw`: the owner's HTTP body must not pass as the daily cycle.
  const origin = opts.origin === "daily" ? "daily" : "owner";
  // The morning plan's key (`daily-<business>-<day>`) belongs to the cron: the owner cannot take the day's key in advance.
  if (origin === "owner" && input.requestKey.startsWith("daily-"))
    throw new AgentError("Esa clave de solicitud está reservada.");
  // What was asked for, from the body or from the text. With team mode on the lock below may turn it into a team run.
  const requested = input.kind ?? inferKind(input.text);
  // Pieces only come from their team run (`spawnPieces`): a planless piece has no steps.
  if (requested === "piece")
    throw new AgentError("Ese tipo de encargo no se puede pedir directamente.");
  // Extra keys are added; they never replace what was loaded or checked for this business.
  const extra = Object.fromEntries(
    Object.entries(opts.extraContext ?? {}).filter(
      ([k]) => !OWNED_CONTEXT.has(k),
    ),
  );
  const context: Context = { ...extra, ...(await loadContext(businessId)) };
  if (input.campaignId) {
    const c = await db.campaign.findFirst({
      where: { id: input.campaignId, businessId },
    });
    if (!c) throw new AgentError("Campaña no encontrada.", 404);
    context.campaignId = c.id;
  }
  if (requested === "pause" && !context.campaignId)
    throw new AgentError("Selecciona la campaña que quieres pausar.");
  if (input.newsId) {
    const n = await db.agentNews.findFirst({
      where: { id: input.newsId, businessId },
    });
    if (!n || (requested !== "verify_news" && !newsFresh(n)))
      throw new AgentError(
        "Esta noticia necesita contrastar su fuente, fecha y vigencia antes de crear contenido.",
      );
    context.news = {
      id: n.id,
      title: n.title,
      summary: n.summary,
      source: n.canonicalUrl,
      evidence: n.evidence,
      revision: n.revision,
    };
  }
  return locked(businessId, async (tx) => {
    const prior = await tx.agentRun.findUnique({
      where: {
        businessId_requestKey: { businessId, requestKey: input.requestKey },
      },
    });
    if (prior) return prior;
    const ws = await tx.agentWorkspace.findUnique({ where: { businessId } });
    // "Pausar todo": nothing new is asked for, by the owner or by the morning plan, until it is resumed.
    if (ws?.pausedAt)
      throw new AgentError(
        "MATYA está en pausa. Reanúdalo para pedir trabajo.",
        409,
      );
    if (requested === "team" && !ws?.teamMode)
      throw new AgentError(
        "Activa el modo equipo para pedir trabajo al equipo.",
      );
    // With team mode on, what the owner asks for goes to the team (a question too: the Director answers with no pieces),
    // except the few things that are not work for the team. Decided here, with the settings as they are under the lock.
    const kind: RunKind =
      origin === "owner" && ws?.teamMode && !SOLO_KINDS.has(requested)
        ? "team"
        : requested;
    // A team's pieces count too; `spawnPieces` itself never checks this cap.
    const pending = await tx.agentRun.count({
      where: {
        businessId,
        status: { in: [...OPEN_STATUSES] },
      },
    });
    if (pending >= OPEN_RUN_CAP)
      throw new AgentError(
        "Ya hay ocho trabajos abiertos. Espera o cancela uno.",
        429,
      );
    const recent = await tx.agentRun.count({
      where: { businessId, createdAt: { gte: new Date(Date.now() - 60000) } },
    });
    if (recent >= 12)
      throw new AgentError(
        "Espera un momento antes de enviar otro encargo.",
        429,
      );
    await tx.agentWorkspace.upsert({
      where: { businessId },
      create: { businessId },
      update: {},
    });
    const run = await tx.agentRun.create({
      data: {
        businessId,
        requestKey: input.requestKey,
        kind,
        prompt: input.text,
        context: json(context),
        origin,
        ...(kind === "team" ? { plan: json({ kind: "team" }) } : {}),
      },
    });
    await tx.agentMessage.create({
      data: { businessId, runId: run.id, role: "user", text: input.text },
    });
    return run;
  });
}
export async function claimRun(businessId?: string) {
  const run = await db.agentRun.findFirst({
    where: {
      ...(businessId ? { businessId } : {}),
      status: "queued",
      cancelRequested: false,
    },
    // "owner" sorts after "daily": the owner's requests go first, oldest first.
    orderBy: [{ origin: "desc" }, { createdAt: "asc" }],
  });
  if (!run) return null;
  const leaseToken = randomUUID();
  const claimed = await db.agentRun.updateMany({
    where: { id: run.id, status: "queued", cancelRequested: false },
    data: {
      status: "running",
      leaseToken,
      leaseUntil: new Date(Date.now() + LEASE_MS),
    },
  });
  return claimed.count ? { ...run, status: "running", leaseToken } : null;
}
export async function beginStep(
  runId: string,
  leaseToken: string,
  name: string,
  cost: number,
  meta?: { agent?: string; model?: string; attempt?: number },
) {
  if (!Number.isSafeInteger(cost) || cost < 0)
    throw new AgentError("Reserva no válida.");
  const attempt = meta?.attempt ?? 0;
  if (!Number.isInteger(attempt) || attempt < 0 || attempt > 1000)
    throw new AgentError("Paso no válido.");
  const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  return locked(run.businessId, async (tx) => {
    const current = await tx.agentRun.findUniqueOrThrow({
      where: { id: runId },
    });
    if (
      current.leaseToken !== leaseToken ||
      current.status !== "running" ||
      current.cancelRequested
    )
      throw new AgentError("Trabajo detenido.");
    const settings = await tx.agentWorkspace.findUniqueOrThrow({
      where: { businessId: run.businessId },
    });
    const context = run.context as unknown as Context;
    // A piece's prepare and schedule only use what its earlier steps saved, and the guard checks every current setting when
    // the piece is scheduled: a settings save since the piece was asked for does not stop them. The same goes for every step
    // after a wait for the owner's approval, which can last a day: the steps that spend money on a piece (the render, an article's
    // draft and its publication, with its second pass `article_publish:<n>`) re-read the current switches before they reserve
    // anything (`pieceStepCost`), and the render's wait (`video_wait:<n>`) and the review (`review`, `review-r<n>`) that follow
    // only read what the earlier steps saved. A save in between must not leave a piece charged for a step and blocked at the next.
    // The last one, `verify`, only reads the post the piece already scheduled: a save after the post went out must not stop it.
    const guardedLater =
      run.kind === "piece" &&
      (name === "prepare" ||
        name === "schedule" ||
        name === "verify" ||
        name === "render" ||
        /^video_wait(:\d+)?$/.test(name) ||
        /^review(-r\d+)?$/.test(name) ||
        isArticleStep(name) ||
        /^article_publish(:\d+)?$/.test(name));
    if (
      !["briefing", "pause"].includes(run.kind) &&
      !guardedLater &&
      settings.revision !== context.revision
    )
      throw new AgentError(
        "El conocimiento o los permisos cambiaron. Crea un encargo nuevo con la configuración actual.",
      );
    // The steps of the team that only observe (`isObserveStep`: a post that already left, a render already paid) finish even
    // with the switches off; the old flows keep their check as it was.
    const team = run.kind === "team" || run.kind === "piece";
    const observing = team && isObserveStep(name);
    if (!["briefing", "pause"].includes(run.kind) && !observing && !settings.enabled)
      throw new AgentError(
        "Activa MATYA y define sus límites para ejecutar este encargo.",
      );
    // `stepCost` already refused this before anything was reserved; checked again here, under the lock, for a switch the
    // owner turned off in between (team mode off does not move the revision for the steps a piece runs after a wait).
    const off = team && !observing ? teamRefusal(settings) : null;
    if (off) throw new Refusal(off);
    const prior = await tx.agentStep.findUnique({
      where: { runId_name: { runId, name } },
    });
    if (prior)
      throw new AgentError(
        "El paso ya tiene un registro; revisa su resultado antes de repetirlo.",
      );
    const business = await tx.business.findUniqueOrThrow({
      where: { id: run.businessId },
      select: { timezone: true },
    });
    const day = localDay(new Date(), businessTz(business));
    const budget = await tx.agentBudget.upsert({
      where: { businessId_day: { businessId: run.businessId, day } },
      create: { businessId: run.businessId, day },
      update: {},
    });
    if (
      cost &&
      (current.chargedCents + current.reservedCents + cost >
        settings.runBudgetCents ||
        budget.chargedCents + budget.reservedCents + cost >
          settings.dailyBudgetCents)
    )
      throw new AgentError(
        "El encargo alcanzó el límite de gasto. No se hizo una nueva llamada de pago.",
      );
    await tx.agentBudget.update({
      where: { id: budget.id },
      data: { reservedCents: { increment: cost } },
    });
    await tx.agentRun.update({
      where: { id: runId },
      data: { reservedCents: { increment: cost } },
    });
    return tx.agentStep.create({
      data: {
        runId,
        name,
        specialist: meta?.agent ?? roleFor(name),
        agent: meta?.agent ?? "",
        model: meta?.model ?? "",
        attempt,
        reservedCents: cost,
        budgetDay: day,
      },
    });
  });
}
export type StepResult = {
  data: unknown;
  cents?: number;
  text?: string;
  state?: "waiting_approval" | "waiting_provider" | "completed";
  advance?: boolean;
  /** Pieces only: steps to run right after this one (a rework round). Ignored elsewhere. */
  insertSteps?: PlanStep[];
};
export async function finishStep(
  runId: string,
  leaseToken: string,
  name: string,
  result: StepResult,
) {
  const r = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  return locked(r.businessId, async (tx) => {
    const run = await tx.agentRun.findUniqueOrThrow({ where: { id: runId } });
    const step = await tx.agentStep.findUniqueOrThrow({
      where: { runId_name: { runId, name } },
    });
    if (
      run.leaseToken !== leaseToken ||
      run.status !== "running" ||
      step.status !== "running"
    )
      return;
    const cents = result.cents ?? 0;
    if (!Number.isSafeInteger(cents) || cents < 0)
      throw new AgentError("Consumo no válido.");
    const over = cents > step.reservedCents;
    await tx.agentBudget.update({
      where: {
        businessId_day: { businessId: run.businessId, day: step.budgetDay },
      },
      data: {
        reservedCents: { decrement: step.reservedCents },
        chargedCents: { increment: cents },
      },
    });
    await tx.agentStep.update({
      where: { id: step.id },
      data: {
        status: "succeeded",
        output: json(result.data),
        chargedCents: cents,
        finishedAt: new Date(),
      },
    });
    // A rework round goes right after this step. Known ids are dropped (`@@unique([runId, name])`);
    // outside pieces it is ignored, because the paid step already ran.
    let plan: unknown = run.plan;
    const piece = result.insertSteps?.length ? piecePlan(run) : null;
    if (piece) {
      const have = new Set(piece.steps.map((s) => s.id));
      const add: PlanStep[] = [];
      for (const s of result.insertSteps ?? []) {
        if (typeof s?.id !== "string" || !s.id || have.has(s.id)) continue;
        have.add(s.id);
        add.push({
          id: s.id,
          agent: s.agent,
          attempt:
            Number.isSafeInteger(s.attempt) && s.attempt >= 0 ? s.attempt : 0,
        });
      }
      if (add.length) {
        const at = Math.min(run.stage + 1, piece.steps.length);
        plan = {
          ...piece.plan,
          steps: [
            ...piece.steps.slice(0, at),
            ...add,
            ...piece.steps.slice(at),
          ],
        };
      }
    }
    const end =
      run.stage + 1 >=
      stepsOf({ kind: run.kind, plan: plan as Prisma.JsonValue }).length;
    const status = over
      ? "blocked"
      : run.cancelRequested
        ? "cancelled"
        : (result.state ?? (end ? "completed" : "queued"));
    await tx.agentRun.update({
      where: { id: runId },
      data: {
        status,
        stage: { increment: result.advance === false ? 0 : 1 },
        ...(plan !== run.plan ? { plan: json(plan) } : {}),
        result: json(result.data),
        leaseToken: "",
        leaseUntil: null,
        reservedCents: { decrement: step.reservedCents },
        chargedCents: { increment: cents },
        error: over
          ? "El consumo superó la reserva: revisa las tarifas antes de continuar."
          : "",
      },
    });
    if (over)
      await tx.agentWorkspace.update({
        where: { businessId: run.businessId },
        data: { enabled: false, revision: { increment: 1 } },
      });
    if (result.text)
      await tx.agentMessage.upsert({
        where: { runId_role: { runId, role: "assistant" } },
        create: {
          businessId: run.businessId,
          runId,
          role: "assistant",
          text: result.text.slice(0, 6000),
        },
        update: { text: result.text.slice(0, 6000) },
      });
  });
}
/**
 * Unknown provider outcomes retain the full charge reservation; never auto-repeat them.
 * `refused`: the step refused before it wrote or spent anything (a `Refusal`, such as the guard's). Then a running step
 * that reserved nothing is settled as `blocked`, with nothing charged, and the run ends `blocked`, not `uncertain`. A step
 * that holds a reservation is still uncertain: its outcome is not known.
 * `unspent`: the step failed before it started any paid call (a team agent's model step, see `oneCall` in spend.ts), so its
 * outcome is known: nothing was spent. Its reservation is released, not charged, and it ends `blocked` like a refusal.
 */
export async function failRun(
  runId: string,
  token: string,
  message: string,
  opts: { refused?: boolean; unspent?: boolean } = {},
) {
  const r = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  return locked(r.businessId, async (tx) => {
    const run = await tx.agentRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.leaseToken !== token || run.status !== "running") return;
    const open = await tx.agentStep.findMany({
      where: { runId, status: "running" },
    });
    let charged = 0;
    let held = 0;
    for (const step of open) {
      if (opts.unspent || (opts.refused && step.reservedCents === 0)) {
        if (step.reservedCents)
          await tx.agentBudget.update({
            where: {
              businessId_day: { businessId: run.businessId, day: step.budgetDay },
            },
            data: { reservedCents: { decrement: step.reservedCents } },
          });
        await tx.agentStep.update({
          where: { id: step.id },
          data: { status: "blocked", error: message, finishedAt: new Date() },
        });
        continue;
      }
      held++;
      charged += step.reservedCents;
      await tx.agentBudget.update({
        where: {
          businessId_day: { businessId: run.businessId, day: step.budgetDay },
        },
        data: {
          reservedCents: { decrement: step.reservedCents },
          chargedCents: { increment: step.reservedCents },
        },
      });
      await tx.agentStep.update({
        where: { id: step.id },
        data: {
          status: "uncertain",
          chargedCents: step.reservedCents,
          error: message,
          finishedAt: new Date(),
        },
      });
    }
    const status = run.cancelRequested
      ? "cancelled"
      : held
        ? "uncertain"
        : "blocked";
    await tx.agentRun.update({
      where: { id: runId },
      data: {
        status,
        error: message,
        reservedCents: 0,
        chargedCents: { increment: charged },
        leaseToken: "",
        leaseUntil: null,
      },
    });
    await tx.agentMessage.upsert({
      where: { runId_role: { runId, role: "assistant" } },
      create: {
        businessId: run.businessId,
        runId,
        role: "assistant",
        text: message,
      },
      update: { text: message },
    });
  });
}
export async function recoverExpired() {
  const expired = await db.agentRun.findMany({
    where: { status: "running", leaseUntil: { lt: new Date() } },
    take: 30,
  });
  for (const run of expired)
    await failRun(
      run.id,
      run.leaseToken,
      "La ejecución se interrumpió. Conservé sus resultados y no repetí llamadas ni publicaciones. Revisa el paso pendiente.",
    );
  return expired.length;
}
/**
 * Cancels one run: its scheduled posts go back to draft while still unclaimed (an in-flight provider call cannot be undone;
 * its status remains visible in History), a run that is waiting is cancelled at once and a running one finishes its step in
 * flight and is cancelled there (`finishStep`). A run that already ended is returned as it is. Runs inside the caller's
 * business lock.
 */
async function cancelRun(tx: Prisma.TransactionClient, run: AgentRun) {
  if (terminal.includes(run.status)) return run;
  await tx.post.updateMany({
    where: {
      businessId: run.businessId,
      campaign: { agentRunId: run.id },
      status: "scheduled",
    },
    data: { status: "draft" },
  });
  return tx.agentRun.update({
    where: { id: run.id },
    data: {
      cancelRequested: true,
      ...(run.status === "running" ? {} : { status: "cancelled" }),
    },
  });
}
export async function changeRun(
  businessId: string,
  runId: string,
  action: "cancel" | "approve" | "refresh" | "redo",
) {
  return locked(businessId, async (tx) => {
    const run = await tx.agentRun.findFirst({
      where: { id: runId, businessId },
    });
    if (!run) throw new AgentError("Trabajo no encontrado.", 404);
    if (action === "cancel") return cancelRun(tx, run);
    const settings = await tx.agentWorkspace.findUniqueOrThrow({
      where: { businessId },
    });
    if (action === "approve") {
      if (run.status !== "waiting_approval")
        throw new AgentError("Este trabajo no espera aprobación.");
      if (!settings.enabled || !settings.allowPublish)
        throw new AgentError(
          "Activa el permiso de publicación de MATYA antes de aprobar.",
        );
      return tx.agentRun.update({
        where: { id: runId },
        data: { status: "queued", approvedAt: new Date() },
      });
    }
    if (action === "redo") return redo(tx, run, settings.enabled);
    if (run.status !== "waiting_provider")
      throw new AgentError("El trabajo no está esperando una publicación.");
    return tx.agentRun.update({
      where: { id: runId },
      data: { status: "queued" },
    });
  });
}

/**
 * "Pausar todo", in one locked transaction: the workspace is paused (no new work, and no agent post goes out), its revision
 * moves (a post stamped with the old one is refused when it is claimed), every open run is cancelled the way the owner's
 * "Cancelar" does it (a step already running finishes and its run ends cancelled there; none after it starts) and every
 * agent post still scheduled goes back to draft. A post already claimed for publication cannot be undone. A business with
 * no workspace yet gets one, paused. Pausing again keeps the first pause time.
 */
export async function pauseAll(businessId: string): Promise<void> {
  await locked(businessId, async (tx) => {
    const current = await tx.agentWorkspace.findUnique({
      where: { businessId },
      select: { pausedAt: true },
    });
    await tx.agentWorkspace.upsert({
      where: { businessId },
      create: { businessId, pausedAt: new Date() },
      update: {
        pausedAt: current?.pausedAt ?? new Date(),
        revision: { increment: 1 },
      },
    });
    const open = await tx.agentRun.findMany({
      where: { businessId, status: { in: [...OPEN_STATUSES] } },
    });
    for (const run of open) await cancelRun(tx, run);
    // Whatever the agent still has scheduled, whichever run it belongs to.
    await tx.post.updateMany({
      where: {
        businessId,
        status: "scheduled",
        OR: [
          { id: { startsWith: "agent-" } },
          { campaign: { agentRunId: { not: null } } },
        ],
      },
      data: { status: "draft" },
    });
  });
}
/**
 * Lifts "Pausar todo". What it cancelled stays cancelled; new work is accepted again. A morning plan that the pause cancelled is
 * not queued again the same day (its key already holds that day); the next local day brings the next one.
 */
export async function resumeAll(businessId: string): Promise<void> {
  await locked(businessId, (tx) =>
    tx.agentWorkspace.updateMany({
      where: { businessId },
      data: { pausedAt: null },
    }),
  );
}

/**
 * The owner's "Rehacer": a new round before the step that was waiting, even when the
 * automatic round was already used. Only a piece waiting right after a review qualifies.
 * Runs inside the caller's business lock.
 */
async function redo(
  tx: Prisma.TransactionClient,
  run: AgentRun,
  enabled: boolean,
) {
  const piece = piecePlan(run);
  const previous = piece?.steps[run.stage - 1];
  // A piece waiting for the approval of a paid article draft has already been sent back: it cannot be sent back again.
  const waiting = piece?.steps[run.stage];
  if (
    !piece ||
    run.status !== "waiting_approval" ||
    run.cancelRequested ||
    !previous ||
    !/^review(-r\d+)?$/.test(previous.id) ||
    (waiting && isArticleStep(waiting.id))
  )
    throw new AgentError(
      "Solo se puede rehacer una pieza que espera tu aprobación después de su revisión.",
    );
  if (!enabled) throw new AgentError("Activa MATYA para rehacer la pieza.");
  const format = PieceFormat.safeParse(
    (piece.plan.piece as { format?: unknown } | undefined)?.format,
  );
  if (!format.success)
    throw new AgentError("La pieza no tiene un plan válido.");
  const review = await tx.agentStep.findUnique({
    where: { runId_name: { runId: run.id, name: previous.id } },
  });
  const problems =
    review?.status === "succeeded" ? problemsOf(review.output) : [];
  // An approved review still gets a round: the owner asked for it.
  const round = reworkSteps(
    problems.length
      ? problems
      : [
          {
            kind: "dueño",
            detail: "El dueño pidió rehacer la pieza.",
            sendBackTo: "copy",
          },
        ],
    0,
    format.data,
  );
  // The next round number, so the new ids never clash with a step already run.
  const n =
    1 +
    Math.max(
      0,
      ...piece.steps.map((s) =>
        Math.max(s.attempt, Number(/-r(\d+)$/.exec(s.id)?.[1] ?? 0)),
      ),
    );
  const added = round.map((s) => ({
    ...s,
    id: s.id.replace(/-r1$/, `-r${n}`),
    attempt: n,
  }));
  if (!added.length) throw new AgentError("No hay nada que rehacer.");
  // Inserted at the waiting step's place: the stage now points at the first new step.
  return tx.agentRun.update({
    where: { id: run.id },
    data: {
      status: "queued",
      approvedAt: null,
      plan: json({
        ...piece.plan,
        steps: [
          ...piece.steps.slice(0, run.stage),
          ...added,
          ...piece.steps.slice(run.stage),
        ],
      }),
    },
  });
}
/**
 * Creates the parent's pieces as child runs, once each (`requestKey = parent:pieceId`).
 * Returns them in piece order, the existing ones included. A cancelled parent creates
 * nothing. It never checks the open-work cap: dispatch keeps within the daily post cap.
 */
export async function spawnPieces(
  parent: AgentRun,
  pieces: Piece[],
): Promise<AgentRun[]> {
  const valid = pieces.map((p) => Piece.parse(p));
  return locked(parent.businessId, async (tx) => {
    const current = await tx.agentRun.findUniqueOrThrow({
      where: { id: parent.id },
    });
    if (current.cancelRequested) return [];
    const children: AgentRun[] = [];
    for (const piece of valid) {
      const requestKey = `${current.requestKey}:${piece.id}`;
      const prior = await tx.agentRun.findUnique({
        where: {
          businessId_requestKey: { businessId: current.businessId, requestKey },
        },
      });
      children.push(
        prior ??
          (await tx.agentRun.create({
            data: {
              businessId: current.businessId,
              requestKey,
              kind: "piece",
              prompt: current.prompt,
              parentRunId: current.id,
              origin: current.origin,
              context: json({
                ...(current.context as Record<string, unknown>),
                piece,
              }),
              plan: json({
                kind: "piece",
                piece,
                steps: stepsForPiece(piece.format),
              }),
            },
          })),
      );
    }
    return children;
  });
}
