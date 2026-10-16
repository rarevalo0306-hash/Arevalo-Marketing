// Las alertas del equipo por email: lo que de verdad necesita al dueño (un video que espera su visto bueno, una pieza que no pasó
// la revisión, un canal frenado, el presupuesto del día agotado, MATYA apagada por un gasto de más, el plan de la mañana detenido).
// `alertFacts` y `buildAlertEmail` son puras (sin base de datos ni red). `sendAgentAlerts` la llama la vuelta global del agente, cada
// minuto: manda un solo email por negocio con todo lo nuevo, agrupado por tipo, y nunca más de `ALERTS_PER_DAY` al día.
//
// Cada hecho tiene una clave (`video:<encargo>`, `freno:<canal>:<guardado>`...) y cada envío queda en `SeoReport` `kind: "agent_alert"`
// con las claves que contó: un hecho que sigue en pie no se repite durante 30 días, y uno que falla al enviarse no se reintenta
// (sus claves ya están anotadas; así un correo roto no se repite cada minuto). Las caídas de Google siguen en las alertas de SEO.
import { dayRange } from "@/lib/business-tz";
import { dailyRecipients, emailLang, publicBase } from "@/lib/daily-report";
import { db } from "@/lib/db";
import { channelLabel } from "@/lib/report-period";
import { SenderConfigError, sendSeoEmail } from "@/lib/seo/alerts";
import { escapeHtml } from "@/lib/text";
import { dailyPlanKey } from "./daily";
import { brakedOf } from "./guard";
import { stepsOfPlan } from "./plan";
import { DAY_BUDGET_ERROR, OVER_RESERVATION_ERROR, json, locked } from "./queue";
import { loadTeamRuns } from "./team-load";
import { needsYou, type TeamRunView } from "./team-view";

export type AlertType = "video" | "revision" | "freno" | "presupuesto" | "apagado" | "plan";
export type AlertFact = { type: AlertType; key: string; text: { es: string; en: string } };
type Lang = "es" | "en";

/** The most alert emails a business gets in its local day. */
export const ALERTS_PER_DAY = 5;
/** How long a sent alert's keys are remembered: a fact that still stands after that is told again. */
const KEEP_MS = 30 * 24 * 3600_000;
/** How far back a run that shut MATYA off still counts. */
const SHUTDOWN_MS = 24 * 3600_000;

/** What each type says in the subject (after "MATYA te necesita: ") and, with a capital letter, as the title of its section. */
const LABEL: Record<AlertType, { es: string; en: string }> = {
  video: { es: "un video espera tu aprobación", en: "a video is waiting for your approval" },
  revision: { es: "una pieza no pasó la revisión", en: "a piece did not pass the review" },
  freno: { es: "un canal salió del plan", en: "a channel left the plan" },
  presupuesto: { es: "se acabó el presupuesto de hoy", en: "today's budget ran out" },
  apagado: { es: "MATYA se apagó sola", en: "MATYA turned itself off" },
  plan: { es: "el plan de la mañana se detuvo", en: "the morning plan stopped" },
};

/** A piece's topic as the fact quotes it, with its leading space: nothing when it has none. */
const quoted = (topic: string) => {
  const t = topic.trim().slice(0, 120);
  return t ? { es: ` «${t}»`, en: ` “${t}”` } : { es: "", en: "" };
};

/**
 * What needs the owner, as facts with their keys (see the table in the plan): a video waiting for its go-ahead and a piece whose
 * review failed (both from `needsYou`, oldest first), each braked channel, the day's budget gone, MATYA off after a charge went over
 * its reservation, and the morning plan blocked or uncertain. In that order. `braked.savedAt` is when the owner last saved the
 * channel's connection (or "nunca"): saving it again and failing twice more is a new fact. `runs` is the team's view (`loadTeamRuns`).
 */
