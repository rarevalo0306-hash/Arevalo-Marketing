// La sección MATYA del reporte diario: tres partes (Ayer, Hoy, Te necesita) y un botón al Centro MATYA, y la regla de cuándo el
// reporte de un negocio con modo equipo puede salir (después del plan de la mañana). `matyaReportReady`, `matyaSectionHtml` y
// `matyaSectionText` son puras. `loadMatyaDaily` lee la base de datos; trae los encargos con `loadTeamRuns` de `./team-load` (nunca de
// `service.ts`: `service.ts` llama al reporte diario, y `daily-report.ts` llega a los encargos por este archivo; sería un ciclo).
import { dayRange } from "@/lib/business-tz";
import { db } from "@/lib/db";
import { money } from "@/lib/ads-shape";
import { channelLabel } from "@/lib/report-period";
import { escapeHtml } from "@/lib/text";
import { clockMinutes, dailyPlanKey } from "./daily";
import { loadTeamRuns, objectOrNull } from "./team-load";
import { isTickStale, needsYou } from "./team-view";

type Lang = "es" | "en";

export type MatyaDaily = {
  /** What the team published on the reported day (its own posts, by channel), the latest results of those posts and what it spent. */
  yesterday: { byChannel: { channel: string; posts: number }[]; reach: number; likes: number; comments: number; cents: number };
  /** Today's morning plan: its goal and its pieces. Null while there is no plan request yet. */
  today: { goal: string; pieces: { topic: string; format: string; channels: string[]; objective: string }[] } | null;
  /** What waits for the owner, oldest first. */
  needs: { topic: string; kind: string }[];
};

/** The plan ended, whichever way: nothing more is coming from it. */
const PLAN_ENDED: ReadonlySet<string> = new Set(["completed", "blocked", "uncertain", "cancelled"]);
/** How long after the plan's hour the report stops waiting for it. */
const WAIT_HOURS = 3;

/**
 * Whether a business's report of yesterday can go out now. A team-mode business waits for the morning plan of today, so the
 * report can tell it; it stops waiting when no plan is coming (team mode off, MATYA off or paused, the once-a-minute call not
 * running) or the plan ended (completed, blocked, uncertain or cancelled), and at the latest `WAIT_HOURS` after `dailyHour` by the
 * business's wall clock (a plan at 21:00 or later never reaches that clock before midnight: that day it waits for the plan itself).
 * `dailyRunStatus` is the status of today's plan request, or null when it does not exist.
 */
