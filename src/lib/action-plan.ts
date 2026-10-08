// Arma el plan de acción único con los reportes guardados (tabla ActionTask). No gasta nada: solo lee la base de
// datos, pasa cada reporte por su regla (action-plan-rules.ts) y guarda las tareas sin perder lo que el dueño marcó.
import type { Prisma } from "@prisma/client";
import { readBi, taskScore, type Bi, type TaskArea, type TaskDraft } from "@/lib/action-plan-shape";
import {
  aiTasks,
  auditTasks,
  backlinksTasks,
  cannibalTasks,
  decayTasks,
  gapTasks,
  gbpTasks,
  gscTasks,
  mapTasks,
  mergeDrafts,
  onpageTasks,
  planChanges,
  questionTasks,
  rankTasks,
  schemaTasks,
  setupTasks,
  type RuleCtx,
  type Saved,
} from "@/lib/action-plan-rules";
import { db } from "@/lib/db";
import type { UiLang } from "@/lib/i18n";
import { readTrackedKeywords, readZones } from "@/lib/seo/dataforseo";
import { businessTopicVocab, gbpCategory } from "@/lib/seo/gap";
import { GSC_CHANNEL } from "@/lib/seo/gsc";
import { loadQuestions } from "@/lib/seo/questions";
import { latestReports, saveReport, type SeoKind } from "@/lib/seo/reports";

export type PlanRefresh = { added: number; open: number; gone: number };

/** Los reportes que alimentan el plan: si alguno es más nuevo que el último plan, el plan se vuelve a armar. */
export const PLAN_INPUT_KINDS: SeoKind[] = ["audit", "onpage", "decay", "cannibal", "gsc", "rank", "keywords", "gap", "backlinks", "outreach", "gbp", "reviews", "maprank", "ai"];
/** Resúmenes del plan que se guardan (kind "plan"). */
export const PLAN_KEEP = 30;
/** Mapas de calor que se leen (el último de cada búsqueda). */
const MAPS_TAKE = 10;

/** Lo que se guarda en SeoReport.data (kind "plan"): el resumen de cada vez que se armó. */
export type PlanSummary = {
  version: 1;
  createdAt: string;
  added: number;
  open: number;
  gone: number;
  urgent: number;
  done: number;
  dismissed: number;
  /** Cuándo se guardó el reporte de cada tipo que se usó. */
  sources: Partial<Record<SeoKind, string>>;
};

const json = (x: unknown) => x as Prisma.InputJsonValue;
const savedOf = (row: { data: unknown; createdAt: Date } | undefined): Saved | null => (row ? { data: row.data, createdAt: row.createdAt } : null);

