// La lectura del equipo: los encargos que ven el tablero Hoy, las alertas por email y la sección MATYA del reporte diario.
// Es un módulo de bajo nivel (base de datos y `queue`, nada más): `service.ts` lo reexporta y `alerts.ts` y `daily-section.ts` lo
// importan de aquí, nunca de `service.ts` (que llama a las alertas y al reporte diario: sería un ciclo de importaciones).
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { businessTz, dayRange, localDay } from "@/lib/business-tz";
import { OPEN_STATUSES } from "./queue";
import type { TeamRunView } from "./team-view";

/** The most runs the team's view loads, and the most open ones among them. */
const TEAM_RUNS_MAX = 40;
export const objectOrNull = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/**
 * The team's runs for the board: every open team request and piece of any day (the owner must see everything that waits for
 * them), then the ones created today (the business's local day) that are done, up to `TEAM_RUNS_MAX` in all. Oldest first, each
 * with its steps and the message the owner reads (its last `assistant` one). The alerts and the daily report read the same list.
 */
export async function loadTeamRuns(
  businessId: string,
  now = new Date(),
): Promise<{ today: string; tz: string; runs: TeamRunView[] }> {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { timezone: true },
  });
  const tz = businessTz(business);
  const today = localDay(now, tz);
  const { from, to } = dayRange(tz, today);
  // The newest first: when there are more than `take`, the oldest are the ones left out.
  const read = (where: Prisma.AgentRunWhereInput, take: number) =>
    db.agentRun.findMany({
      where: { businessId, kind: { in: ["team", "piece"] }, ...where },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      select: {
        id: true,
        kind: true,
        origin: true,
        parentRunId: true,
        status: true,
        stage: true,
        plan: true,
        error: true,
        chargedCents: true,
        createdAt: true,
        steps: {
          orderBy: { createdAt: "asc" },
          select: {
            name: true,
            agent: true,
            model: true,
            attempt: true,
            status: true,
            output: true,
            error: true,
            chargedCents: true,
            createdAt: true,
            finishedAt: true,
          },
        },
      },
    });
  const open = await read({ status: { in: [...OPEN_STATUSES] } }, TEAM_RUNS_MAX);
  const done = TEAM_RUNS_MAX > open.length
    ? await read(
        { status: { notIn: [...OPEN_STATUSES] }, createdAt: { gte: from, lt: to } },
        TEAM_RUNS_MAX - open.length,
      )
    : [];
  // A run that finished between the two reads is in both: it counts once.
  const rows = [...new Map([...open, ...done].map((r) => [r.id, r])).values()].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1),
  );
  const messages = rows.length
    ? await db.agentMessage.findMany({
        where: { businessId, runId: { in: rows.map((r) => r.id) }, role: "assistant" },
        select: { runId: true, text: true },
      })
    : [];
  const said = new Map(messages.map((m) => [m.runId, m.text]));
  return {
    today,
    tz,
    runs: rows.map((r) => ({
      id: r.id,
      kind: r.kind === "team" ? "team" : "piece",
      origin: r.origin,
      parentRunId: r.parentRunId,
      status: r.status,
      stage: r.stage,
      plan: r.plan,
      error: r.error,
      chargedCents: r.chargedCents,
      createdAt: r.createdAt.toISOString(),
      message: said.get(r.id) ?? "",
      steps: r.steps.map((s) => ({
        name: s.name,
        agent: s.agent,
        model: s.model,
        attempt: s.attempt,
        status: s.status,
        output: objectOrNull(s.output),
        error: s.error,
        chargedCents: s.chargedCents,
        createdAt: s.createdAt.toISOString(),
        finishedAt: s.finishedAt?.toISOString() ?? null,
      })),
    })),
  };
}
