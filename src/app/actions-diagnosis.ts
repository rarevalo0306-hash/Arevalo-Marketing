"use server";

// Diagnóstico guiado: el navegador llama un paso a la vez (cada llamada cabe en el tiempo de Vercel). Cada paso usa
// las acciones que ya existen (leer la web, estudio, competencia, revisión, posiciones, mapa, perfil, IAs) y al final
// se arma el plan de acción. El estado (cada paso, su fecha, su mensaje y su costo) queda en SeoReport "diagnosis".
import { revalidatePath } from "next/cache";
import { suggestVisibilityQuestions, runVisibility } from "@/app/actions-seo-ai";
import { runSiteAudit } from "@/app/actions-seo-audit";
import { runCompetitors } from "@/app/actions-seo-competitors";
import { refreshProfile, refreshReviews } from "@/app/actions-seo-gbp";
import { runMapRank } from "@/app/actions-seo-maprank";
import { runOnPage } from "@/app/actions-seo-onpage";
import { runRankCheck } from "@/app/actions-seo-rank";
import { generateStudy, prefillStudy } from "@/app/actions-study";
import { DIAGNOSIS_MAP, DIAGNOSIS_PRICES, type DiagnosisView, loadDiagnosis, loadFacts, loadState, STEP_KINDS, storeState } from "@/components/diagnosis/load";
import { refreshActionPlan } from "@/lib/action-plan";
import { researchProvider } from "@/lib/ai";
import { db } from "@/lib/db";
import {
  canSpend,
  type DiagnosisState,
  estimateStep,
  isComplete,
  isStepId,
  needsApproval,
  nextStep,
  plainError,
  precheck,
  remainingCost,
  type SavedStep,
  type StepId,
  stepDef,
  stepViews,
} from "@/lib/diagnosis";
import { errorText, type T, type UiLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { readTrackedKeywords } from "@/lib/seo/dataforseo";
import { latestReports } from "@/lib/seo/reports";
import { customerLang, questionsFromStudy, readVisibilityReport } from "@/lib/seo/visibility";
import { EMPTY_INPUT, readInput, readStudy } from "@/lib/study-shape";

export type DiagnosisStop =
  | { kind: "needs-you"; step: StepId }
  | { kind: "approval"; step: StepId; amount: number }
  | { kind: "finished" }
  | { kind: "busy" };

export type DiagnosisReply = { ok: true; view: DiagnosisView; stop?: DiagnosisStop; ran?: StepId } | { ok: false; error: string };

const nowIso = () => new Date().toISOString();

async function reply(businessId: string, extra: { stop?: DiagnosisStop; ran?: StepId } = {}): Promise<DiagnosisReply> {
  const view = await loadDiagnosis(businessId);
  if (!view) {
    const { t } = await getT();
    return { ok: false, error: t("Negocio no encontrado.", "Business not found.") };
  }
  return { ok: true, view, ...extra };
}

/** Hay un paso corriendo ahora mismo (en otra pestaña, por ejemplo). */
const busyStep = (state: DiagnosisState, now = Date.now()) =>
  Object.values(state.steps).some((s) => s?.status === "running" && !s.phase && now - (Date.parse(s.startedAt ?? s.at ?? "") || 0) < 6 * 60_000);

/**
 * Empieza una corrida: todos los pasos que faltan (o, con `only`, solo esos). `approve` = lo que el dueño aceptó gastar
 * (USD) con «Sí, gastar ~US$X»; null = solo lo gratis. Nunca se gasta sin eso.
 */
export async function startDiagnosis(businessId: string, opts: { redoAll?: boolean; only?: string[]; approve?: number | null } = {}): Promise<DiagnosisReply> {
  const { t } = await getT();
  const loaded = await loadFacts(businessId);
  if (!loaded) return { ok: false, error: t("Negocio no encontrado.", "Business not found.") };
  const { rowId, state } = await loadState(businessId);
  if (busyStep(state)) return reply(businessId, { stop: { kind: "busy" } });
  const only = (opts.only ?? []).filter(isStepId);
  const approve = typeof opts.approve === "number" && Number.isFinite(opts.approve) && opts.approve > 0 ? Math.min(opts.approve, 20) : null;
  const at = nowIso();
  state.startedAt ??= at;
  state.run = { startedAt: at, finishedAt: null, only: only.length ? only : null, redoAll: opts.redoAll === true, attempted: [], approved: approve, spent: 0 };
  // Lo que se va a rehacer vuelve a quedar pendiente (el dueño lo pidió, aunque lo hubiera saltado).
  if (only.length) for (const id of only) if (state.steps[id]?.status === "skipped") delete state.steps[id];
  await storeState(businessId, rowId, state);
  return reply(businessId);
}

/** Lo que el dueño acepta gastar en lo que falta de la corrida (null = seguir solo con lo gratis). */
export async function approveDiagnosisSpend(businessId: string, amount: number | null): Promise<DiagnosisReply> {
  const { rowId, state } = await loadState(businessId);
  if (state.run && !state.run.finishedAt) {
    state.run.approved = typeof amount === "number" && Number.isFinite(amount) && amount > 0 ? state.run.spent + Math.min(amount, 20) : null;
    await storeState(businessId, rowId, state);
  }
  return reply(businessId);
}

/** «Saltar por ahora»: el paso queda saltado y la corrida sigue con el siguiente. */
export async function skipDiagnosisStep(businessId: string, step: string): Promise<DiagnosisReply> {
  const { t } = await getT();
  if (!isStepId(step)) return { ok: false, error: t("Ese paso no existe.", "That step doesn't exist.") };
  const { rowId, state } = await loadState(businessId);
  state.steps[step] = { status: "skipped", by: "owner", at: nowIso(), message: t("Lo saltaste por ahora.", "You skipped it for now."), cost: null };
  if (state.run && !state.run.finishedAt && !state.run.attempted.includes(step)) state.run.attempted.push(step);
  await storeState(businessId, rowId, state);
  return reply(businessId);
}

/** Corta la corrida (los pasos hechos quedan guardados; «Continuar» empieza otra con lo que falta). */
export async function stopDiagnosis(businessId: string): Promise<DiagnosisReply> {
  const { rowId, state } = await loadState(businessId);
  if (state.run && !state.run.finishedAt) {
    state.run.finishedAt = nowIso();
    await storeState(businessId, rowId, state);
  }
  return reply(businessId);
}

type Outcome = { status: "done" | "error" | "skipped"; message: string; cost?: number | null } | { status: "running"; phase: string; message: string };

type Ctx = { businessId: string; lang: UiLang; t: T; phase?: string; message: string; canSpendOnPage: boolean };

const SERVICE: Record<StepId, "dfs" | "ai" | "web"> = {
  // Leer la web falla casi siempre por la IA (lo de la página ya viene explicado por la acción).
  web: "ai",
  study: "ai",
  setup: "dfs",
  competitors: "dfs",
  audit: "web",
  rank: "dfs",
  maps: "dfs",
  gbp: "dfs",
  ai: "ai",
  plan: "web",
};

/** Un mensaje de error en palabras simples (si se reconoce), si no el mismo. */
function plain(message: string, step: StepId, lang: UiLang): string {
  const p = plainError(message, SERVICE[step]);
  return p ? (lang === "en" ? p.en : p.es) : message;
}

const empty = () => new FormData();

/** Cada paso con las acciones que ya existen. */
const RUN: Record<StepId, (c: Ctx) => Promise<Outcome>> = {
  async web({ businessId, t }) {
    const r = await prefillStudy(businessId);
    if (!r.ok) return { status: "error", message: r.error };
    const n = r.pages.length;
    return {
      status: "done",
      message:
        (n
          ? t(`Leímos ${n} ${n === 1 ? "página" : "páginas"} de tu web y anotamos qué vendes, dónde y a quién.`, `We read ${n} ${n === 1 ? "page" : "pages"} of your website and noted what you sell, where and to whom.`)
          : t("Anotamos qué vendes, dónde y a quién con lo que ya sabíamos.", "We noted what you sell, where and to whom from what we already knew.")) +
        (r.profileSaved ? t(" También guardamos el perfil de tu negocio para la IA.", " We also saved your business profile for the AI.") : ""),
    };
  },

  async study({ businessId }) {
    const b = await db.business.findUnique({ where: { id: businessId }, select: { studyInput: true, aiText: true } });
    const input = readInput(b?.studyInput) ?? EMPTY_INPUT;
    const f = new FormData();
    f.set("services", input.services);
    f.set("customers", input.customers);
    f.set("idealCustomers", JSON.stringify(input.idealCustomers));
    f.set("customerOptions", JSON.stringify(input.customerOptions));
    f.set("zone", input.zone);
    f.set("competitors", input.competitors);
    f.set("different", input.different);
    f.set("goal", input.goal);
    f.set("lang", input.lang);
    f.set("answers", JSON.stringify(input.answers));
    if (researchProvider(b?.aiText ?? "")) f.set("research", "on");
    const r = await generateStudy(businessId, null, f);
    return r?.ok ? { status: "done", message: r.message } : { status: "error", message: r?.message ?? "" };
  },

  async setup({ t }) {
    return { status: "done", message: t("Tus zonas y palabras clave ya están elegidas.", "Your areas and keywords are already chosen.") };
  },

  async competitors({ businessId }) {
    const r = await runCompetitors(businessId, null, empty());
    return { status: r?.ok ? "done" : "error", message: r?.message ?? "" };
  },

  async audit({ businessId, t, phase, message, canSpendOnPage }) {
    if (phase === "onpage") {
      const r = await runOnPage(businessId, null, empty());
      return {
        status: "done",
        message: r?.ok
          ? `${message} ${r.message}`.trim()
          : `${message} ${t("La revisión de tus páginas principales no se pudo hacer: ", "The check of your main pages couldn't be done: ")}${r?.message ?? ""}`.trim(),
      };
    }
    const r = await runSiteAudit(businessId, null, empty());
    if (!r?.ok) return { status: "error", message: r?.message ?? "" };
    const facts = (await loadFacts(businessId))?.facts;
    if (facts?.dfs && facts.zones > 0) {
      if (canSpendOnPage) return { status: "running", phase: "onpage", message: r.message };
      return {
        status: "done",
        message: `${r.message} ${t("La revisión de tus páginas principales con Google (pagada) queda para cuando la apruebes.", "The check of your main pages against Google (paid) waits until you approve it.")}`,
      };
    }
    return { status: "done", message: r.message };
  },

  async rank({ businessId }) {
    const r = await runRankCheck(businessId, null, empty());
    return { status: r?.ok ? "done" : "error", message: r?.message ?? "" };
  },

  async maps({ businessId }) {
    const b = await db.business.findUnique({ where: { id: businessId }, select: { seoKeywords: true } });
    const keyword = readTrackedKeywords(b?.seoKeywords)[0] ?? "";
    const f = new FormData();
    f.set("keyword", keyword);
    f.set("size", String(DIAGNOSIS_MAP.size));
    f.set("spacing", String(DIAGNOSIS_MAP.spacingKm));
    const r = await runMapRank(businessId, null, f);
    return { status: r?.ok ? "done" : "error", message: r?.message ?? "" };
  },

  async gbp({ businessId, t, phase, message }) {
    if (phase === "reviews") {
      const r = await refreshReviews(businessId, null, empty());
      return {
        status: "done",
        message: r?.ok ? `${message} ${r.message}`.trim() : `${message} ${t("Las reseñas no se pudieron traer esta vez: ", "The reviews couldn't be fetched this time: ")}${r?.message ?? ""}`.trim(),
      };
    }
    const r = await refreshProfile(businessId, null, empty());
    if (!r?.ok) return { status: "error", message: r?.message ?? "" };
    return { status: "running", phase: "reviews", message: r.message };
  },

  async ai({ businessId, lang }) {
    const b = await db.business.findUnique({ where: { id: businessId }, select: { study: true, studyInput: true } });
    const [row] = await latestReports(businessId, "ai", 1);
    let questions = row ? (readVisibilityReport(row.data)?.questions ?? []) : [];
    const study = readStudy(b?.study);
    if (!questions.length && study && b) questions = questionsFromStudy(study, customerLang(b) ?? lang);
    if (!questions.length) {
      const s = await suggestVisibilityQuestions(businessId);
      if (!s.ok) return { status: "error", message: s.error };
      questions = s.questions;
    }
    const f = new FormData();
    for (const q of questions) f.append("question", q);
    const r = await runVisibility(businessId, null, f);
    return { status: r?.ok ? "done" : "error", message: r?.message ?? "" };
  },

  async plan({ businessId, lang, t }) {
    const r = await refreshActionPlan(businessId, lang);
    revalidatePath(`/b/${businessId}/seo`);
    return {
      status: "done",
      message: r.open
        ? t(
            `Tu plan tiene ${r.open} ${r.open === 1 ? "tarea" : "tareas"} por hacer${r.added ? ` (${r.added} ${r.added === 1 ? "nueva" : "nuevas"})` : ""}, de la que más ayuda a la que menos.`,
            `Your plan has ${r.open} ${r.open === 1 ? "task" : "tasks"} to do${r.added ? ` (${r.added} new)` : ""}, from the most helpful to the least.`,
          )
        : t("Tu plan está al día: no encontramos tareas nuevas.", "Your plan is up to date: we found no new tasks."),
    };
  },
};

/** Lo que costaron los reportes que dejó el paso (los de DataForSEO traen su costo); si no, el estimado. */
async function actualCost(businessId: string, step: StepId, since: string, estimate: number): Promise<number | null> {
  const kinds = (STEP_KINDS[step] ?? []).filter((k) => k !== "audit" && k !== "plan");
  if (!kinds.length) return estimate > 0 ? estimate : null;
  const rows = await db.seoReport.findMany({ where: { businessId, kind: { in: kinds }, createdAt: { gte: new Date(since) } }, select: { data: true } });
  let sum = 0;
  let found = false;
  for (const r of rows) {
    const c = (r.data as { cost?: unknown } | null)?.cost;
    if (typeof c === "number" && Number.isFinite(c)) {
      sum += c;
      found = true;
    }
  }
  return found ? Math.round(sum * 10000) / 10000 : estimate > 0 ? estimate : null;
}

/**
 * Hace el siguiente paso de la corrida y devuelve cómo quedó todo. El navegador la llama una y otra vez hasta que
 * termina, o se detiene en un paso que necesita al dueño o en un gasto que falta aprobar.
 */
export async function diagnosisNext(businessId: string): Promise<DiagnosisReply> {
  const { lang, t } = await getT();
  const loaded = await loadFacts(businessId);
  if (!loaded) return { ok: false, error: t("Negocio no encontrado.", "Business not found.") };
  const { facts } = loaded;
  const { rowId, state } = await loadState(businessId);
  const run = state.run;
  if (!run || run.finishedAt) return reply(businessId, { stop: { kind: "finished" } });
  if (busyStep(state)) return reply(businessId, { stop: { kind: "busy" } });

  const views = stepViews(state, facts);
  const id = nextStep(views, run);
  if (!id) {
    run.finishedAt = nowIso();
    if (isComplete(views)) state.completedAt = run.finishedAt;
    await storeState(businessId, rowId, state);
    revalidatePath(`/b/${businessId}/seo`);
    return reply(businessId, { stop: { kind: "finished" } });
  }

  const prev = state.steps[id];
  const phase = prev?.status === "running" ? prev.phase : undefined;
  const save = async (step: SavedStep, attempted: boolean) => {
    state.steps[id] = step;
    if (attempted && !run.attempted.includes(id)) run.attempted.push(id);
    await storeState(businessId, rowId, state);
  };

  if (!phase) {
    const block = precheck(id, facts);
    if (block) {
      const message = lang === "en" ? block.reason.en : block.reason.es;
      if (block.status === "needs-you") {
        await save({ status: "needs-you", at: nowIso(), message, cost: null, by: "auto" }, false);
        return reply(businessId, { stop: { kind: "needs-you", step: id } });
      }
      await save({ status: block.status, at: nowIso(), message, cost: null, by: "auto" }, true);
      return reply(businessId, { ran: id });
    }
    const estimate = estimateStep(id, facts, DIAGNOSIS_PRICES);
    if (needsApproval(id) && estimate > 0 && !canSpend(run, estimate)) {
      if (run.approved !== null) {
        const amount = remainingCost(views, run, facts, DIAGNOSIS_PRICES).total;
        return reply(businessId, { stop: { kind: "approval", step: id, amount } });
      }
      // Corrida solo con lo gratis: el paso queda pendiente para la próxima, con la explicación.
      await save(
        {
          status: "pending",
          at: null,
          message: t("Espera tu permiso: este paso usa servicios pagados.", "Waiting for your OK: this step uses paid services."),
          cost: null,
        },
        true,
      );
      return reply(businessId, { ran: id });
    }
  }

  const startedAt = nowIso();
  const estimate = estimateStep(id, facts, DIAGNOSIS_PRICES);
  await save({ status: "running", at: prev?.at ?? null, message: phase ? (prev?.message ?? "") : "", cost: prev?.cost ?? null, startedAt, ...(phase ? { phase } : {}) }, false);

  let out: Outcome;
  try {
    out = await RUN[id]({ businessId, lang, t, phase, message: phase ? (prev?.message ?? "") : "", canSpendOnPage: estimate > 0 && canSpend(run, estimate) });
  } catch (e) {
    out = { status: "error", message: errorText(e, lang) };
  }

  // Lo que costó: los reportes que dejó el paso desde que empezó (también la primera parte, si tuvo dos).
  // Mientras corre la segunda parte, `at` guarda cuándo empezó la primera.
  const since = phase ? (prev?.at ?? startedAt) : startedAt;
  if (out.status === "running") {
    await save({ status: "running", at: since, message: out.message, cost: null, startedAt: nowIso(), phase: out.phase }, false);
    return reply(businessId, { ran: id });
  }
  const costEstimate = stepDef(id).cost === "ai" ? estimate : 0;
  // Si la IA falló, no se cuenta su estimado (los reportes de DataForSEO sí traen lo que de verdad costaron).
  const cost = out.status === "error" && stepDef(id).cost === "ai" ? null : await actualCost(businessId, id, since, costEstimate);
  run.spent = Math.round((run.spent + (cost ?? 0)) * 10000) / 10000;
  await save(
    {
      status: out.status,
      at: nowIso(),
      message: out.status === "error" ? plain(out.message, id, lang) : out.message,
      cost,
      by: "auto",
    },
    true,
  );
  return reply(businessId, { ran: id });
}