export function alertFacts(input: {
  day: string;
  runs: TeamRunView[];
  braked: { channel: string; savedAt: string }[];
  dayBudgetBlocked: boolean;
  selfDisabled: { runId: string } | null;
  dailyRun: { status: string } | null;
}): AlertFact[] {
  const facts: AlertFact[] = [];
  const needs = needsYou(input.runs);
  const byId = new Map(input.runs.map((r) => [r.id, r]));
  for (const n of needs) {
    if (n.kind !== "video") continue;
    const q = quoted(n.topic);
    facts.push({
      type: "video",
      key: `video:${n.runId}`,
      text: {
        es: `El video${q.es} espera tu aprobación para generarse. Mira cuánto cuesta y decide.`,
        en: `The video${q.en} is waiting for your approval before it is made. Check its cost and decide.`,
      },
    });
  }
  for (const n of needs) {
    if (n.kind !== "revision") continue;
    const run = byId.get(n.runId);
    // The review that failed is the step right before the one the piece waits at; a new round that fails again is a new review.
    const failed = run ? (stepsOfPlan(run.plan)?.[run.stage - 1] ?? "") : "";
    const q = quoted(n.topic);
    facts.push({
      type: "revision",
      key: `revision:${n.runId}:${failed}`,
      text: {
        es: `La pieza${q.es} no pasó la revisión. Mira qué falló y decide si se rehace.`,
        en: `The piece${q.en} did not pass the review. See what failed and decide whether to redo it.`,
      },
    });
  }
  for (const b of input.braked)
    facts.push({
      type: "freno",
      key: `freno:${b.channel}:${b.savedAt}`,
      text: {
        es: `Canal frenado: ${channelLabel(b.channel, "es")}. Sus dos últimos envíos fallaron. Revisa la conexión y vuelve a guardarla para que el equipo lo use otra vez.`,
        en: `Braked channel: ${channelLabel(b.channel, "en")}. Its last two deliveries failed. Check the connection and save it again so the team uses it again.`,
      },
    });
  if (input.dayBudgetBlocked)
    facts.push({
      type: "presupuesto",
      key: `presupuesto:${input.day}`,
      text: {
        es: "El equipo llegó al límite de gasto de IA de hoy y no hará más llamadas de pago hasta mañana. Puedes subir el límite diario en la configuración de MATYA.",
        en: "The team reached today's AI spending limit and will make no more paid calls until tomorrow. You can raise the daily limit in the MATYA settings.",
      },
    });
  if (input.selfDisabled)
    facts.push({
      type: "apagado",
      key: `apagado:${input.selfDisabled.runId}`,
      text: {
        es: "MATYA se apagó sola porque un gasto superó lo reservado. Revisa las tarifas de los modelos antes de volver a activarla.",
        en: "MATYA turned itself off because a charge went over what was reserved. Check the model prices before turning it back on.",
      },
    });
  if (input.dailyRun && (input.dailyRun.status === "blocked" || input.dailyRun.status === "uncertain"))
    facts.push({
      type: "plan",
      key: `plan:${input.day}`,
      text: {
        es: "El plan de la mañana de hoy se detuvo antes de terminar. Abre el Centro MATYA para ver el motivo.",
        en: "This morning's plan stopped before it finished. Open the MATYA Center to see why.",
      },
    });
  return facts;
}

const FONT = "font-family:Arial,Helvetica,sans-serif;";
const COLOR = "#126BBC";
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The email for the facts of one tick: the subject names the first type (and "y N avisos más" for the other types), and the body has
 * a section per type, in the order the types first appear, with its facts and a button to the business's Centro MATYA. Everything
 * the owner or the AI wrote goes through `escapeHtml`.
 */
export function buildAlertEmail(
  business: { id: string; name: string },
  facts: AlertFact[],
  lang: Lang,
  base: string,
): { subject: string; html: string; text: string } {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const groups = new Map<AlertType, string[]>();
  for (const f of facts) groups.set(f.type, [...(groups.get(f.type) ?? []), f.text[lang]]);
  const types = [...groups.keys()];
  const more = types.length - 1;
  const head = t("MATYA te necesita", "MATYA needs you");
  const subject =
    (types.length ? `${head}: ${LABEL[types[0]][lang]}` : head) +
    (more > 0 ? t(` y ${more} ${more === 1 ? "aviso" : "avisos"} más`, ` and ${more} more ${more === 1 ? "alert" : "alerts"}`) : "");
  // The center opens on Hoy, where what needs the owner is.
  const url = `${base.replace(/\/+$/, "")}/b/${encodeURIComponent(business.id)}/matya?tab=today`;
  const button = t("Abrir el Centro MATYA", "Open the MATYA Center");
  const footer = t(
    `Este email lo manda Matya para ${business.name}. Son como máximo ${ALERTS_PER_DAY} avisos del equipo al día.`,
    `This email is sent by Matya for ${business.name}. It is at most ${ALERTS_PER_DAY} team alerts a day.`,
  );
  const sections = types.map((type) => {
    const title = capital(LABEL[type][lang]);
    const items = groups.get(type) ?? [];
    return {
      title,
      items,
      html: [
        `<tr><td style="${FONT}padding:20px 0 6px 0;font-size:17px;font-weight:bold;color:${COLOR};border-bottom:2px solid ${COLOR};">${escapeHtml(title)}</td></tr>`,
        ...items.map(
          (item) =>
            `<tr><td style="${FONT}padding:8px 0 0 0;font-size:15px;line-height:1.5;color:#1f2933;">• ${escapeHtml(item)}</td></tr>`,
        ),
      ].join("\n"),
    };
  });
  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;"><tr><td align="center" style="padding:16px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;">
<tr><td style="${FONT}background:${COLOR};color:#ffffff;padding:18px 22px 20px 22px;border-radius:10px 10px 0 0;">
<div style="font-size:12px;letter-spacing:1.5px;font-weight:bold;">MATYA</div>
<div style="font-size:14px;margin-top:8px;">${escapeHtml(business.name)}</div>
<div style="font-size:23px;font-weight:bold;line-height:1.25;">${escapeHtml(head)}</div>
</td></tr>
<tr><td style="padding:0 22px 12px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${sections.map((s) => s.html).join("\n")}
</table></td></tr>
<tr><td align="center" style="padding:12px 22px 22px 22px;"><a href="${escapeHtml(url)}" style="${FONT}display:inline-block;background:${COLOR};color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 24px;border-radius:8px;">${escapeHtml(button)}</a></td></tr>
<tr><td style="${FONT}padding:14px 22px 20px 22px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280;">${escapeHtml(footer)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    "MATYA",
    `${business.name} — ${head}`,
    ...sections.flatMap((s) => ["", s.title.toUpperCase(), ...s.items.map((item) => `- ${item}`)]),
    "",
    `${button}: ${url}`,
    "",
    footer,
  ].join("\n");
  return { subject, html, text };
}