export function matyaReportReady(input: {
  teamMode: boolean;
  enabled: boolean;
  paused: boolean;
  tickAt: Date | null;
  dailyHour: number;
  tz: string;
  now: Date;
  dailyRunStatus: string | null;
}): boolean {
  if (!input.teamMode || !input.enabled || input.paused) return true;
  // The same rule as the Hoy screen; `now` is the moment the question is asked.
  if (isTickStale(input.now.toISOString(), input.tickAt?.toISOString() ?? null)) return true;
  if (input.dailyRunStatus !== null && PLAN_ENDED.has(input.dailyRunStatus)) return true;
  return clockMinutes(input.tz, input.now) >= (input.dailyHour + WAIT_HOURS) * 60;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** The most posts a day's targets are read for: far above what the team can publish in a day. */
const TARGETS_MAX = 500;

/**
 * The section's data for the report of `reportDay` (a local day of the business, `tz`), or null when the business does not have
 * team mode on. Yesterday: the team's own posts (ids that start with `agent-`) delivered that day, by channel; the results are the
 * latest `PostMetric` of each delivery; the money is what the team's agents' steps charged on that day. Today: the goal and the pieces
 * the director's morning plan wrote (the `plan` and `dispatch` steps that finished), or null while that request does not exist.
 * What waits for the owner is `needsYou` over the team's open requests.
 */
export async function loadMatyaDaily(businessId: string, reportDay: string, tz: string, now = new Date()): Promise<MatyaDaily | null> {
  const workspace = await db.agentWorkspace.findUnique({ where: { businessId }, select: { teamMode: true } });
  if (!workspace?.teamMode) return null;
  const { from, to } = dayRange(tz, reportDay);
  const team = await loadTeamRuns(businessId, now);
  const [targets, spent, plan] = await Promise.all([
    db.postTarget.findMany({
      where: { status: "sent", sentAt: { gte: from, lt: to }, post: { businessId, id: { startsWith: "agent-" } } },
      select: { id: true, channel: true },
      take: TARGETS_MAX,
    }),
    // The step's `budgetDay` is the local day it reserved on; the steps without an agent are those of the old flows.
    db.agentStep.aggregate({
      where: { budgetDay: reportDay, agent: { not: "" }, run: { businessId } },
      _sum: { chargedCents: true },
    }),
    db.agentRun.findUnique({
      where: { businessId_requestKey: { businessId, requestKey: dailyPlanKey(businessId, team.today) } },
      select: { steps: { where: { name: { in: ["plan", "dispatch"] }, status: "succeeded" }, select: { name: true, output: true } } },
    }),
  ]);

  // The latest result of each delivery (the first of its group in this order).
  const metrics = targets.length
    ? await db.postMetric.findMany({
        where: { postTargetId: { in: targets.map((t) => t.id) } },
        orderBy: [{ postTargetId: "asc" }, { fetchedAt: "desc" }, { id: "desc" }],
        distinct: ["postTargetId"],
        select: { reach: true, likes: true, comments: true },
      })
    : [];
  const channels = new Map<string, number>();
  for (const t of targets) channels.set(t.channel, (channels.get(t.channel) ?? 0) + 1);

  let today: MatyaDaily["today"] = null;
  if (plan) {
    const outputOf = (name: string) => objectOrNull(plan.steps.find((s) => s.name === name)?.output);
    const list = outputOf("dispatch")?.pieces;
    today = {
      goal: text(outputOf("plan")?.goal).trim(),
      pieces: (Array.isArray(list) ? list : []).flatMap((item) => {
        const piece = objectOrNull(item);
        const topic = text(piece?.topic).trim();
        if (!piece || !topic) return [];
        return [
          {
            topic,
            format: text(piece.format),
            channels: Array.isArray(piece.channels) ? piece.channels.filter((c): c is string => typeof c === "string") : [],
            objective: text(piece.objective).trim(),
          },
        ];
      }),
    };
  }

  return {
    yesterday: {
      byChannel: [...channels].map(([channel, posts]) => ({ channel, posts })).sort((a, b) => b.posts - a.posts || (a.channel < b.channel ? -1 : 1)),
      reach: metrics.reduce((sum, m) => sum + m.reach, 0),
      likes: metrics.reduce((sum, m) => sum + m.likes, 0),
      comments: metrics.reduce((sum, m) => sum + m.comments, 0),
      cents: spent._sum.chargedCents ?? 0,
    },
    today,
    needs: needsYou(team.runs).map(({ topic, kind }) => ({ topic, kind })),
  };
}

// ---------- The section as email (pure) ----------

/** The most pieces of the plan and the most waiting items the email lists: the rest is "y N más en el Centro MATYA". */
const LIST_MAX = 8;
const FONT = "font-family:Arial,Helvetica,sans-serif;";
const DEFAULT_COLOR = "#126BBC";

const FORMATS: Record<string, { es: string; en: string }> = {
  post: { es: "Publicación", en: "Post" },
  carrusel: { es: "Carrusel", en: "Carousel" },
  video: { es: "Video", en: "Video" },
  articulo: { es: "Artículo", en: "Article" },
};
const NEEDS: Record<string, { es: string; en: string }> = {
  video: { es: "Un video espera tu aprobación para generarse", en: "A video is waiting for your approval before it is made" },
  articulo: { es: "Un artículo espera tu aprobación", en: "An article is waiting for your approval" },
  revision: { es: "Una pieza no pasó la revisión", en: "A piece did not pass the review" },
  publicar: { es: "Una pieza espera tu visto bueno para publicarse", en: "A piece is waiting for your go-ahead to be published" },
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

type Line = { text: string; meta?: string };
type Part = { title: string; lines: Line[] };

/** The three parts of the section as titles and lines; both the html and the text are written from them. */
function partsOf(m: MatyaDaily, lang: Lang): Part[] {
  const moreText = (rest: number) => (lang === "en" ? `and ${rest} more in the MATYA Center` : `y ${rest} más en el Centro MATYA`);
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const number = new Intl.NumberFormat(lang === "en" ? "en-US" : "es", { maximumFractionDigits: 1 });
  const y = m.yesterday;
  const posts = y.byChannel.reduce((sum, c) => sum + c.posts, 0);

  const before: Line[] = [];
  if (!posts) before.push({ text: t("El equipo no publicó nada ayer.", "The team did not publish anything yesterday.") });
  else {
    before.push({ text: t(posts === 1 ? "El equipo publicó 1 pieza." : `El equipo publicó ${posts} piezas.`, posts === 1 ? "The team published 1 piece." : `The team published ${posts} pieces.`) });
    for (const c of y.byChannel) before.push({ text: `${channelLabel(c.channel, lang)}: ${number.format(c.posts)}` });
    before.push({
      text: [
        `${t("Alcance", "Reach")}: ${number.format(y.reach)}`,
        `${t("Me gusta", "Likes")}: ${number.format(y.likes)}`,
        `${t("Comentarios", "Comments")}: ${number.format(y.comments)}`,
      ].join(" · "),
    });
  }
  if (y.cents > 0) before.push({ text: `${t("Gasto del equipo", "Team spending")}: ${money(y.cents)}` });

  const plan: Line[] = [];
  const day = m.today;
  if (!day || (!day.goal && !day.pieces.length)) plan.push({ text: t("El plan de hoy todavía no está listo.", "Today's plan is not ready yet.") });
  else {
    if (day.goal) plan.push({ text: `${t("Meta del día", "Goal of the day")}: ${clip(day.goal, 300)}` });
    for (const piece of day.pieces.slice(0, LIST_MAX)) {
      const format = FORMATS[piece.format]?.[lang] ?? piece.format;
      const where = piece.channels.map((c) => channelLabel(c, lang)).join(", ");
      plan.push({
        text: clip(piece.topic, 160),
        meta: [[format, where].filter(Boolean).join(" · "), piece.objective ? `${t("Objetivo", "Objective")}: ${clip(piece.objective, 200)}` : ""].filter(Boolean).join(" — "),
      });
    }
    if (day.pieces.length > LIST_MAX) plan.push({ text: moreText(day.pieces.length - LIST_MAX) });
  }

  const asks: Line[] = [];
  for (const need of m.needs.slice(0, LIST_MAX)) {
    const what = NEEDS[need.kind]?.[lang] ?? t("Algo espera tu respuesta", "Something is waiting for your answer");
    const topic = clip(need.topic.trim(), 120);
    asks.push({ text: topic ? `${what}: ${lang === "en" ? `“${topic}”` : `«${topic}»`}` : what });
  }
  if (m.needs.length > LIST_MAX) asks.push({ text: moreText(m.needs.length - LIST_MAX) });
  if (!asks.length) asks.push({ text: t("Nada espera tu respuesta.", "Nothing is waiting for your answer.") });

  return [
    { title: t("Ayer", "Yesterday"), lines: before },
    { title: t("Hoy", "Today"), lines: plan },
    { title: t("Te necesita", "Needs you"), lines: asks },
  ];
}

const centerUrl = (base: string, businessId: string) => `${base.replace(/\/+$/, "")}/b/${encodeURIComponent(businessId)}/matya`;
const sectionTitle = (lang: Lang) => (lang === "en" ? "Your MATYA team" : "Tu equipo MATYA");
const buttonText = (lang: Lang) => (lang === "en" ? "Open the MATYA Center" : "Abrir el Centro MATYA");

/**
 * The section as rows for the report's table (`<tr>`), after its own sections: a title, the three parts (Ayer, Hoy, Te necesita) and
 * the button to the business's Centro MATYA. `color` is the brand color for titles on white; everything the owner or the AI wrote
 * goes through `escapeHtml`.
 */
export function matyaSectionHtml(m: MatyaDaily, lang: Lang, base: string, businessId: string, color: string): string {
  const c = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color.trim()) ? color.trim() : DEFAULT_COLOR;
  const rows: string[] = [
    `<tr><td style="${FONT}padding:22px 0 6px 0;font-size:17px;font-weight:bold;color:${c};border-bottom:2px solid ${c};">${escapeHtml(sectionTitle(lang))}</td></tr>`,
  ];
  for (const part of partsOf(m, lang)) {
    rows.push(`<tr><td style="${FONT}padding:14px 0 2px 0;font-size:15px;font-weight:bold;color:${c};">${escapeHtml(part.title)}</td></tr>`);
    for (const line of part.lines) {
      const meta = line.meta ? `<div style="font-size:12px;color:#6b7280;">${escapeHtml(line.meta)}</div>` : "";
      rows.push(`<tr><td style="${FONT}padding:4px 0;font-size:15px;line-height:1.45;color:#1f2933;">• ${escapeHtml(line.text)}${meta}</td></tr>`);
    }
  }
  rows.push(
    `<tr><td align="center" style="padding:16px 0 6px 0;"><a href="${escapeHtml(centerUrl(base, businessId))}" style="${FONT}display:inline-block;background:${c};color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 24px;border-radius:8px;">${escapeHtml(buttonText(lang))}</a></td></tr>`,
  );
  return rows.join("\n");
}

/** The same section as plain text, written like the report's own sections. */
export function matyaSectionText(m: MatyaDaily, lang: Lang, base: string, businessId: string): string {
  const title = sectionTitle(lang);
  const lines = [`\n${title.toUpperCase()}`, "-".repeat(Math.min(60, title.length))];
  for (const part of partsOf(m, lang)) {
    lines.push("", part.title.toUpperCase());
    for (const line of part.lines) lines.push(`- ${line.text}${line.meta ? ` [${line.meta}]` : ""}`);
  }
  lines.push("", `${buttonText(lang)}: ${centerUrl(base, businessId)}`);
  return lines.join("\n");
}
