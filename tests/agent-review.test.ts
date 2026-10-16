// El agente de revisión editorial (pasos review y review-r<n>): reglas primero, una sola llamada pagada si pasan, y una vuelta de corrección.
// Sin base de datos ni proveedor: el negocio, el espacio de trabajo y los temas recientes son de mentira y la llamada pagada es un simulacro.
// Las pruebas de base de datos están en tests/agent-database.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRun } from "@prisma/client";

const db = vi.hoisted(() => ({
  business: vi.fn(),
  workspace: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { business: { findUniqueOrThrow: db.business }, agentWorkspace: { findUniqueOrThrow: db.workspace } },
}));
vi.mock("@/lib/agent/limits", () => ({ recentTopicsOf: vi.fn() }));
vi.mock("@/lib/agent/metered", async (original) => ({
  ...(await original<typeof import("@/lib/agent/metered")>()),
  meteredAsk: vi.fn(),
}));

import { AgentError } from "@/lib/agent/access";
import { AGENTS } from "@/lib/agent/agents";
import { ReviewVerdict, runReview } from "@/lib/agent/agents/review";
import type { AgentInput } from "@/lib/agent/agents/types";
import { PROMPT_BUDGET, slimContext } from "@/lib/agent/bounded-context";
import { recentTopicsOf } from "@/lib/agent/limits";
import { meteredAsk, promptBytes, type ModelConfig } from "@/lib/agent/metered";
import { problemsOf, reworkSteps, type Piece } from "@/lib/agent/plan";
import { MEDIA_POLICY, SYSTEM } from "@/lib/agent/prompts";
import { Copy } from "@/lib/agent/schema";
import type { Tools } from "@/lib/agent/tools";
import { context, maxContext } from "./fixtures/agent-context";

const ask = vi.mocked(meteredAsk);
const topics = vi.mocked(recentTopicsOf);
const MODEL: ModelConfig = {
  provider: "gemini",
  model: "gemini-x",
  inputRate: 0.3,
  outputRate: 2.5,
  key: "synthetic-no-provider-access",
};
const usage = { inputTokens: 100, outputTokens: 50, cents: 4, model: "gemini-x" };
const COPY: Copy = {
  title: "Goteras",
  headline: "¿Tienes una gotera?",
  summary: "Cómo detectar una gotera a tiempo",
  variants: {
    facebook: "Revisa tu techo antes de la lluvia. Llama al 305-555-0100.",
    instagram: "Revisa tu techo antes de la lluvia.",
    google: "",
    linkedin: "",
    x: "",
    seo: "",
  },
  script: "",
  alt: "Techo con la marca",
};
const PIECE: Piece = {
  id: "p1",
  topic: "Cómo detectar una gotera a tiempo",
  objective: "Que llamen para una revisión",
  channels: ["facebook", "instagram"],
  format: "post",
  keyword: "gotera en el techo",
};
const DESIGN = {
  assets: [
    { shape: "square", url: "https://example.com/s.jpg", rights: "Foto de la biblioteca del negocio", alt: "Techo con la marca" },
    { shape: "story", url: "https://example.com/t.jpg", rights: "Foto de la biblioteca del negocio", alt: "Techo con la marca" },
    { shape: "wide", url: "https://example.com/w.jpg", rights: "Foto de la biblioteca del negocio", alt: "Techo con la marca" },
  ],
  mediaSelection: { source: "library" },
  summary: "Reutilicé una foto",
};
const RESEARCH = {
  items: [{ kind: "question", detail: "¿Cuánto cuesta reparar un techo?", source: "rank@2026-10-10T00:00:00.000Z" }],
  digest: [],
  usage,
};
const BUSINESS = { name: "Techos Miami", phone: "305-555-0100", website: "https://mio.com" };
const APPROVED = { approved: true, problems: [] };
const REJECTED = {
  approved: false,
  problems: [
    { kind: "ortografia", detail: "Hay una falta de ortografía en el titular.", sendBackTo: "copy" as const },
    { kind: "incoherente", detail: "La imagen no muestra un techo.", sendBackTo: "design" as const },
  ],
};