type Reader = { seoReport: Pick<typeof db.seoReport, "findMany"> };
/** The keys of every alert recorded in the last 30 days (sent, being sent or failed: a failed one is not retried). */
async function recordedKeys(client: Reader, businessId: string, now: Date): Promise<Set<string>> {
  const rows = await client.seoReport.findMany({
    where: { businessId, kind: "agent_alert", createdAt: { gte: new Date(now.getTime() - KEEP_MS) } },
    select: { data: true },
  });
  const keys = new Set<string>();
  for (const { data } of rows) {
    const list = typeof data === "object" && data !== null && !Array.isArray(data) ? data.keys : undefined;
    if (Array.isArray(list)) for (const k of list) if (typeof k === "string") keys.add(k);
  }
  return keys;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 400);
/** What a log line may say about an error: its kind, never its message (it may carry a provider's answer). */
const errName = (e: unknown) => (e instanceof SenderConfigError ? "SenderConfigError" : e instanceof Error ? e.name : "unknown");

type Workspace = { businessId: string; enabled: boolean; channels: string[]; allowWebArticles: boolean };
type Outcome = "none" | "skipped" | "sent" | "failed";

/** The facts of one business now, read with its team's view (`loadTeamRuns`) and the few things that view does not hold. */
async function factsOf(w: Workspace, now: Date): Promise<{ facts: AlertFact[]; day: string }> {
  const { businessId } = w;
  const { today, tz, runs } = await loadTeamRuns(businessId, now);
  const { from, to } = dayRange(tz, today);
  // The channels the team can send to, as `pieceLimits` and the guard read them (the agent never uses youtube).
  const channels = [...new Set([...w.channels, ...(w.allowWebArticles ? ["seo"] : [])])].filter((c) => c !== "youtube");
  const connections = await db.connection.findMany({ where: { businessId }, select: { channel: true, updatedAt: true } });
  const saved = new Map(connections.map((c) => [c.channel, c.updatedAt.toISOString()]));
  const [braked, spent, shutdown, dailyRun] = await Promise.all([
    brakedOf(db, businessId, channels, connections),
    db.agentRun.findFirst({
      where: { businessId, kind: { in: ["team", "piece"] }, status: "blocked", error: DAY_BUDGET_ERROR, updatedAt: { gte: from, lt: to } },
      select: { id: true },
    }),
    // MATYA turns itself off when a charge goes over its reservation (`finishStep`): only worth saying while it is still off.
    w.enabled
      ? null
      : db.agentRun.findFirst({
          where: { businessId, error: OVER_RESERVATION_ERROR, updatedAt: { gte: new Date(now.getTime() - SHUTDOWN_MS) } },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          select: { id: true },
        }),
    db.agentRun.findUnique({
      where: { businessId_requestKey: { businessId, requestKey: dailyPlanKey(businessId, today) } },
      select: { status: true },
    }),
  ]);
  const facts = alertFacts({
    day: today,
    runs,
    braked: braked.map((channel) => ({ channel, savedAt: saved.get(channel) ?? "nunca" })),
    dayBudgetBlocked: spent !== null,
    selfDisabled: shutdown ? { runId: shutdown.id } : null,
    dailyRun,
  });
  return { facts, day: today };
}

