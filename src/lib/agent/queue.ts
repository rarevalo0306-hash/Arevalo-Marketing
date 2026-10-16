import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
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
import { sourceUrl } from "./network";
import { newsFresh } from "./freshness";

export const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const LEASE_MS = 4 * 60000;
const terminal = ["completed", "blocked", "uncertain", "cancelled"];
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
export async function enqueue(businessId: string, raw: unknown) {
  const input = MessageInput.parse(raw);
  const kind = input.kind ?? inferKind(input.text);
  const context = await loadContext(businessId);
  if (input.campaignId) {
    const c = await db.campaign.findFirst({
      where: { id: input.campaignId, businessId },
    });
    if (!c) throw new AgentError("Campaña no encontrada.", 404);
    context.campaignId = c.id;
  }
  if (kind === "pause" && !context.campaignId)
    throw new AgentError("Selecciona la campaña que quieres pausar.");
  if (input.newsId) {
    const n = await db.agentNews.findFirst({
      where: { id: input.newsId, businessId },
    });
    if (!n || (kind !== "verify_news" && !newsFresh(n)))
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
    const pending = await tx.agentRun.count({
      where: {
        businessId,
        status: {
          in: ["queued", "running", "waiting_approval", "waiting_provider"],
        },
      },
    });
    if (pending >= 8)
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
    orderBy: { createdAt: "asc" },
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
) {
  if (!Number.isSafeInteger(cost) || cost < 0)
    throw new AgentError("Reserva no válida.");
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
    if (
      !["briefing", "pause"].includes(run.kind) &&
      settings.revision !== context.revision
    )
      throw new AgentError(
        "El conocimiento o los permisos cambiaron. Crea un encargo nuevo con la configuración actual.",
      );
    if (!["briefing", "pause"].includes(run.kind) && !settings.enabled)
      throw new AgentError(
        "Activa MATYA y define sus límites para ejecutar este encargo.",
      );
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
        specialist: roleFor(name),
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
    const end = run.stage + 1 >= stepsFor(run.kind as RunKind).length;
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
/** Unknown provider outcomes retain the full charge reservation; never auto-repeat them. */
export async function failRun(runId: string, token: string, message: string) {
  const r = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  return locked(r.businessId, async (tx) => {
    const run = await tx.agentRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.leaseToken !== token || run.status !== "running") return;
    const open = await tx.agentStep.findMany({
      where: { runId, status: "running" },
    });
    let charged = 0;
    for (const step of open) {
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
      : open.length
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
export async function changeRun(
  businessId: string,
  runId: string,
  action: "cancel" | "approve" | "refresh",
) {
  return locked(businessId, async (tx) => {
    const run = await tx.agentRun.findFirst({
      where: { id: runId, businessId },
    });
    if (!run) throw new AgentError("Trabajo no encontrado.", 404);
    if (action === "cancel") {
      if (terminal.includes(run.status)) return run;
      // Scheduled agent posts are reverted only while still unclaimed. An in-flight
      // provider call cannot be undone; its status remains visible in History.
      await tx.post.updateMany({
        where: {
          businessId,
          campaign: { agentRunId: runId },
          status: "scheduled",
        },
        data: { status: "draft" },
      });
      return tx.agentRun.update({
        where: { id: runId },
        data: {
          cancelRequested: true,
          ...(run.status === "running" ? {} : { status: "cancelled" }),
        },
      });
    }
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
    if (run.status !== "waiting_provider")
      throw new AgentError("El trabajo no está esperando una publicación.");
    return tx.agentRun.update({
      where: { id: runId },
      data: { status: "queued" },
    });
  });
}
