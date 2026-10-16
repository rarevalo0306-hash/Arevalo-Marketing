// Marco de agentes: los 7 agentes, sus herramientas cerradas y el ruteo de los pasos del equipo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRun } from "@prisma/client";

const workspace = vi.hoisted(() => ({
  row: { agentModels: {}, modelPrices: {} } as {
    agentModels: unknown;
    modelPrices: unknown;
  },
}));
// Sin base de datos: estas pruebas solo miran el marco, no las consultas de las herramientas.
vi.mock("@/lib/db", () => ({
  db: {
    agentWorkspace: {
      findUniqueOrThrow: vi.fn().mockImplementation(async () => workspace.row),
    },
  },
}));

import { AgentError } from "@/lib/agent/access";
import { AGENTS, agentFor } from "@/lib/agent/agents";
import { toolsFor, type ToolName } from "@/lib/agent/tools";
import { stepsForPiece } from "@/lib/agent/plan";
import { executeTeamStep, registerMatyaStep } from "@/lib/agent/team-execution";

const piecePlan = (steps = stepsForPiece("video")) => ({
  kind: "piece",
  piece: { id: "p1" },
  steps: [
    ...steps,
    { id: "copy-r1", agent: "copy", attempt: 1 },
    { id: "review-r1", agent: "review", attempt: 1 },
  ],
});

describe("registro de agentes", () => {
  it("hay 7 agentes y cada uno solo usa sus herramientas", () => {
    expect(Object.keys(AGENTS).sort()).toEqual([
      "copy",
      "design",
      "director",
      "review",
      "seo",
      "strategy",
      "video",
    ]);
    const t = toolsFor({ key: "copy", tools: ["readStepOutput"] }, {} as AgentRun);
    expect(() => t.use("startVideo")).toThrow(/no está permitida/);
    expect(AGENTS.seo.tools).not.toContain("renderDesign");
    expect(AGENTS.review.tools).not.toContain("startVideo");
  });

  it("cada agente tiene su caja de herramientas exacta", () => {
    const tools = Object.fromEntries(
      Object.entries(AGENTS).map(([k, a]) => [k, [...a.tools]]),
    );
    expect(tools).toEqual({
      director: ["readContext", "readSignals", "readCalendar"],
      seo: ["readContext", "readSeoReports"],
      strategy: ["readContext", "readStepOutput", "readCalendar"],
      copy: ["readContext", "readStepOutput", "channelRules", "writeArticle"],
      design: [
        "readContext",
        "readStepOutput",
        "brandKit",
        "listLibrary",
        "renderDesign",
      ],
      video: ["readContext", "readStepOutput", "listLibrary", "videoQuote"],
      review: ["readContext", "readStepOutput", "channelRules", "readCalendar"],
    });
    // Los pasos de MATYA usan estas dos; ningún agente con modelo las tiene.
    for (const a of Object.values(AGENTS)) {
      expect(a.tools).not.toContain("startVideo");
      expect(a.tools).not.toContain("publishArticle");
    }
  });

  it("todos usan modelo, tienen rótulo en español e inglés y son su propia clave", () => {
    for (const [key, a] of Object.entries(AGENTS)) {
      expect(a.key).toBe(key);
      expect(a.usesModel).toBe(true);
      expect(a.label.es).toBeTruthy();
      expect(a.label.en).toBeTruthy();
    }
    expect(AGENTS.director.label.es).toBe("Director");
    expect(AGENTS.seo.label.es).toBe("SEO e investigación");
    expect(AGENTS.strategy.label.es).toBe("Estrategia de contenido");
    expect(AGENTS.copy.label.es).toBe("Redacción");
    expect(AGENTS.design.label.es).toBe("Diseño");
    expect(AGENTS.video.label.es).toBe("Video");
    expect(AGENTS.review.label.es).toBe("Revisión editorial");
  });

  it("mientras no existan los demás agentes, cada uno falla con un mensaje claro", async () => {
    // El Director y el agente SEO ya existen (tests/agent-director-seo.test.ts); los otros cinco siguen sin hacerse.
    const todo = Object.values(AGENTS).filter((a) => !["director", "seo"].includes(a.key));
    expect(todo.map((a) => a.key).sort()).toEqual(["copy", "design", "review", "strategy", "video"]);
    for (const a of todo)
      await expect(a.run({} as never)).rejects.toThrow("Agente no disponible.");
    for (const key of ["director", "seo"] as const)
      expect(AGENTS[key].run).not.toBe(AGENTS.copy.run);
  });
});