function setup(
  over: {
    step?: string;
    attempt?: number;
    piece?: unknown;
    ctx?: Record<string, unknown>;
    full?: ReturnType<typeof maxContext>;
    outputs?: Record<string, unknown>;
    business?: Record<string, unknown>;
    mode?: string;
    model?: ModelConfig | null;
    language?: "es" | "en";
  } = {},
) {
  const piece = over.piece === undefined ? PIECE : over.piece;
  const ctx = over.full ?? context({ piece, ...over.ctx });
  const outputs = over.outputs ?? { copy: { ...COPY, usage }, design: DESIGN, research: RESEARCH };
  const readStep = vi.fn(async (base: string) => outputs[base] ?? null);
  const use = vi.fn((name: string) => {
    if (name === "readStepOutput") return readStep;
    throw new AgentError(`La herramienta ${name} no está permitida.`);
  });
  db.business.mockResolvedValue({ ...BUSINESS, ...over.business });
  db.workspace.mockResolvedValue({ mode: over.mode ?? "auto" });
  const run = { id: "piece1", businessId: "b1", prompt: "Prepara contenido de goteras", context: ctx } as unknown as AgentRun;
  const attempt = over.attempt ?? 0;
  const input: AgentInput = {
    run,
    step: { id: over.step ?? (attempt ? `review-r${attempt}` : "review"), agent: "review", attempt },
    context: ctx,
    language: over.language ?? "es",
    model: over.model === undefined ? MODEL : over.model,
    tools: { use } as unknown as Tools,
  };
  return { input, use, readStep, run, ctx };
}
/** A copy whose Facebook text has a phone number that is not the business's (the rules fail, so no AI call). */
const wrongPhone = { copy: { ...COPY, variants: { ...COPY.variants, facebook: "Llama al 305-000-0000" }, usage } };

beforeEach(() => {
  ask.mockReset();
  topics.mockReset();
  db.business.mockReset();
  db.workspace.mockReset();
  ask.mockResolvedValue({ value: APPROVED, usage });
  topics.mockResolvedValue([]);
});

describe("registro y esquema", () => {
  it("el agente de revisión usa modelo y está registrado", () => {
    expect(AGENTS.review.run).toBe(runReview);
    expect(AGENTS.review.usesModel).toBe(true);
  });

  it("el veredicto: tipo de hasta 40 caracteres, detalle de hasta 300, a lo más 10 problemas y devolver a copy o design", () => {
    const problem = (over: Record<string, unknown> = {}) => ({ kind: "k", detail: "d", sendBackTo: "copy", ...over });
    const ok = (v: unknown) => ReviewVerdict.safeParse(v).success;
    expect(ok({ approved: true, problems: [] })).toBe(true);
    expect(ok({ approved: false, problems: [problem({ kind: "k".repeat(40), detail: "d".repeat(300) })] })).toBe(true);
    expect(ok({ approved: false, problems: [problem({ kind: "k".repeat(41) })] })).toBe(false);
    expect(ok({ approved: false, problems: [problem({ detail: "d".repeat(301) })] })).toBe(false);
    expect(ok({ approved: false, problems: [problem({ sendBackTo: "video" })] })).toBe(false);
    expect(ok({ approved: false, problems: Array.from({ length: 10 }, () => problem()) })).toBe(true);
    expect(ok({ approved: false, problems: Array.from({ length: 11 }, () => problem()) })).toBe(false);
    expect(ok({ problems: [] })).toBe(false);
  });
});

