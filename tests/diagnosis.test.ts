import { describe, expect, it } from "vitest";
import {
  canSpend,
  dependsOn,
  type DiagnosisFacts,
  type DiagnosisPrices,
  type DiagnosisRun,
  type DiagnosisState,
  emptyState,
  estimateStep,
  isComplete,
  isStale,
  nextStep,
  parseDiagnosisState,
  plainError,
  planCost,
  planRun,
  precheck,
  progress,
  RUNNING_LIMIT_MS,
  shouldRedo,
  STEP_IDS,
  STEPS,
  stepDef,
  stepViews,
} from "@/lib/diagnosis";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const PRICES: DiagnosisPrices = {
  rankPerKeyword: 0.0035,
  competitors: 0.1,
  onpagePage: 0.002,
  onpagePages: 10,
  mapPoints: 25,
  mapPoint: 0.002,
  profile: 0.0054,
  profileCompetitors: 3,
  reviews: 0.0075,
  studyResearch: 0.05,
  studyPlain: 0.01,
  aiAnswer: 0.03,
  aiQuestions: 0.005,
};

const facts = (over: Partial<DiagnosisFacts> = {}): DiagnosisFacts => ({
  website: true,
  profile: false,
  input: false,
  study: false,
  zones: 0,
  keywords: 0,
  place: false,
  dfs: true,
  aiProviders: 1,
  research: true,
  questions: 0,
  last: {},
  ...over,
});

const run = (over: Partial<DiagnosisRun> = {}): DiagnosisRun => ({
  startedAt: daysAgo(0),
  finishedAt: null,
  only: null,
  redoAll: false,
  attempted: [],
  approved: 1,
  spent: 0,
  ...over,
});

