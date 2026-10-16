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

// The providers behind the tools that pay: never called for real here (the ledger must refuse before them).
vi.mock("@/lib/video-jobs", async (original) => ({
  ...(await original<typeof import("@/lib/video-jobs")>()),
  createProject: vi.fn(),
  startRender: vi.fn(),
}));
vi.mock("@/lib/seo/writer-run", async (original) => ({
  ...(await original<typeof import("@/lib/seo/writer-run")>()),
  createArticleReport: vi.fn(),
}));
// The design tool would draw and store an image: never here.
vi.mock("@/lib/media-formats", async (original) => ({
  ...(await original<typeof import("@/lib/media-formats")>()),
  storeDesign: vi.fn().mockRejectedValue(new Error("no storage in this test")),
}));
vi.mock("@/lib/seo/site-article-run", async (original) => ({
  ...(await original<typeof import("@/lib/seo/site-article-run")>()),
  prepareForSite: vi.fn(),
  approveForSite: vi.fn(),
}));

import { AgentError } from "@/lib/agent/access";
import { AGENTS, agentFor } from "@/lib/agent/agents";
import { toolsFor, type ToolName } from "@/lib/agent/tools";
import { stepsForPiece } from "@/lib/agent/plan";
import { executeTeamStep, registerMatyaStep, stepMeta, stepModel } from "@/lib/agent/team-execution";
import { Refusal } from "@/lib/agent/guard";
import { oneCall, paidCall, Unspent } from "@/lib/agent/spend";
import { meteredAsk, type ModelConfig } from "@/lib/agent/metered";
import { createProject, startRender } from "@/lib/video-jobs";
import { createArticleReport } from "@/lib/seo/writer-run";
import { approveForSite, prepareForSite } from "@/lib/seo/site-article-run";
import type { Storyboard } from "@/lib/video-plan";
import { z } from "zod";
import { db } from "@/lib/db";

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

  it("todos usan modelo menos el de diseño y el de video; tienen rótulo en español e inglés y son su propia clave", () => {
    for (const [key, a] of Object.entries(AGENTS)) {
      expect(a.key).toBe(key);
      // El diseño reutiliza la biblioteca y las plantillas de marca, y el video cotiza con la plantilla y el precio del render:
      // ninguno hace una llamada a una IA.
      expect(a.usesModel).toBe(key !== "design" && key !== "video");
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

  it("los siete agentes tienen su propio código: ya no queda ningún marcador de «agente no disponible»", () => {
    // Director, SEO, estrategia, redacción, diseño, video y revisión (tests/agent-*.test.ts).
    expect(new Set(Object.values(AGENTS).map((a) => a.run)).size).toBe(7);
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

  it("las señales de la mañana avisan que aún no existen; el artículo ya tiene sus dos herramientas", async () => {
    const other = toolsFor({ key: "director", tools: ["readSignals"] }, {} as AgentRun);
    await expect(other.use("readSignals")()).rejects.toThrow(
      "Herramienta no disponible todavía.",
    );
    // writeArticle y publishArticle existen: cuentan con funciones reales (se prueban en tests/agent-database.test.ts).
    const t = toolsFor({ key: "matya", tools: ["writeArticle", "publishArticle"] }, {} as AgentRun);
    expect(typeof t.use("writeArticle")).toBe("function");
    expect(typeof t.use("publishArticle")).toBe("function");
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

  /** The model a step was reserved for, as `stepCost` hands it over. */
  const model: ModelConfig = { provider: "gemini", model: "gemini-x", inputRate: 0.3, outputRate: 2.5, key: "k" };
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
    const reserved = stepModel(r, "plan", workspace.row);
    await expect(executeTeamStep(r, "plan", reserved!)).resolves.toEqual({ data: { ok: 1 } });
    expect(spy).toHaveBeenCalledTimes(1);
    const input = spy.mock.calls[0][0];
    expect(input.run).toBe(r);
    expect(input.step).toEqual({ id: "plan", agent: "director", attempt: 0 });
    expect(input.context).toBe(r.context);
    expect(input.language).toBe("es");
    expect(input.model).toBe(reserved);
    expect(input.model).toMatchObject({ provider: "gemini", model: "gemini-x", key: "k" });
    expect(() => input.tools.use("renderDesign")).toThrow(/no está permitida para director/);
  });

  it("adivina el idioma del encargo", async () => {
    const spy = vi
      .spyOn(AGENTS.seo, "run")
      .mockResolvedValue({ data: {} });
    await executeTeamStep(run({ prompt: "Please prepare the summary" }), "research", model);
    expect(spy.mock.calls[0][0].language).toBe("en");
  });

  it("en una pieza pasa el paso del plan con su ronda", async () => {
    const spy = vi.spyOn(AGENTS.copy, "run").mockResolvedValue({ data: {} });
    const r = run({ kind: "piece", plan: piecePlan() } as never);
    await executeTeamStep(r, "copy-r1", model);
    expect(spy.mock.calls[0][0].step).toEqual({ id: "copy-r1", agent: "copy", attempt: 1 });
  });

  it("un paso con IA sin el modelo reservado no corre: nunca se resuelve otra vez aquí, ni se llama al agente", async () => {
    const spy = vi.spyOn(AGENTS.seo, "run").mockResolvedValue({ data: {} });
    vi.mocked(db.agentWorkspace.findUniqueOrThrow).mockClear();
    const missing = executeTeamStep(run(), "research");
    // Nothing was called: the reservation is released (Unspent), not charged.
    await expect(missing).rejects.toBeInstanceOf(Unspent);
    await expect(missing).rejects.toThrow("Error interno: el paso no recibió el modelo para el que se reservó.");
    expect(spy).not.toHaveBeenCalled();
    expect(db.agentWorkspace.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("el artículo no usa el modelo del agente de redacción: ni se busca su precio ni se pasa un modelo", async () => {
    const spy = vi.spyOn(AGENTS.copy, "run").mockResolvedValue({ data: {} });
    // The copy agent has no verified price here: a copy step stops, an article step goes on without a model.
    workspace.row = {
      agentModels: { copy: { provider: "gemini", model: "sin-precio" } },
      modelPrices: {},
    };
    const articlePlan = { kind: "piece", piece: { id: "p1" }, steps: stepsForPiece("articulo") };
    const r = run({ kind: "piece", plan: articlePlan } as never);
    await executeTeamStep(r, "article");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].model).toBeNull();
    expect(spy.mock.calls[0][0].step).toEqual({ id: "article", agent: "copy", attempt: 0 });
    const copyPlan = { kind: "piece", piece: { id: "p1" }, steps: stepsForPiece("post") };
    expect(() => stepModel(run({ kind: "piece", plan: copyPlan } as never), "copy", workspace.row)).toThrow(
      "Falta el precio verificado del modelo gemini:sin-precio para el agente copy.",
    );
    expect(stepModel(r, "article", workspace.row)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
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

  it("con el modelo reservado llama con ese mismo y no lo vuelve a resolver", async () => {
    const spy = vi.spyOn(AGENTS.review, "run").mockResolvedValue({ data: {} });
    const reserved: ModelConfig = { provider: "claude", model: "reservado", inputRate: 3, outputRate: 15, key: "c" };
    // The settings changed since the step was priced: the call still uses what was reserved.
    workspace.row = { agentModels: { review: { provider: "gemini", model: "otro" } }, modelPrices: {} };
    vi.mocked(db.agentWorkspace.findUniqueOrThrow).mockClear();
    await executeTeamStep(run({ kind: "piece", plan: piecePlan() } as never), "review-r1", reserved);
    expect(spy.mock.calls[0][0].model).toBe(reserved);
    expect(db.agentWorkspace.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("un agente con modelo que falla antes de su llamada no gastó nada (Unspent); sin modelo, el error sigue igual", async () => {
    vi.spyOn(AGENTS.copy, "run").mockRejectedValue(new AgentError("Falta completar el paso anterior."));
    const piece = run({ kind: "piece", plan: piecePlan() } as never);
    await expect(executeTeamStep(piece, "copy", model)).rejects.toBeInstanceOf(Unspent);
    await expect(executeTeamStep(piece, "copy", model)).rejects.toThrow("Falta completar el paso anterior.");
    vi.spyOn(AGENTS.design, "run").mockRejectedValue(new AgentError("El diseño no está listo."));
    const design = executeTeamStep(piece, "design");
    await expect(design).rejects.toThrow("El diseño no está listo.");
    await expect(design).rejects.not.toBeInstanceOf(Unspent);
  });

  it("stepModel resuelve el modelo de los pasos con IA y ninguno para los demás", () => {
    const ws = { agentModels: {}, modelPrices: {} };
    expect(stepModel(run(), "plan", ws)).toMatchObject({ provider: "gemini", model: "gemini-x", key: "k" });
    expect(stepModel(run(), "research", ws)).toMatchObject({ model: "gemini-x" });
    expect(stepModel(run(), "dispatch", ws)).toBeNull();
    const piece = run({ kind: "piece", plan: piecePlan() } as never);
    for (const id of ["copy", "copy-r1", "review", "review-r1"]) expect(stepModel(piece, id, ws)).not.toBeNull();
    for (const id of ["design", "video", "render", "video_wait:2", "prepare", "schedule", "verify"])
      expect(stepModel(piece, id, ws)).toBeNull();
    const article = run({ kind: "piece", plan: { kind: "piece", piece: { id: "p1" }, steps: stepsForPiece("articulo") } } as never);
    expect(stepModel(article, "article", ws)).toBeNull();
    expect(stepModel(article, "review", ws)).not.toBeNull();
  });

  it("stepModel rechaza sin precio o sin clave con las palabras de resolveModel (Refusal: nada se reserva)", () => {
    const noPrice = { agentModels: { copy: { provider: "openai", model: "sin-precio" } }, modelPrices: {} };
    const piece = run({ kind: "piece", plan: piecePlan() } as never);
    expect(() => stepModel(piece, "copy", noPrice)).toThrow(Refusal);
    expect(() => stepModel(piece, "copy", noPrice)).toThrow(
      "Falta el precio verificado del modelo openai:sin-precio para el agente copy.",
    );
    const noKey = {
      agentModels: { review: { provider: "claude", model: "x" } },
      modelPrices: { "claude:x": { input: 3, output: 15 } },
    };
    expect(() => stepModel(piece, "review-r1", noKey)).toThrow(Refusal);
    expect(() => stepModel(piece, "review-r1", noKey)).toThrow("Falta la conexión del modelo de review.");
    // The design step has no model: no price is ever asked of it.
    expect(stepModel(piece, "design", noPrice)).toBeNull();
  });

  it("stepMeta: quién hace el paso, con qué modelo y en qué ronda; nada para los flujos de antes", () => {
    const model: ModelConfig = { provider: "openai", model: "gpt-x", inputRate: 1, outputRate: 4, key: "k" };
    expect(stepMeta(run(), "plan", model)).toEqual({ agent: "director", model: "openai:gpt-x", attempt: 0 });
    expect(stepMeta(run(), "dispatch")).toEqual({ agent: "matya", model: "", attempt: 0 });
    const piece = run({ kind: "piece", plan: piecePlan() } as never);
    expect(stepMeta(piece, "copy-r1", model)).toEqual({ agent: "copy", model: "openai:gpt-x", attempt: 1 });
    expect(stepMeta(piece, "video_wait:4")).toEqual({ agent: "matya", model: "", attempt: 0 });
    expect(stepMeta(piece, "design")).toEqual({ agent: "design", model: "", attempt: 0 });
    expect(stepMeta(run({ kind: "campaign", plan: null } as never), "copy", model)).toBeUndefined();
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

describe("lo que paga deja constancia de su llamada (paidCall)", () => {
  const r = { id: "run-1", businessId: "biz-1" } as AgentRun;
  const config: ModelConfig = { provider: "openai", model: "x", inputRate: 1, outputRate: 4, key: "k" };
  /**
   * Every path that pays someone, and what it would pay. A new one (a tool or a provider call) must call `paidCall()` before it
   * pays and be added here: inside a team agent's model step (`oneCall`) that is what keeps it to one paid call.
   */
  const PAYING: [string, () => Promise<unknown>, () => unknown][] = [
    ["meteredAsk (the AI provider)", () => meteredAsk(z.object({ t: z.string() }), "s", {}, config), () => fetch],
    [
      "startVideo (createProject + startRender)",
      () => toolsFor({ key: "matya", tools: ["startVideo"] }, r).use("startVideo")({} as Storyboard, 10, "approved"),
      () => [createProject, startRender],
    ],
    [
      "writeArticle (createArticleReport: DataForSEO and the AI)",
      () => toolsFor({ key: "copy", tools: ["writeArticle"] }, r).use("writeArticle")("reparar techo", "es"),
      () => createArticleReport,
    ],
    [
      "publishArticle (prepareForSite, the translation)",
      () => toolsFor({ key: "matya", tools: ["publishArticle"] }, r).use("publishArticle")("rep1"),
      () => prepareForSite,
    ],
    [
      "publishArticle approved (approveForSite, the photo)",
      () => toolsFor({ key: "matya", tools: ["publishArticle"] }, r).use("publishArticle")("rep1", { approved: true, expectedCents: 4 }),
      () => approveForSite,
    ],
  ];
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each(PAYING)("%s counts as the step's paid call, before it pays", async (_name, pay, payers) => {
    vi.stubGlobal("fetch", vi.fn());
    // The step already made its one paid call: this one is refused before anyone is paid.
    await expect(
      oneCall(async () => {
        paidCall();
        return pay();
      }),
    ).rejects.toThrow("Este paso ya hizo su llamada de pago: no se hizo otra.");
    for (const payer of [payers()].flat()) expect(payer).not.toHaveBeenCalled();
  });

  it("of every tool, exactly startVideo, writeArticle and publishArticle record a paid call", async () => {
    // Every tool, with whether it pays: a new tool does not compile here until someone says whether it pays someone.
    const PAYS: Record<ToolName, boolean> = {
      readContext: false,
      readSeoReports: false,
      readCalendar: false,
      readSignals: false,
      readStepOutput: false,
      brandKit: false,
      listLibrary: false,
      renderDesign: false,
      channelRules: false,
      videoQuote: false,
      startVideo: true,
      writeArticle: true,
      publishArticle: true,
    };
    vi.stubGlobal("fetch", vi.fn());
    const recorded: string[] = [];
    for (const name of Object.keys(PAYS) as ToolName[]) {
      const tool = toolsFor({ key: "matya", tools: [name] }, r).use(name) as (...args: unknown[]) => unknown;
      try {
        // The step's one paid call was already made: a tool that records its own is refused right away.
        await oneCall(async () => {
          paidCall();
          return tool("facebook", {}, "es");
        });
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Este paso ya hizo su llamada de pago")) recorded.push(name);
      }
    }
    expect(recorded.sort()).toEqual(
      (Object.keys(PAYS) as ToolName[]).filter((n) => PAYS[n]).sort(),
    );
  });
});