/** Todas las tareas propuestas por las reglas con lo último guardado de cada reporte. */
export async function buildPlanDrafts(businessId: string, now = new Date()): Promise<{ drafts: TaskDraft[]; sources: PlanSummary["sources"] } | null> {
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, website: true, seoKeywords: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, study: true },
  });
  if (!b) return null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const per = Math.max(1, zones.length);
  const [audit, onpage, decay, cannibal, gsc, rank, keywords, gap, backlinks, outreach, gbp, reviews, maps, ai, gscConn, questions] = await Promise.all([
    latestReports(businessId, "audit"),
    latestReports(businessId, "onpage"),
    latestReports(businessId, "decay"),
    latestReports(businessId, "cannibal"),
    latestReports(businessId, "gsc"),
    latestReports(businessId, "rank", 3 * per),
    latestReports(businessId, "keywords", 3 * per),
    latestReports(businessId, "gap"),
    latestReports(businessId, "backlinks"),
    latestReports(businessId, "outreach"),
    latestReports(businessId, "gbp"),
    latestReports(businessId, "reviews"),
    latestReports(businessId, "maprank", MAPS_TAKE),
    latestReports(businessId, "ai"),
    db.connection.findUnique({ where: { businessId_channel: { businessId, channel: GSC_CHANNEL } }, select: { id: true } }),
    loadQuestions(businessId).catch(() => null),
  ]);
  const ctx: RuleCtx = {
    businessId,
    website: b.website,
    name: b.name,
    vocab: businessTopicVocab({ ...b, category: gbp[0] ? gbpCategory(gbp[0].data) : null }),
  };
  const all = (rows: { data: unknown; createdAt: Date }[]) => rows.map((r) => ({ data: r.data, createdAt: r.createdAt }));
  // El orden importa: si dos reglas dan la misma clave (ej. «casi en la primera página»), gana la primera.
  const drafts = mergeDrafts(
    setupTasks({ website: b.website, keywords: readTrackedKeywords(b.seoKeywords).length, zones: zones.length, study: !!b.study, now }, ctx),
    gscTasks({ connected: !!gscConn, saved: savedOf(gsc[0]), now }, ctx),
    auditTasks(savedOf(audit[0]), ctx),
    schemaTasks(savedOf(audit[0]), ctx),
    gbpTasks(savedOf(gbp[0]), savedOf(reviews[0]), ctx),
    mapTasks(all(maps), ctx),
    onpageTasks(savedOf(onpage[0]), ctx),
    rankTasks(all(rank), all(keywords), ctx),
    gapTasks(savedOf(gap[0]), ctx),
    decayTasks(savedOf(decay[0]), ctx),
    cannibalTasks(savedOf(cannibal[0]), ctx),
    questionTasks(questions, ctx),
    backlinksTasks(savedOf(backlinks[0]), savedOf(outreach[0]), ctx),
    aiTasks(savedOf(ai[0]), ctx),
  );
  const sources: PlanSummary["sources"] = {};
  const stamp = (kind: SeoKind, rows: { createdAt: Date }[]) => {
    if (rows[0]) sources[kind] = rows[0].createdAt.toISOString();
  };
  stamp("audit", audit);
  stamp("onpage", onpage);
  stamp("decay", decay);
  stamp("cannibal", cannibal);
  stamp("gsc", gsc);
  stamp("rank", rank);
  stamp("keywords", keywords);
  stamp("gap", gap);
  stamp("backlinks", backlinks);
  stamp("gbp", gbp);
  stamp("reviews", reviews);
  stamp("maprank", maps);
  stamp("ai", ai);
  return { drafts, sources };
}

const fields = (d: TaskDraft, now: Date) => ({
  source: d.source,
  area: d.area,
  title: json(d.title),
  detail: json(d.detail ?? null),
  impact: d.impact,
  effort: d.effort,
  href: d.href,
  lastSeen: now,
});

async function runRefresh(businessId: string): Promise<PlanRefresh> {
  const now = new Date();
  const built = await buildPlanDrafts(businessId, now);
  if (!built) return { added: 0, open: 0, gone: 0 };
  const existing = await db.actionTask.findMany({ where: { businessId }, select: { id: true, key: true, status: true } });
  const ch = planChanges(existing, built.drafts);
  await db.$transaction([
    ...(ch.create.length
      ? [db.actionTask.createMany({ data: ch.create.map((d) => ({ businessId, key: d.key, ...fields(d, now), status: "todo", firstSeen: now })), skipDuplicates: true })]
      : []),
    ...ch.update.map((u) => db.actionTask.update({ where: { id: u.id }, data: { ...fields(u.draft, now), status: u.status } })),
    ...(ch.gone.length ? [db.actionTask.updateMany({ where: { id: { in: ch.gone }, status: "todo" }, data: { status: "gone" } })] : []),
  ]);
  const counts = await db.actionTask.groupBy({ by: ["status"], where: { businessId }, _count: { _all: true } });
  const n = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const urgent = await db.actionTask.count({ where: { businessId, status: "todo", impact: 3 } });
  const summary: PlanSummary = {
    version: 1,
    createdAt: now.toISOString(),
    added: ch.create.length,
    open: n("todo"),
    gone: ch.gone.length,
    urgent,
    done: n("done"),
    dismissed: n("dismissed"),
    sources: built.sources,
  };
  await saveReport(businessId, "plan", json(summary));
  const old = await db.seoReport.findMany({ where: { businessId, kind: "plan" }, orderBy: { createdAt: "desc" }, skip: PLAN_KEEP, select: { id: true } });
  if (old.length) await db.seoReport.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  return { added: ch.create.length, open: summary.open, gone: ch.gone.length };
}