describe("las reglas van primero", () => {
  it("si fallan en la primera vuelta no se llama a la IA, no cuesta y se inserta la vuelta de corrección", async () => {
    const { input } = setup({ outputs: { ...wrongPhone, design: DESIGN, research: RESEARCH } });
    const result = await runReview(input);
    expect(ask).not.toHaveBeenCalled();
    expect(result.cents).toBe(0);
    expect(result.state).toBeUndefined();
    const data = result.data as { approved: boolean; problems: { kind: string }[]; ruleProblems: unknown[]; usage?: unknown };
    expect(data.approved).toBe(false);
    expect(data.problems.map((p) => p.kind)).toEqual(["telefono"]);
    expect(data.ruleProblems).toEqual(data.problems);
    expect("usage" in data).toBe(false);
    // The round: the writer, the designer and a new review. The video steps are never added.
    expect(result.insertSteps).toEqual(reworkSteps(data.problems as never, 0, "post"));
    expect(result.insertSteps?.map((s) => s.id)).toEqual(["copy-r1", "design-r1", "review-r1"]);
    expect(result.insertSteps?.every((s) => s.attempt === 1)).toBe(true);
  });

  it("no necesita el modelo cuando las reglas fallan", async () => {
    const { input } = setup({ model: null, outputs: { ...wrongPhone, design: DESIGN } });
    const result = await runReview(input);
    expect(result.insertSteps).toHaveLength(3);
    expect(ask).not.toHaveBeenCalled();
  });

  it("si fallan en la vuelta 1 la pieza espera al dueño con el resumen de los problemas, sin otra vuelta", async () => {
    const { input } = setup({ attempt: 1, outputs: { ...wrongPhone, design: DESIGN, research: RESEARCH } });
    const result = await runReview(input);
    expect(ask).not.toHaveBeenCalled();
    expect(result.cents).toBe(0);
    expect(result.insertSteps).toBeUndefined();
    expect(result.state).toBe("waiting_approval");
    expect(result.text).toContain("Goteras");
    expect(result.text).toContain("305-000-0000");
    expect((result.data as { problems: unknown[] }).problems).toHaveLength(1);
  });

  it("el texto para el dueño sigue el idioma del encargo", async () => {
    const { input } = setup({ attempt: 1, language: "en", outputs: { ...wrongPhone, design: DESIGN } });
    const result = await runReview(input);
    expect(result.text).toContain("did not pass the editorial review");
    expect(result.text).toContain("Goteras");
  });

  it("revisa el tema repetido con los temas recientes de este negocio sin los de esta pieza", async () => {
    topics.mockResolvedValue(["Otro tema", PIECE.topic]);
    const { input, run } = setup();
    const result = await runReview(input);
    expect(topics).toHaveBeenCalledTimes(1);
    const [businessId, now, except] = topics.mock.calls[0];
    expect([businessId, except]).toEqual(["b1", run.id]);
    expect(now).toBeInstanceOf(Date);
    expect((result.data as { problems: { kind: string }[] }).problems.map((p) => p.kind)).toEqual(["repetido"]);
    expect(ask).not.toHaveBeenCalled();
  });

  it("el teléfono y la web salen del negocio de la pieza", async () => {
    const { input } = setup({ business: { phone: "305-000-0000", website: "https://otra.com" } });
    // The copy's number is not this business's phone now.
    const result = await runReview(input);
    expect((result.data as { problems: { kind: string }[] }).problems.map((p) => p.kind)).toEqual(["telefono"]);
    expect(db.business).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "b1" } }));
    expect(db.workspace).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: "b1" } }));
  });

  describe("imagen o video", () => {
    const noAssets = { ...DESIGN, assets: [] };
    it("el diseño con imágenes (foto de la biblioteca o plantilla de marca) cuenta como foto", async () => {
      await runReview(setup().input);
      expect(ask).toHaveBeenCalledTimes(1);
    });

    it("sin imágenes en el diseño, instagram da falta-imagen hacia design y no se llama a la IA", async () => {
      const { input } = setup({ outputs: { copy: COPY, design: noAssets, research: RESEARCH } });
      const result = await runReview(input);
      expect(ask).not.toHaveBeenCalled();
      expect((result.data as { problems: unknown[] }).problems).toEqual([
        { kind: "falta-imagen", detail: "Instagram necesita una foto o un video.", sendBackTo: "design" },
      ]);
      expect(result.insertSteps?.map((s) => s.id)).toEqual(["design-r1", "review-r1"]);
    });

    it("un diseño ilegible o ausente no cuenta como imagen", async () => {
      for (const design of [null, "x", {}, { assets: "no" }, { assets: [{ shape: "square" }] }, { assets: [null, 3] }]) {
        ask.mockClear();
        const { input } = setup({ outputs: { copy: COPY, design, research: RESEARCH } });
        const result = await runReview(input);
        expect((result.data as { problems: { kind: string }[] }).problems.map((p) => p.kind)).toEqual(["falta-imagen"]);
      }
    });

    it("un video con su paso video cuenta como video; sin ese paso solo cuentan las imágenes", async () => {
      const tiktok = { ...PIECE, format: "video" as const, channels: ["tiktok"] };
      const withVideo = setup({ piece: tiktok, outputs: { copy: COPY, design: DESIGN, video: { projectId: "v1" }, research: RESEARCH } });
      await runReview(withVideo.input);
      expect(withVideo.readStep).toHaveBeenCalledWith("video");
      expect(ask).toHaveBeenCalledTimes(1);
      ask.mockClear();
      const without = setup({ piece: tiktok, outputs: { copy: COPY, design: DESIGN, research: RESEARCH } });
      const result = await runReview(without.input);
      // Only photos: TikTok needs a video.
      expect(ask).not.toHaveBeenCalled();
      expect((result.data as { problems: { kind: string }[] }).problems.map((p) => p.kind)).toEqual(["falta-imagen"]);
      // A post never reads the video step.
      const post = setup();
      await runReview(post.input);
      expect(post.readStep).not.toHaveBeenCalledWith("video");
    });
  });
});

