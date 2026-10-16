// El plan de la mañana: a la hora del dueño (`dailyHour`, en la hora de su negocio) cada negocio con modo equipo recibe un
// encargo `team` "Plan del día" con las señales del día. Una sola vez por día local: el día va en la clave del encargo
// (`daily-<negocio>-<día>`), así que dos vueltas a la vez crean uno solo (`@@unique([businessId, requestKey])`).
import { businessTz, isDay, localDay } from "@/lib/business-tz";
import { db } from "@/lib/db";
import { AgentError } from "./access";
import { enqueue, OPEN_RUN_CAP, OPEN_STATUSES } from "./queue";
import { collectSignals } from "./signals";

/** Minutes shown by the business's wall clock since its midnight (07:30 is 450 whatever the day's length). */
function clockMinutes(tz: string, now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return at("hour") * 60 + at("minute");
}

/**
 * The local day (`YYYY-MM-DD`) whose plan is due now, or null. It is due when the business's clock has reached `dailyHour`
 * and that day has no plan yet (`lastDay` is the day of the latest plan, or null). The clock is the one on the wall, not the
 * minutes elapsed since midnight: a day of 23 or 25 hours (daylight saving) would otherwise bring the plan an hour early or late.
 * A repeated hour (the clock goes back) or a missing one (it goes forward) still gives exactly one plan that day, because
 * `lastDay` already holds it.
 */
export function isDailyDue(dailyHour: number, tz: string, now: Date, lastDay: string | null): string | null {
  if (!Number.isInteger(dailyHour) || dailyHour < 0 || dailyHour > 23) return null;
  const day = localDay(now, tz);
  if (isDay(lastDay) && lastDay >= day) return null;
  return clockMinutes(tz, now) >= dailyHour * 60 ? day : null;
}

/** The request key of a business's plan for a local day: the day is what makes it once a day. */
const planKey = (businessId: string, day: string) => `daily-${businessId}-${day}`;
const DAILY_KEY = /^daily-.+-(\d{4}-\d{2}-\d{2})$/;

/** The day of the business's latest morning plan (read from its request key), or null when it never had one. */
async function lastDailyDay(businessId: string): Promise<string | null> {
  const last = await db.agentRun.findFirst({
    where: { businessId, kind: "team", origin: "daily", requestKey: { startsWith: planKey(businessId, "") } },
    orderBy: { createdAt: "desc" },
    select: { requestKey: true },
  });
  const day = DAILY_KEY.exec(last?.requestKey ?? "")?.[1];
  return isDay(day) ? day : null;
}

const PAGE = 100;

/**
 * Puts the morning plan in the queue for every business that is due: team mode on, MATYA on, not paused, a daily budget
 * and the hour reached with no plan yet that local day. Returns how many it queued (a tick that lost a race to another
 * tick for the same plan may count it too; the queue holds it once). One business whose plan cannot be made (the open-work
 * cap, a pause that came in meanwhile, a read that failed) never stops the others, and is tried again on the next tick.
 * `businessId` limits it to one business.
 */
export async function enqueueDailyPlans(now = new Date(), businessId?: string): Promise<number> {
  let queued = 0;
  let after: string | undefined;
  for (;;) {
    const page = await db.agentWorkspace.findMany({
      where: {
        ...(businessId ? { businessId } : {}),
        teamMode: true,
        enabled: true,
        pausedAt: null,
        dailyBudgetCents: { gt: 0 },
      },
      include: { business: { select: { timezone: true } } },
      orderBy: { businessId: "asc" },
      take: PAGE,
      ...(after ? { cursor: { businessId: after }, skip: 1 } : {}),
    });
    for (const w of page) {
      try {
        const tz = businessTz(w.business);
        // Not yet the hour: no need to look for the latest plan.
        if (!isDailyDue(w.dailyHour, tz, now, null)) continue;
        const day = isDailyDue(w.dailyHour, tz, now, await lastDailyDay(w.businessId));
        if (!day) continue;
        // With the open-work cap reached `enqueue` would refuse the plan: do not read the signals for nothing, try again next tick.
        const open = await db.agentRun.count({ where: { businessId: w.businessId, status: { in: [...OPEN_STATUSES] } } });
        if (open >= OPEN_RUN_CAP) continue;
        const signals = await collectSignals(w.businessId, now);
        await enqueue(
          w.businessId,
          { kind: "team", text: "Plan del día", requestKey: planKey(w.businessId, day) },
          { origin: "daily", extraContext: { signals } },
        );
        queued++;
      } catch (error) {
        // The cap, a pause and the like are expected and say so in Spanish; anything else is worth a line in the log.
        if (!(error instanceof AgentError))
          console.error("MATYA daily plan did not complete", {
            businessId: w.businessId,
            error: error instanceof Error ? error.name : "unknown",
          });
      }
    }
    if (page.length < PAGE) return queued;
    after = page[page.length - 1].businessId;
  }
}