/** Si dos visitas piden armar el plan del mismo negocio a la vez, la segunda espera a la primera. */
const running = new Map<string, Promise<PlanRefresh>>();

/** Vuelve a armar las tareas del negocio con lo último de cada reporte (no gasta nada: solo lee lo guardado). */
export async function refreshActionPlan(businessId: string, lang: UiLang = "es"): Promise<PlanRefresh> {
  void lang; // Las tareas se guardan en los dos idiomas.
  const cur = running.get(businessId);
  if (cur) return cur;
  const p = runRefresh(businessId).finally(() => running.delete(businessId));
  running.set(businessId, p);
  return p;
}

/** El último resumen guardado del plan (o null). */
export async function latestPlanSummary(businessId: string): Promise<(PlanSummary & { at: Date }) | null> {
  const [row] = await latestReports(businessId, "plan");
  if (!row || !row.data || typeof row.data !== "object") return null;
  return { ...(row.data as PlanSummary), at: row.createdAt };
}

/**
 * Arma el plan solo si hace falta (barato: dos consultas): cuando hay un reporte más nuevo que el último plan.
 * Devuelve si hay algún reporte guardado que alimente el plan.
 */
export async function ensureFreshPlan(businessId: string): Promise<{ hasReports: boolean; refreshed: boolean }> {
  const [newest, plan] = await Promise.all([
    db.seoReport.findFirst({ where: { businessId, kind: { in: PLAN_INPUT_KINDS } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.seoReport.findFirst({ where: { businessId, kind: "plan" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  if (!newest) return { hasReports: false, refreshed: false };
  if (plan && plan.createdAt >= newest.createdAt) return { hasReports: true, refreshed: false };
  try {
    await refreshActionPlan(businessId);
    return { hasReports: true, refreshed: true };
  } catch (e) {
    // Mostrar lo que ya hay es mejor que romper la página.
    console.error("[plan] refresh", e);
    return { hasReports: true, refreshed: false };
  }
}

/** Una tarea lista para mostrar (en el idioma de la página). */
export type PlanTask = {
  id: string;
  key: string;
  area: TaskArea;
  title: string;
  detail: string;
  impact: 1 | 2 | 3;
  effort: 1 | 2 | 3;
  href: string;
  status: "todo" | "done" | "dismissed";
  doneAt: string | null;
  score: number;
};

const pick = (b: Bi | null, lang: UiLang) => (b ? (lang === "en" ? b.en : b.es) : "");
const lvl = (n: number): 1 | 2 | 3 => (n >= 3 ? 3 : n <= 1 ? 1 : 2);

/** Las tareas visibles del plan (abiertas, hechas y descartadas; nunca las "gone"), de la más importante a la menos. */
export async function loadPlanTasks(businessId: string, lang: UiLang, opts: { status?: "todo"; take?: number } = {}): Promise<PlanTask[]> {
  const rows = await db.actionTask.findMany({
    where: { businessId, status: opts.status ?? { in: ["todo", "done", "dismissed"] } },
    select: { id: true, key: true, area: true, title: true, detail: true, impact: true, effort: true, href: true, status: true, doneAt: true, lastSeen: true },
  });
  const list = rows.map((r) => ({
    id: r.id,
    key: r.key,
    area: r.area as TaskArea,
    title: pick(readBi(r.title), lang),
    detail: pick(readBi(r.detail), lang),
    impact: lvl(r.impact),
    effort: lvl(r.effort),
    href: r.href,
    status: r.status as PlanTask["status"],
    doneAt: (r.doneAt ?? (r.status === "done" ? r.lastSeen : null))?.toISOString() ?? null,
    score: taskScore(r),
  }));
  list.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return opts.take ? list.slice(0, opts.take) : list;
}