describe("la llamada pagada", () => {
  it("una sola llamada con el esquema del veredicto y el modelo del paso; devuelve el veredicto con su consumo", async () => {
    const { input } = setup();
    const result = await runReview(input);
    expect(ask).toHaveBeenCalledTimes(1);
    const [schema, system, , model] = ask.mock.calls[0];
    expect(schema).toBe(ReviewVerdict);
    expect(system.startsWith(SYSTEM)).toBe(true);
    expect(system).toContain(MEDIA_POLICY);
    expect(model).toBe(MODEL);
    expect(result).toEqual({
      data: { approved: true, problems: [], ruleProblems: [], usage },
      cents: 4,
    });
  });

  it("sin modelo configurado y con las reglas limpias falla con un mensaje claro y no llama a la IA", async () => {
    const { input } = setup({ model: null });
    await expect(runReview(input)).rejects.toThrow("Falta configurar el modelo del agente de revisión.");
    expect(ask).not.toHaveBeenCalled();
  });

  it("el encargo lleva la pieza, el texto de sus canales, el diseño, el negocio y los hechos conocidos", async () => {
    const outputs = {
      copy: { ...COPY, variants: { ...COPY.variants, linkedin: "Texto de otro canal que no es de la pieza." }, script: "", usage },
      design: DESIGN,
      research: RESEARCH,
    };
    const future = new Date(Date.now() + 90 * 86400000).toISOString();
    const past = new Date(Date.now() - 86400000).toISOString();
    const knowledge = [
      { fact: "Atendemos cada día de 8 a 5.", url: "https://example.com/a", checkedAt: "2026-10-01T00:00:00.000Z", expiresAt: future, geography: "US" },
      { fact: "Un hecho vencido.", url: "https://example.com/b", checkedAt: "2026-01-01T00:00:00.000Z", expiresAt: past, geography: "US" },
    ];
    const { input } = setup({ outputs, ctx: { knowledge } });
    await runReview(input);
    const sent = ask.mock.calls[0][2] as Record<string, unknown>;
    expect(sent.piece).toEqual({
      id: "p1",
      format: "post",
      topic: PIECE.topic,
      objective: PIECE.objective,
      keyword: PIECE.keyword,
      channels: ["facebook", "instagram"],
    });
    expect(sent.copy).toEqual({
      title: "Goteras",
      headline: "¿Tienes una gotera?",
      summary: COPY.summary,
      texts: { facebook: COPY.variants.facebook, instagram: COPY.variants.instagram },
      alt: "Techo con la marca",
    });
    expect(JSON.stringify(sent)).not.toContain("otro canal");
    // The images: what they say and the rights, not where they are stored.
    expect(sent.design).toEqual({
      mediaType: "photo",
      assets: DESIGN.assets.map(({ shape, alt, rights }) => ({ shape, alt, rights })),
    });
    expect(JSON.stringify(sent.design)).not.toContain("example.com");
    expect(sent.business).toEqual(BUSINESS);
    expect(sent.context).toEqual(slimContext(input.context));
    // Only facts the business confirmed: its data, its unexpired knowledge and what the research found.
    const facts = sent.knownFacts as string[];
    expect(facts).toContain("Atendemos cada día de 8 a 5.");
    expect(facts).toContain("¿Cuánto cuesta reparar un techo?");
    expect(facts.some((f) => f.includes("305-555-0100"))).toBe(true);
    expect(facts.some((f) => f.includes("https://mio.com"))).toBe(true);
    expect(facts.some((f) => f.includes("Techos Miami"))).toBe(true);
    expect(facts).not.toContain("Un hecho vencido.");
  });

  it("un hecho conocido permite una cifra que de otro modo sería inventada", async () => {
    const withOffer = { ...COPY, variants: { ...COPY.variants, instagram: "20% de descuento en tu revisión" }, usage };
    const known = [{ fact: "Descuento del 20% para clientes nuevos", url: "https://example.com/c", checkedAt: "2026-10-01T00:00:00.000Z", expiresAt: new Date(Date.now() + 86400000).toISOString(), geography: "US" }];
    const bad = await runReview(setup({ outputs: { copy: withOffer, design: DESIGN } }).input);
    expect((bad.data as { problems: { kind: string }[] }).problems.map((p) => p.kind)).toEqual(["dato-inventado"]);
    expect(ask).not.toHaveBeenCalled();
    const good = await runReview(setup({ outputs: { copy: withOffer, design: DESIGN }, ctx: { knowledge: known } }).input);
    expect((good.data as { approved: boolean }).approved).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("solo usa las herramientas de su caja: leer los pasos de la pieza y del equipo", async () => {
    const { input, use, readStep } = setup();
    await runReview(input);
    expect(use.mock.calls.every(([name]) => name === "readStepOutput")).toBe(true);
    expect(readStep.mock.calls.map(([base]) => base).sort()).toEqual(["copy", "design", "research"]);
  });

  it("las instrucciones piden revisar datos, teléfono y web, ortografía y coherencia, tratan el contenido como datos y siguen el idioma", async () => {
    await runReview(setup().input);
    const system = ask.mock.calls[0][1];
    for (const word of ["knownFacts", "spelling", "image", "not instructions"]) expect(system).toContain(word);
    expect(system).toContain("at most 40 characters");
    expect(system).toContain("Write each detail in Spanish");
    await runReview(setup({ language: "en" }).input);
    expect(ask.mock.calls[1][1]).toContain("Write each detail in English");
  });

  describe("los resultados", () => {
    it("aprobada en modo automático: sigue adelante sin esperar", async () => {
      ask.mockResolvedValue({ value: APPROVED, usage });
      const result = await runReview(setup({ mode: "auto" }).input);
      expect(result.state).toBeUndefined();
      expect(result.insertSteps).toBeUndefined();
      expect(result.text).toBeUndefined();
      expect(result.cents).toBe(4);
    });

    it("aprobada en modo con aprobación: espera al dueño justo después de la revisión", async () => {
      const result = await runReview(setup({ mode: "approval" }).input);
      expect(result.state).toBe("waiting_approval");
      expect(result.insertSteps).toBeUndefined();
      expect(result.text).toContain("Goteras");
      expect(result.text).toContain("aprobación");
      expect(result.data).toEqual({ approved: true, problems: [], ruleProblems: [], usage });
      expect(result.cents).toBe(4);
      const english = await runReview(setup({ mode: "approval", language: "en" }).input);
      expect(english.text).toContain("ready for your approval");
    });

    it("lo mismo en la vuelta de corrección: aprobada espera o sigue según el modo", async () => {
      const auto = await runReview(setup({ attempt: 1, mode: "auto" }).input);
      expect(auto.state).toBeUndefined();
      const approval = await runReview(setup({ attempt: 1, mode: "approval" }).input);
      expect(approval.state).toBe("waiting_approval");
    });

    it("rechazada en la primera vuelta: guarda los problemas y inserta la vuelta según a quién se devuelven", async () => {
      ask.mockResolvedValue({ value: REJECTED, usage });
      const result = await runReview(setup({ mode: "approval" }).input);
      expect(result.state).toBeUndefined();
      expect(result.cents).toBe(4);
      expect(result.data).toEqual({ approved: false, problems: REJECTED.problems, ruleProblems: [], usage });
      expect(result.insertSteps).toEqual(reworkSteps(REJECTED.problems, 0, "post"));
      expect(result.insertSteps?.map((s) => s.id)).toEqual(["copy-r1", "design-r1", "review-r1"]);
      // Only the image: the writer is not asked again.
      ask.mockResolvedValue({ value: { approved: false, problems: [REJECTED.problems[1]] }, usage });
      const image = await runReview(setup().input);
      expect(image.insertSteps?.map((s) => s.id)).toEqual(["design-r1", "review-r1"]);
    });

    it("el video no se vuelve a hacer en la vuelta de corrección", async () => {
      ask.mockResolvedValue({ value: REJECTED, usage });
      const piece = { ...PIECE, format: "video" as const, channels: ["instagram"] };
      const result = await runReview(
        setup({ piece, outputs: { copy: COPY, design: DESIGN, video: { projectId: "v" }, research: RESEARCH } }).input,
      );
      expect(result.insertSteps?.map((s) => s.id)).toEqual(["copy-r1", "design-r1", "review-r1"]);
    });

    it("rechazada en la vuelta 1: espera al dueño con el resumen de los problemas y no inserta otra vuelta", async () => {
      ask.mockResolvedValue({ value: REJECTED, usage });
      for (const attempt of [1, 2]) {
        const result = await runReview(setup({ attempt, mode: "auto" }).input);
        expect(result.insertSteps).toBeUndefined();
        expect(result.state).toBe("waiting_approval");
        expect(result.cents).toBe(4);
        expect(result.data).toEqual({ approved: false, problems: REJECTED.problems, ruleProblems: [], usage });
        expect(result.text).toContain("Goteras");
        expect(result.text).toContain("Hay una falta de ortografía en el titular.");
        expect(result.text).toContain("La imagen no muestra un techo.");
      }
      const english = await runReview(setup({ attempt: 1, language: "en" }).input);
      expect(english.text).toContain("did not pass the editorial review");
      expect(english.text).toContain("La imagen no muestra un techo.");
    });

    it("la IA rechaza sin explicar: queda un problema revision hacia copy", async () => {
      ask.mockResolvedValue({ value: { approved: false, problems: [] }, usage });
      const result = await runReview(setup().input);
      const problems = (result.data as { problems: { kind: string; detail: string; sendBackTo: string }[] }).problems;
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ kind: "revision", sendBackTo: "copy" });
      expect(problems[0].detail.length).toBeGreaterThan(10);
      expect((result.data as { approved: boolean }).approved).toBe(false);
      expect(result.insertSteps?.map((s) => s.id)).toEqual(["copy-r1", "design-r1", "review-r1"]);
    });

    it("la IA aprueba pero lista problemas: no se aprueba", async () => {
      ask.mockResolvedValue({ value: { approved: true, problems: [REJECTED.problems[0]] }, usage });
      const result = await runReview(setup({ mode: "approval" }).input);
      expect((result.data as { approved: boolean }).approved).toBe(false);
      expect(result.state).toBeUndefined();
      expect(result.insertSteps).toBeDefined();
    });

    it("los problemas de la IA son de una línea acotada, porque llegan al redactor y al dueño", async () => {
      ask.mockResolvedValue({
        value: {
          approved: false,
          problems: [{ kind: "tono\n  malo", detail: "Primera línea.\n\nSegunda   línea.", sendBackTo: "copy" }, { kind: "   ", detail: "Vacío.", sendBackTo: "design" }],
        },
        usage,
      });
      const result = await runReview(setup().input);
      expect((result.data as { problems: unknown[] }).problems).toEqual([
        { kind: "tono malo", detail: "Primera línea. Segunda línea.", sendBackTo: "copy" },
        { kind: "revision", detail: "Vacío.", sendBackTo: "design" },
      ]);
    });

    it("guarda un solo formato de datos para el redo del dueño: approved, problems, ruleProblems y usage", async () => {
      ask.mockResolvedValue({ value: REJECTED, usage });
      const result = await runReview(setup().input);
      expect(problemsOf(result.data)).toEqual(REJECTED.problems);
      const rules = await runReview(setup({ outputs: { ...wrongPhone, design: DESIGN } }).input);
      expect(problemsOf(rules.data)).toHaveLength(1);
    });
  });
});