/** The email of one business: what is new, in one message, if the day's cap and the recipients allow it. */
async function alertBusiness(w: Workspace, now: Date): Promise<Outcome> {
  const { businessId } = w;
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, reportEmail: true, ownerEmail: true, seoEmailLang: true },
  });
  if (!business) return "none";
  const { facts, day } = await factsOf(w, now);
  // Nothing to say: the registry of the last 30 days is not read (this runs for every team business every minute).
  if (!facts.length) return "none";
  const recorded = await recordedKeys(db, businessId, now);
  if (!facts.some((f) => !recorded.has(f.key))) return "none";
  const to = dailyRecipients(business);
  if (!to.length) return "skipped";

  // Under the business's lock, so two ticks at once cannot both claim the same facts or pass the day's cap together: the record
  // is made, and the day's count raised, before anything is sent.
  const claim = await locked(businessId, async (tx) => {
    const fresh = facts.filter((f) => !recorded.has(f.key));
    const taken = await recordedKeys(tx, businessId, now);
    const news = fresh.filter((f) => !taken.has(f.key));
    if (!news.length) return "none" as const;
    const budget = await tx.agentBudget.upsert({
      where: { businessId_day: { businessId, day } },
      create: { businessId, day },
      update: {},
    });
    if (budget.alerts >= ALERTS_PER_DAY) return "capped" as const;
    const email = buildAlertEmail(business, news, emailLang(business.seoEmailLang), publicBase());
    const data = {
      version: 1,
      day,
      keys: news.map((f) => f.key),
      types: [...new Set(news.map((f) => f.type))],
      state: "sending",
      to,
      subject: email.subject,
    };
    const row = await tx.seoReport.create({
      data: { businessId, kind: "agent_alert", data: json(data), createdAt: now },
      select: { id: true },
    });
    await tx.agentBudget.update({ where: { id: budget.id }, data: { alerts: { increment: 1 } } });
    return { id: row.id, data, email };
  });
  if (claim === "none") return "none";
  if (claim === "capped") return "skipped";

  try {
    await sendSeoEmail({ businessId, to, ...claim.email });
  } catch (error) {
    console.error("MATYA alert did not send", { businessId, error: errName(error) });
    // Not retried (its keys stay recorded), and the day's count is given back: a failed email is not one of the five.
    await db
      .$transaction([
        db.seoReport.update({ where: { id: claim.id }, data: { data: json({ ...claim.data, state: "error", error: errText(error) }) } }),
        db.agentBudget.updateMany({ where: { businessId, day, alerts: { gt: 0 } }, data: { alerts: { decrement: 1 } } }),
      ])
      .catch(() => console.error("MATYA alert record did not update", { businessId }));
    return "failed";
  }
  await db.seoReport
    .update({ where: { id: claim.id }, data: { data: json({ ...claim.data, state: "sent", sentAt: new Date().toISOString() }) } })
    .catch(() => console.error("MATYA alert record did not update", { businessId }));
  return "sent";
}

const PAGE = 100;

/**
 * Sends the team's alerts: for each business with team mode on (MATYA on or off, paused or not), one email with every fact that is
 * new, to the report's recipients, unless the business already had `ALERTS_PER_DAY` today. In the order of `businessId`; one business
 * that fails never stops the others. At most `max` (5) businesses are mailed per call: one with nothing new, no recipient or its
 * day's cap reached costs none of them, so the ones after it are not left waiting. `skipped`: had something new, but no email went.
 */
export async function sendAgentAlerts(
  now = new Date(),
  opts: { max?: number } = {},
): Promise<{ sent: number; skipped: number; errors: number }> {
  const max = opts.max ?? 5;
  const out = { sent: 0, skipped: 0, errors: 0 };
  let mailed = 0;
  let after: string | undefined;
  for (;;) {
    const page = await db.agentWorkspace.findMany({
      where: { teamMode: true },
      select: { businessId: true, enabled: true, channels: true, allowWebArticles: true },
      orderBy: { businessId: "asc" },
      take: PAGE,
      ...(after ? { cursor: { businessId: after }, skip: 1 } : {}),
    });
    for (const w of page) {
      if (mailed >= max) return out;
      try {
        const outcome = await alertBusiness(w, now);
        if (outcome === "skipped") out.skipped++;
        else if (outcome === "sent") out.sent++;
        else if (outcome === "failed") out.errors++;
        if (outcome === "sent" || outcome === "failed") mailed++;
      } catch (error) {
        out.errors++;
        console.error("MATYA alerts did not complete", { businessId: w.businessId, error: errName(error) });
      }
    }
    if (page.length < PAGE) return out;
    after = page[page.length - 1].businessId;
  }
}