describe("agentFor", () => {
  it("en un plan de equipo: plan, research y strategy tienen agente; dispatch es de MATYA", () => {
    const plan = { kind: "team" };
    expect(agentFor("plan", plan)).toBe(AGENTS.director);
    expect(agentFor("research", plan)).toBe(AGENTS.seo);
    expect(agentFor("strategy", plan)).toBe(AGENTS.strategy);
    expect(agentFor("dispatch", plan)).toBeNull();
    expect(agentFor("copy", plan)).toBeNull();
    expect(agentFor("constructor", plan)).toBeNull();
  });

  it("en un plan de pieza usa el agente del paso, también en las vueltas de corrección", () => {
    const plan = piecePlan();
    expect(agentFor("copy", plan)).toBe(AGENTS.copy);
    expect(agentFor("design", plan)).toBe(AGENTS.design);
    expect(agentFor("video", plan)).toBe(AGENTS.video);
    expect(agentFor("review", plan)).toBe(AGENTS.review);
    expect(agentFor("copy-r1", plan)).toBe(AGENTS.copy);
    expect(agentFor("review-r1", plan)).toBe(AGENTS.review);
    // Pasos de MATYA.
    for (const id of ["render", "prepare", "schedule", "verify"])
      expect(agentFor(id, plan)).toBeNull();
    // El sufijo :n de la espera del video se quita.
    expect(agentFor("video_wait:3", plan)).toBeNull();
    expect(agentFor("video:0", plan)).toBe(AGENTS.video);
  });

  it("el id exacto manda sobre el sufijo", () => {
    const plan = {
      kind: "piece",
      steps: [
        { id: "x", agent: "copy", attempt: 0 },
        { id: "x:1", agent: "design", attempt: 0 },
      ],
    };
    expect(agentFor("x:1", plan)).toBe(AGENTS.design);
    expect(agentFor("x:2", plan)).toBe(AGENTS.copy);
  });

  it("un artículo lo escribe el redactor", () => {
    const plan = { kind: "piece", steps: stepsForPiece("articulo") };
    expect(agentFor("article", plan)).toBe(AGENTS.copy);
    expect(agentFor("review", plan)).toBe(AGENTS.review);
    expect(agentFor("article_publish", plan)).toBeNull();
  });

  it("un plan o un paso desconocido da null sin lanzar", () => {
    const garbage: unknown[] = [
      null,
      undefined,
      0,
      "piece",
      [],
      {},
      { kind: "other" },
      { kind: "piece" },
      { kind: "piece", steps: "copy" },
      { kind: "piece", steps: [null, 3, "copy", { id: 5 }] },
      { kind: "piece", steps: [{ id: "copy", agent: "hacker", attempt: 0 }] },
      { kind: "piece", steps: [{ id: "copy", agent: "matya", attempt: 0 }] },
      { kind: "piece", steps: [{ id: "copy", agent: 7 }] },
    ];
    for (const plan of garbage) expect(agentFor("copy", plan)).toBeNull();
    expect(agentFor("nope", piecePlan())).toBeNull();
    expect(agentFor("", piecePlan())).toBeNull();
    const hostile = {
      kind: "piece",
      get steps(): never {
        throw new Error("boom");
      },
    };
    expect(agentFor("copy", hostile)).toBeNull();
  });
});

describe("herramientas cerradas", () => {
  const draft = { text: "", subject: "", seoTitle: "", mediaType: "photo" as const };

  it("deja usar una herramienta de la lista", () => {
    const t = toolsFor(AGENTS.review, {} as AgentRun);
    const notes = t.use("channelRules")("instagram", draft);
    expect(notes.some((n) => n.id === "empty" && n.blocking)).toBe(true);
  });

  it("no deja usar una que no está en la lista, con el mensaje en español", () => {
    const t = toolsFor({ key: "copy", tools: ["readStepOutput"] }, {} as AgentRun);
    expect(() => t.use("startVideo")).toThrow(AgentError);
    expect(() => t.use("startVideo")).toThrow(
      "La herramienta startVideo no está permitida para copy.",
    );
    expect(() => t.use("renderDesign")).toThrow(
      "La herramienta renderDesign no está permitida para copy.",
    );
  });

  it("nadie puede pedir una herramienta que no existe", () => {
    const t = toolsFor(AGENTS.copy, {} as AgentRun);
    for (const name of ["constructor", "__proto__", "toString", "nope"])
      expect(() => t.use(name as ToolName)).toThrow(/no está permitida/);
  });

  it("las herramientas de etapas posteriores avisan que aún no existen", async () => {
    const copy = toolsFor(AGENTS.copy, {} as AgentRun);
    await expect(copy.use("writeArticle")({})).rejects.toThrow(
      "Herramienta no disponible todavía.",
    );
    const other = toolsFor(
      { key: "director", tools: ["readSignals", "publishArticle"] },
      {} as AgentRun,
    );
    await expect(other.use("readSignals")()).rejects.toThrow(
      "Herramienta no disponible todavía.",
    );
    await expect(other.use("publishArticle")({})).rejects.toThrow(
      "Herramienta no disponible todavía.",
    );
  });
});