describe("el presupuesto del prompt", () => {
  const fullCopy = {
    ...COPY,
    summary: "s".repeat(2000),
    variants: {
      facebook: "Revisa tu techo antes de la lluvia. ".repeat(100),
      instagram: "ñ".repeat(2100),
      google: "é".repeat(1400),
      linkedin: "á".repeat(2900),
      x: "ó".repeat(270),
      seo: "",
    },
  };
  const channels = ["facebook", "instagram", "google", "linkedin", "x"];
  const manyItems = Array.from({ length: 30 }, (_, i) => ({ kind: "k".repeat(60), detail: "ñ".repeat(500), source: `rank@${i}` }));

  it("con todo al máximo, lo medido antes de la llamada cabe en el presupuesto y lo que se recorta son los hechos", async () => {
    const piece = { ...PIECE, channels };
    const { input } = setup({
      full: maxContext({ piece }),
      piece,
      outputs: { copy: fullCopy, design: DESIGN, research: { items: manyItems } },
    });
    const result = await runReview(input);
    expect(ask).toHaveBeenCalledTimes(1);
    const [schema, system, payload] = ask.mock.calls[0];
    expect(promptBytes(schema, system, payload)).toBeLessThanOrEqual(PROMPT_BUDGET);
    expect((result.data as { approved: boolean }).approved).toBe(true);
    // The text under review is never cut.
    const sent = payload as { copy: { texts: Record<string, string> }; knownFacts: string[] };
    expect(sent.copy.texts).toEqual(Object.fromEntries(channels.map((c) => [c, fullCopy.variants[c as keyof typeof fullCopy.variants]])));
    expect(sent.knownFacts.length).toBeLessThan(30 + 15 + 3);
  });

  it("cuando la pieza sola no cabe no se llama a la IA: queda un problema hacia copy y no cuesta", async () => {
    // Emoji take 4 bytes and 2 characters: every field at its limit is more than the whole prompt may hold.
    const emoji = (chars: number) => "😀".repeat(chars / 2);
    const huge = {
      ...COPY,
      summary: emoji(2000),
      script: emoji(5000),
      variants: { facebook: emoji(6000), instagram: emoji(2100), google: emoji(1400), linkedin: emoji(2900), x: emoji(270), seo: "" },
    };
    const piece = { ...PIECE, channels };
    const result = await runReview(setup({ piece, outputs: { copy: huge, design: DESIGN, research: RESEARCH } }).input);
    expect(ask).not.toHaveBeenCalled();
    expect(result.cents).toBe(0);
    const problems = (result.data as { problems: { kind: string; sendBackTo: string }[] }).problems;
    expect(problems).toEqual([expect.objectContaining({ kind: "revision", sendBackTo: "copy" })]);
    expect(result.insertSteps).toBeDefined();
  });
});