describe("pasos del diagnóstico", () => {
  it("son 10, en el orden del dueño", () => {
    expect(STEPS.map((s) => s.id)).toEqual(["web", "study", "setup", "competitors", "audit", "rank", "maps", "gbp", "ai", "plan"]);
    expect(STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("cada paso depende solo de pasos anteriores", () => {
    for (const s of STEPS) for (const d of dependsOn(s.id)) expect(stepDef(d).n).toBeLessThan(s.n);
    expect(dependsOn("rank")).toEqual(["setup"]);
    expect(dependsOn("gbp")).toEqual(["maps"]);
    expect(dependsOn("audit")).toEqual([]);
    expect(dependsOn("plan")).toEqual([]);
  });

  it("se detiene en lo que necesita al dueño: zonas y palabras, y el negocio en Google Maps", () => {
    expect(precheck("setup", facts())?.status).toBe("needs-you");
    expect(precheck("setup", facts({ zones: 1, keywords: 5 }))).toBeNull();
    expect(precheck("maps", facts({ zones: 1, keywords: 5 }))?.status).toBe("needs-you");
    expect(precheck("maps", facts({ zones: 1, keywords: 5, place: true }))).toBeNull();
  });

  it("salta lo que no se puede hacer sin otro paso, y explica las claves que faltan", () => {
    expect(precheck("rank", facts())).toMatchObject({ status: "skipped", from: "setup" });
    expect(precheck("gbp", facts({ zones: 1, keywords: 3 }))).toMatchObject({ status: "skipped", from: "maps" });
    expect(precheck("audit", facts({ website: false }))?.status).toBe("skipped");
    expect(precheck("competitors", facts({ dfs: false }))?.status).toBe("error");
    expect(precheck("study", facts({ aiProviders: 0 }))?.status).toBe("error");
    // Sin web y sin nada del negocio: se le pide al dueño. Con perfil, se salta la lectura.
    expect(precheck("web", facts({ website: false }))?.status).toBe("needs-you");
    expect(precheck("web", facts({ website: false, profile: true }))?.status).toBe("skipped");
  });
});

describe("estado guardado", () => {
  it("lee el JSON sin confiar en él", () => {
    expect(parseDiagnosisState(null)).toEqual(emptyState());
    expect(parseDiagnosisState("x")).toEqual(emptyState());
    const s = parseDiagnosisState({
      startedAt: daysAgo(1),
      completedAt: "no es fecha",
      steps: {
        web: { status: "done", at: daysAgo(1), message: "Listo", cost: 0 },
        rank: { status: "inventado", at: daysAgo(1) },
        nope: { status: "done" },
        audit: { status: "running", startedAt: daysAgo(0), phase: "onpage", by: "auto", cost: "1" },
      },
      run: { startedAt: daysAgo(0), attempted: ["web", "web", "x"], approved: 0.3, spent: -2, only: [] },
    });
    expect(s.completedAt).toBeNull();
    expect(Object.keys(s.steps)).toEqual(["web", "audit"]);
    expect(s.steps.audit).toMatchObject({ status: "running", phase: "onpage", by: "auto", cost: null });
    expect(s.run).toMatchObject({ attempted: ["web"], approved: 0.3, spent: 0, only: null, redoAll: false, finishedAt: null });
  });

  it("sin corrida válida queda en null", () => {
    expect(parseDiagnosisState({ run: { attempted: [] } }).run).toBeNull();
  });
});

describe("cómo se ve cada paso", () => {
  it("usa los reportes que ya existen: hecho con su fecha", () => {
    const v = stepViews(emptyState(), facts({ zones: 1, keywords: 5, last: { rank: { at: daysAgo(2), cost: 0.02 }, web: { at: null } } }), NOW);
    expect(v.find((x) => x.id === "rank")).toMatchObject({ status: "done", at: daysAgo(2), cost: 0.02, stale: false });
    expect(v.find((x) => x.id === "web")).toMatchObject({ status: "done", at: null });
    expect(v.find((x) => x.id === "setup")?.status).toBe("done");
    expect(v.find((x) => x.id === "audit")?.status).toBe("pending");
  });

  it("lo más nuevo gana: un error viejo del diagnóstico no tapa una revisión hecha después", () => {
    const state: DiagnosisState = { ...emptyState(), steps: { rank: { status: "error", at: daysAgo(3), message: "x", cost: null } } };
    const f = facts({ zones: 1, keywords: 5, last: { rank: { at: daysAgo(1) } } });
    expect(stepViews(state, f, NOW).find((x) => x.id === "rank")?.status).toBe("done");
    const older = facts({ zones: 1, keywords: 5, last: { rank: { at: daysAgo(5) } } });
    expect(stepViews(state, older, NOW).find((x) => x.id === "rank")?.status).toBe("error");
  });

  it("lo que esperaba al dueño vuelve a quedar pendiente cuando ya está listo", () => {
    const state: DiagnosisState = { ...emptyState(), steps: { maps: { status: "needs-you", at: daysAgo(0), message: "", cost: null } } };
    expect(stepViews(state, facts({ zones: 1, keywords: 2 }), NOW).find((x) => x.id === "maps")?.status).toBe("needs-you");
    expect(stepViews(state, facts({ zones: 1, keywords: 2, place: true }), NOW).find((x) => x.id === "maps")?.status).toBe("pending");
  });

  it("un paso que quedó corriendo demasiado tiempo se muestra como cortado", () => {
    const at = new Date(NOW - RUNNING_LIMIT_MS - 1000).toISOString();
    const state: DiagnosisState = { ...emptyState(), steps: { audit: { status: "running", at: null, startedAt: at, message: "", cost: null } } };
    expect(stepViews(state, facts(), NOW).find((x) => x.id === "audit")).toMatchObject({ status: "error", cut: true });
    const fresh: DiagnosisState = { ...emptyState(), steps: { audit: { status: "running", at: null, startedAt: daysAgo(0), message: "", cost: null } } };
    expect(stepViews(fresh, facts(), NOW).find((x) => x.id === "audit")?.status).toBe("running");
  });

  it("sabe qué está viejo según las fechas de cada paso", () => {
    expect(isStale(stepDef("rank"), daysAgo(8), NOW)).toBe(true);
    expect(isStale(stepDef("rank"), daysAgo(6), NOW)).toBe(false);
    expect(isStale(stepDef("audit"), daysAgo(31), NOW)).toBe(true);
    expect(isStale(stepDef("audit"), daysAgo(29), NOW)).toBe(false);
    expect(isStale(stepDef("setup"), daysAgo(400), NOW)).toBe(false);
    expect(isStale(stepDef("rank"), null, NOW)).toBe(false);
    const v = stepViews(emptyState(), facts({ zones: 1, keywords: 5, last: { rank: { at: daysAgo(10) } } }), NOW);
    expect(v.find((x) => x.id === "rank")).toMatchObject({ status: "done", stale: true });
  });
});

describe("la corrida", () => {
  const allDone = (over: DiagnosisFacts["last"] = {}): DiagnosisFacts => ({
    ...facts({ zones: 1, keywords: 5, place: true }),
    last: { ...(Object.fromEntries(STEP_IDS.map((id) => [id, { at: daysAgo(1) }])) as DiagnosisFacts["last"]), ...over },
  });

  it("salta lo hecho hace poco y siempre vuelve a armar el plan al final", () => {
    const f = allDone({ rank: { at: daysAgo(20) } });
    expect(planRun(stepViews(emptyState(), f, NOW))).toEqual(["rank", "plan"]);
  });

  it("«Rehacer todo» incluye lo hecho, menos las zonas ya elegidas", () => {
    const plan = planRun(stepViews(emptyState(), allDone(), NOW), { redoAll: true });
    expect(plan).toEqual(["web", "study", "competitors", "audit", "rank", "maps", "gbp", "ai", "plan"]);
  });

  it("«Rehacer» un paso: solo ese y el plan", () => {
    const v = stepViews(emptyState(), allDone(), NOW);
    expect(planRun(v, { only: ["rank"] })).toEqual(["rank", "plan"]);
    expect(planRun(v, { only: ["web"] })).toEqual(["web"]);
  });

  it("no vuelve a intentar lo saltado por el dueño", () => {
    const state: DiagnosisState = { ...emptyState(), steps: { maps: { status: "skipped", by: "owner", at: daysAgo(0), message: "", cost: null } } };
    const f = facts({ zones: 1, keywords: 5 });
    expect(planRun(stepViews(state, f, NOW))).not.toContain("maps");
    expect(planRun(stepViews(state, f, NOW), { redoAll: true })).toContain("maps");
  });

  it("sigue donde quedó: el primero del plan que no se intentó", () => {
    const f = facts();
    const v = stepViews(emptyState(), f, NOW);
    expect(nextStep(v, run())).toBe("web");
    expect(nextStep(v, run({ attempted: ["web", "study"] }))).toBe("setup");
    // El paso que espera al dueño no queda como intentado: al seguir, se vuelve a mirar.
    const waiting: DiagnosisState = { ...emptyState(), steps: { setup: { status: "needs-you", at: daysAgo(0), message: "", cost: null } } };
    expect(nextStep(stepViews(waiting, f, NOW), run({ attempted: ["web", "study"] }))).toBe("setup");
    // Ya con zonas y palabras, sigue con la competencia.
    const ready = facts({ zones: 1, keywords: 4 });
    expect(nextStep(stepViews(waiting, ready, NOW), run({ attempted: ["web", "study"] }))).toBe("competitors");
    // Todo intentado: terminó.
    expect(nextStep(v, run({ attempted: [...STEP_IDS] }))).toBeNull();
  });

  it("avance «Paso N de 10» y cuándo está completo", () => {
    const v = stepViews(emptyState(), facts({ zones: 1, keywords: 5, last: { web: { at: null }, study: { at: daysAgo(1) } } }), NOW);
    expect(progress(v)).toEqual({ current: 4, finished: 3, total: 10 });
    expect(isComplete(v)).toBe(false);
    expect(isComplete(stepViews(emptyState(), allDone(), NOW))).toBe(true);
    expect(shouldRedo(daysAgo(31), NOW)).toBe(true);
    expect(shouldRedo(daysAgo(5), NOW)).toBe(false);
    expect(shouldRedo(null, NOW)).toBe(false);
  });
});

describe("costos", () => {
  it("suma solo los pasos pagados del plan", () => {
    const f = facts({ zones: 2, keywords: 10, questions: 5, aiProviders: 2 });
    const list = ["web", "study", "setup", "competitors", "audit", "rank", "maps", "gbp", "ai", "plan"] as const;
    const c = planCost([...list], f, PRICES);
    expect(c.items.map((x) => x.id)).toEqual(["study", "competitors", "audit", "rank", "maps", "gbp", "ai"]);
    expect(estimateStep("rank", f, PRICES)).toBeCloseTo(10 * 2 * 0.0035);
    expect(estimateStep("ai", f, PRICES)).toBeCloseTo(5 * 2 * 0.03);
    expect(estimateStep("maps", f, PRICES)).toBeCloseTo(0.05);
    expect(estimateStep("gbp", f, PRICES)).toBeCloseTo(0.0054 * 4 + 0.0075);
    expect(c.total).toBeCloseTo(0.05 + 0.1 + 0.02 + 0.07 + 0.05 + 0.0291 + 0.3, 3);
  });

  it("antes de elegir palabras usa 10 palabras en una zona; sin claves no hay gasto", () => {
    expect(estimateStep("rank", facts(), PRICES)).toBeCloseTo(10 * 0.0035);
    expect(estimateStep("ai", facts(), PRICES)).toBeCloseTo(5 * 0.03 + 0.005);
    expect(estimateStep("competitors", facts({ dfs: false }), PRICES)).toBe(0);
    expect(estimateStep("study", facts({ aiProviders: 0 }), PRICES)).toBe(0);
    expect(estimateStep("study", facts({ research: false }), PRICES)).toBe(0.01);
    expect(estimateStep("web", facts(), PRICES)).toBe(0);
    expect(estimateStep("plan", facts(), PRICES)).toBe(0);
  });

  it("nunca gasta sin permiso, y con un margen chico sobre lo aceptado", () => {
    expect(canSpend(run({ approved: null }), 0.05)).toBe(false);
    expect(canSpend(run({ approved: null }), 0)).toBe(true);
    expect(canSpend(run({ approved: 0.2, spent: 0.1 }), 0.1)).toBe(true);
    expect(canSpend(run({ approved: 0.2, spent: 0.2 }), 0.2)).toBe(false);
  });
});

describe("errores en palabras simples", () => {
  it("traduce lo técnico", () => {
    expect(plainError("[GoogleGenerativeAI Error]: API key not valid. Please pass a valid API key.", "ai")?.es).toMatch(/clave de la IA/);
    expect(plainError("429 Too Many Requests", "ai")?.es).toMatch(/esperar un momento/);
    expect(plainError("TypeError: fetch failed", "web")?.es).toMatch(/No se pudo conectar/);
    expect(plainError("The operation was aborted due to timeout", "dfs")?.en).toMatch(/took too long/);
  });

  it("deja igual lo que ya viene explicado", () => {
    expect(plainError("Primero agrega la dirección de tu página web en Ajustes del negocio.", "web")).toBeNull();
    expect(plainError("DataForSEO rechazó el usuario o la contraseña (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).", "dfs")).toBeNull();
  });
});

describe("errores ya explicados por la acción", () => {
  it("no cambia los mensajes que ya hablan de tu página web", () => {
    expect(plainError("No se pudo abrir tu página web (fetch failed). Revisa la dirección en Ajustes.", "ai")).toBeNull();
    expect(plainError("401 Unauthorized", "dfs")?.es).toMatch(/^DataForSEO no aceptó la clave/);
  });
});

describe("dónde estamos", () => {
  it("muestra el paso que espera al dueño antes que uno anterior con error", () => {
    const state: DiagnosisState = {
      ...emptyState(),
      steps: {
        web: { status: "error", at: daysAgo(0), message: "x", cost: null },
        setup: { status: "needs-you", at: daysAgo(0), message: "", cost: null },
      },
    };
    expect(progress(stepViews(state, facts(), NOW)).current).toBe(3);
  });
});