describe("executeTeamStep", () => {
  const run = (over: Partial<AgentRun> = {}) =>
    ({
      id: "run-1",
      businessId: "biz-1",
      kind: "team",
      prompt: "Prepara el contenido",
      plan: { kind: "team" },
      context: { business: { id: "biz-1" } },
      ...over,
    }) as unknown as AgentRun;
  const env = {
    GEMINI_API_KEY: "k",
    MATYA_AGENT_PROVIDER: "gemini",
    MATYA_AGENT_MODEL: "gemini-x",
    MATYA_AGENT_INPUT_USD_PER_MILLION: "0.3",
    MATYA_AGENT_OUTPUT_USD_PER_MILLION: "2.5",
  };

  beforeEach(() => {
    workspace.row = { agentModels: {}, modelPrices: {} };
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("llama al agente del paso con su modelo, su idioma y solo sus herramientas", async () => {
    const spy = vi
      .spyOn(AGENTS.director, "run")
      .mockResolvedValue({ data: { ok: 1 } });
    const r = run();
    await expect(executeTeamStep(r, "plan")).resolves.toEqual({ data: { ok: 1 } });
    expect(spy).toHaveBeenCalledTimes(1);
    const input = spy.mock.calls[0][0];
    expect(input.run).toBe(r);
    expect(input.step).toEqual({ id: "plan", agent: "director", attempt: 0 });
    expect(input.context).toBe(r.context);
    expect(input.language).toBe("es");
    expect(input.model).toMatchObject({ provider: "gemini", model: "gemini-x", key: "k" });
    expect(() => input.tools.use("renderDesign")).toThrow(/no está permitida para director/);
  });

  it("adivina el idioma del encargo", async () => {
    const spy = vi
      .spyOn(AGENTS.seo, "run")
      .mockResolvedValue({ data: {} });
    await executeTeamStep(run({ prompt: "Please prepare the summary" }), "research");
    expect(spy.mock.calls[0][0].language).toBe("en");
  });

  it("en una pieza pasa el paso del plan con su ronda", async () => {
    const spy = vi.spyOn(AGENTS.copy, "run").mockResolvedValue({ data: {} });
    const r = run({ kind: "piece", plan: piecePlan() } as never);
    await executeTeamStep(r, "copy-r1");
    expect(spy.mock.calls[0][0].step).toEqual({ id: "copy-r1", agent: "copy", attempt: 1 });
  });

  it("sin precio o sin conexión deja pasar el error del modelo y no llama al agente", async () => {
    const spy = vi.spyOn(AGENTS.seo, "run").mockResolvedValue({ data: {} });
    workspace.row = {
      agentModels: { seo: { provider: "gemini", model: "sin-precio" } },
      modelPrices: {},
    };
    await expect(executeTeamStep(run(), "research")).rejects.toThrow(
      "Falta el precio verificado del modelo gemini:sin-precio para el agente seo.",
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("los pasos de MATYA van al manejador registrado por su nombre base", async () => {
    const handler = vi.fn().mockResolvedValue({ data: { hecho: true } });
    registerMatyaStep("dispatch", handler);
    const r = run();
    await expect(executeTeamStep(r, "dispatch")).resolves.toEqual({ data: { hecho: true } });
    expect(handler).toHaveBeenCalledWith(r, "dispatch");
  });

  it("quita -r<n> y :<n> para buscar el manejador", async () => {
    const wait = vi.fn().mockResolvedValue({ data: {} });
    const prep = vi.fn().mockResolvedValue({ data: {} });
    registerMatyaStep("video_wait", wait);
    registerMatyaStep("prepare", prep);
    const r = run({ kind: "piece", plan: piecePlan() } as never);
    await executeTeamStep(r, "video_wait:3");
    await executeTeamStep(r, "prepare-r2");
    expect(wait).toHaveBeenCalledWith(r, "video_wait:3");
    expect(prep).toHaveBeenCalledWith(r, "prepare-r2");
  });

  it("un paso de MATYA sin manejador no está disponible", async () => {
    const r = run({ kind: "piece", plan: piecePlan() } as never);
    await expect(executeTeamStep(r, "verify")).rejects.toThrow("Paso no disponible.");
    await expect(executeTeamStep(r, "inventado")).rejects.toThrow(AgentError);
    await expect(executeTeamStep(run({ plan: null } as never), "plan")).rejects.toThrow(
      "Paso no disponible.",
    );
  });
});