describe("lo que no es de la revisión o no se puede leer", () => {
  it("otro paso o un paso con nombre raro no es de este agente", async () => {
    for (const step of ["copy", "review2", "prepare", "xreview", "review-r"]) {
      await expect(runReview(setup({ step }).input)).rejects.toThrow("Agente no disponible.");
    }
    expect(ask).not.toHaveBeenCalled();
  });

  it("una pieza sin plan válido o sin texto escrito se detiene con un mensaje claro", async () => {
    await expect(runReview(setup({ piece: { id: "x" } }).input)).rejects.toThrow("La pieza no tiene un plan válido.");
    await expect(runReview(setup({ piece: null }).input)).rejects.toThrow("La pieza no tiene un plan válido.");
    await expect(runReview(setup({ outputs: { design: DESIGN } }).input)).rejects.toThrow("Falta completar el paso anterior.");
    await expect(runReview(setup({ outputs: { copy: { title: "x" }, design: DESIGN } }).input)).rejects.toThrow("Falta completar el paso anterior.");
    expect(ask).not.toHaveBeenCalled();
  });

  it("la revisión de un artículo lee el paso article, no copy ni design", async () => {
    const piece = { ...PIECE, format: "articulo" as const, channels: ["seo"] };
    const article = { ...COPY, variants: { ...COPY.variants, seo: "Un artículo largo sobre goteras. ".repeat(20) }, usage };
    const { input, readStep } = setup({ piece, outputs: { article, research: RESEARCH } });
    const result = await runReview(input);
    expect(readStep.mock.calls.map(([base]) => base).sort()).toEqual(["article", "research"]);
    expect(ask).toHaveBeenCalledTimes(1);
    expect((result.data as { approved: boolean }).approved).toBe(true);
    // An article that was not written as text (the report only) cannot be reviewed yet.
    await expect(
      runReview(setup({ piece, outputs: { article: { reportId: "r1" }, research: RESEARCH } }).input),
    ).rejects.toThrow("Falta completar el paso anterior.");
  });

  it("un artículo no pide imagen ni video", async () => {
    const piece = { ...PIECE, format: "articulo" as const, channels: ["seo"] };
    const article = { ...COPY, variants: { ...COPY.variants, seo: "Un artículo largo sobre goteras. ".repeat(20) }, usage };
    const result = await runReview(setup({ piece, outputs: { article, research: RESEARCH } }).input);
    expect((result.data as { ruleProblems: unknown[] }).ruleProblems).toEqual([]);
  });
});

describe("lo que recibe la IA", () => {
  it("del contexto del encargo solo el negocio, la industria y el objetivo; nada de la pieza ni de otros mensajes", async () => {
    const { input } = setup({ full: maxContext({ piece: PIECE }) });
    await runReview(input);
    expect(ask).toHaveBeenCalledTimes(1);
    const sent = ask.mock.calls[0][2] as { context: Record<string, unknown> };
    expect(Object.keys(sent.context).sort()).toEqual(["business", "industry", "objective"]);
    expect(JSON.stringify(sent)).not.toContain("herramienta 0");
  });
});
