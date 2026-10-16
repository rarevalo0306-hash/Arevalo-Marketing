// Los agentes de redacción y diseño (pasos copy y design de una pieza): sin base de datos ni proveedor.
// La llamada pagada y el diseño guardado son simulacros; las pruebas de base de datos están en tests/agent-database.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRun } from "@prisma/client";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/agent/metered", async (original) => ({
  ...(await original<typeof import("@/lib/agent/metered")>()),
  meteredAsk: vi.fn(),
}));
vi.mock("@/lib/agent/content-steps", async (original) => ({
  ...(await original<typeof import("@/lib/agent/content-steps")>()),
  designAssets: vi.fn(),
}));

import { AgentError } from "@/lib/agent/access";
import { AGENTS } from "@/lib/agent/agents";
import { runCopy } from "@/lib/agent/agents/copy";
import { runDesign } from "@/lib/agent/agents/design";
import type { AgentInput } from "@/lib/agent/agents/types";
import { PROMPT_BUDGET, boundedContext } from "@/lib/agent/bounded-context";
import { designAssets, writeCopy } from "@/lib/agent/content-steps";
import { meteredAsk, promptBytes, type ModelConfig } from "@/lib/agent/metered";
import type { Piece, ReviewProblem } from "@/lib/agent/plan";
import { MEDIA_POLICY, SYSTEM } from "@/lib/agent/prompts";
import { Copy } from "@/lib/agent/schema";
import type { Tools } from "@/lib/agent/tools";
import { context, maxContext } from "./fixtures/agent-context";

const ask = vi.mocked(meteredAsk);
const assets = vi.mocked(designAssets);
const MODEL: ModelConfig = {
  provider: "gemini",
  model: "gemini-x",
  inputRate: 0.3,
  outputRate: 2.5,
  key: "synthetic-no-provider-access",
};
const usage = { inputTokens: 100, outputTokens: 50, cents: 4, model: "gemini-x" };
const COPY: Copy = {
  title: "Techos",
  headline: "¿Cómo cuidas tu techo?",
  summary: "Consejos",
  variants: { facebook: "Texto.", instagram: "", google: "", linkedin: "", x: "", seo: "" },
  script: "",
  alt: "Techo con la marca",
};
const PIECE: Piece = {
  id: "p1",
  topic: "Cómo detectar una gotera a tiempo",
  objective: "Que llamen para una revisión",
  channels: ["facebook"],
  format: "post",
  keyword: "gotera en el techo",
};
const PLAN = { reply: "", goal: "Más llamadas por goteras", maxPieces: 3 };
const RESEARCH = {
  items: [{ kind: "question", detail: "¿Cuánto cuesta un techo?", source: "rank@2026-10-10T00:00:00.000Z" }],
  digest: [{ kind: "rank", detail: "no se manda", source: "rank@2026-10-10T00:00:00.000Z", reportAt: "x", stale: false }],
  dropped: 0,
  usage,
};
const PROBLEMS: ReviewProblem[] = [
  { kind: "canal", detail: "Falta el texto de facebook", sendBackTo: "copy" },
  { kind: "falta-imagen", detail: "La imagen no se ve", sendBackTo: "design" },
];

function setup(
  over: {
    step?: string;
    attempt?: number;
    piece?: unknown;
    ctx?: Record<string, unknown>;
    full?: ReturnType<typeof maxContext>;
    outputs?: Record<string, unknown>;
    model?: ModelConfig | null;
    language?: "es" | "en";
  } = {},
) {
  const piece = over.piece === undefined ? PIECE : over.piece;
  const ctx = over.full ?? context({ piece, ...over.ctx });
  const outputs = over.outputs ?? { plan: PLAN, research: RESEARCH };
  const readStep = vi.fn(async (base: string) => outputs[base] ?? null);
  const use = vi.fn((name: string) => {
    if (name === "readStepOutput") return readStep;
    throw new AgentError(`La herramienta ${name} no está permitida.`);
  });
  const run = { id: "piece1", businessId: "b1", prompt: "Prepara contenido de goteras", context: ctx } as unknown as AgentRun;
  const id = over.step ?? "copy";
  const input: AgentInput = {
    run,
    step: { id, agent: id.startsWith("design") ? "design" : "copy", attempt: over.attempt ?? 0 },
    context: ctx,
    language: over.language ?? "es",
    model: over.model === undefined ? MODEL : over.model,
    tools: { use } as unknown as Tools,
  };
  return { input, use, readStep, run, ctx };
}

beforeEach(() => {
  ask.mockReset();
  assets.mockReset();
  ask.mockResolvedValue({ value: COPY, usage });
});

describe("registro", () => {
  it("redacción y diseño ya tienen su agente; el diseño no usa modelo", () => {
    expect(AGENTS.copy.run).toBe(runCopy);
    expect(AGENTS.design.run).toBe(runDesign);
    expect(AGENTS.copy.usesModel).toBe(true);
    expect(AGENTS.design.usesModel).toBe(false);
  });
});

describe("agente de redacción", () => {
  it("una sola llamada pagada con el esquema Copy y el modelo del paso; devuelve el texto con su consumo", async () => {
    const { input } = setup();
    const result = await runCopy(input);
    expect(result).toEqual({ data: { ...COPY, usage }, cents: 4 });
    expect(result.state).toBeUndefined();
    expect(ask).toHaveBeenCalledTimes(1);
    const [schema, system, , model] = ask.mock.calls[0];
    expect(schema).toBe(Copy);
    expect(system.startsWith(SYSTEM)).toBe(true);
    expect(system).toContain(MEDIA_POLICY);
    expect(model).toBe(MODEL);
  });

  it("lee el plan y la investigación del equipo con la herramienta, y solo manda las oportunidades", async () => {
    const { input, use, readStep } = setup();
    await runCopy(input);
    expect(use.mock.calls.every(([name]) => name === "readStepOutput")).toBe(true);
    expect(readStep.mock.calls.map(([base]) => base).sort()).toEqual(["plan", "research"]);
    const payload = ask.mock.calls[0][2] as { research: unknown };
    expect(payload.research).toEqual({ items: RESEARCH.items });
    expect(JSON.stringify(payload)).not.toContain("no se manda");
  });

  it("el encargo lleva la pieza y la meta del equipo, en el idioma del dueño", async () => {
    await runCopy(setup().input);
    const sent = ask.mock.calls[0][2] as { request: string };
    expect(sent.request).toBe(
      [
        "Pieza p1 · formato: post · canales: facebook",
        "Tema: Cómo detectar una gotera a tiempo",
        "Objetivo: Que llamen para una revisión",
        "Palabra clave: gotera en el techo",
        "Meta del equipo: Más llamadas por goteras",
        "Escribe los textos en español.",
      ].join("\n"),
    );
    await runCopy(setup({ language: "en" }).input);
    const english = (ask.mock.calls[1][2] as { request: string }).request;
    expect(english).toContain("Piece p1 · format: post · channels: facebook");
    expect(english).toContain("Topic: Cómo detectar una gotera a tiempo");
    expect(english).toContain("Team goal: Más llamadas por goteras");
    expect(english.endsWith("Write the copy in English.")).toBe(true);
  });

  it("sin objetivo, palabra clave ni meta, el encargo no deja líneas vacías; el texto del plan es una línea acotada", async () => {
    await runCopy(
      setup({
        piece: { ...PIECE, objective: "", keyword: "", topic: "Tema\n\nde   prueba" },
        outputs: { plan: { goal: "Meta\nen dos\nlíneas ".repeat(100) }, research: null },
      }).input,
    );
    const request = (ask.mock.calls[0][2] as { request: string }).request;
    expect(request.split("\n")).toHaveLength(4);
    expect(request).toContain("Tema: Tema de prueba");
    expect(request).not.toContain("Objetivo");
    expect(request).not.toContain("Palabra clave");
    const goal = request.split("\n")[2];
    expect(goal.startsWith("Meta del equipo: Meta en dos líneas")).toBe(true);
    expect(goal.length).toBeLessThanOrEqual("Meta del equipo: ".length + 500);
    expect((ask.mock.calls[0][2] as { research: unknown }).research).toEqual({ items: [] });
  });

  it("el texto es solo para los canales de la pieza; el guion solo para un video", async () => {
    await runCopy(setup({ piece: { ...PIECE, channels: ["facebook", "instagram", "tiktok"] } }).input);
    let system = ask.mock.calls[0][1];
    expect(system).toContain("for these channels: facebook, instagram.");
    expect(system).not.toContain("linkedin");
    expect(system).toContain("empty string for every other variant");
    expect(system).toContain("Leave `script` empty");
    await runCopy(setup({ piece: { ...PIECE, format: "video", channels: ["instagram"] } }).input);
    system = ask.mock.calls[1][1];
    expect(system).toContain("for these channels: instagram.");
    expect(system).toContain("original short video script in `script`");
    expect(system).not.toContain("Leave `script` empty");
    await runCopy(setup({ piece: { ...PIECE, format: "carrusel" } }).input);
    expect(ask.mock.calls[2][1]).toContain("swipe through the slides");
    // A channel with no text of its own still gets the base text, which is Facebook's.
    await runCopy(setup({ piece: { ...PIECE, channels: ["tiktok"] } }).input);
    expect(ask.mock.calls[3][1]).toContain("for these channels: facebook.");
  });

  it("el contexto no lleva la pieza ni las señales, que ya van en el encargo", async () => {
    const { input, ctx } = setup({ ctx: { signals: { remaining: { posts: 2 } } } });
    await runCopy(input);
    const sent = ask.mock.calls[0][2] as { context: Record<string, unknown> };
    expect(sent.context).toEqual(boundedContext({ ...ctx, piece: undefined, signals: undefined } as never));
    expect("piece" in sent.context).toBe(false);
    expect("signals" in sent.context).toBe(false);
    expect(sent.context.business).toMatchObject({ name: "Techos Miami" });
  });

  describe("las notas de la revisión", () => {
    it("en la primera vuelta no se lee la revisión ni se mandan notas", async () => {
      const { input, readStep } = setup({ outputs: { plan: PLAN, research: RESEARCH, review: { problems: PROBLEMS } } });
      await runCopy(input);
      expect(readStep).not.toHaveBeenCalledWith("review");
      const sent = ask.mock.calls[0][2] as Record<string, unknown>;
      expect("notes" in sent).toBe(false);
      expect(ask.mock.calls[0][1]).not.toContain("`notes`");
    });

    it("en la vuelta de corrección manda todos los problemas del último review y el texto pide corregirlos", async () => {
      const review = { approved: false, problems: [...PROBLEMS, { kind: "roto", detail: 5 }, "basura"] };
      const { input, readStep } = setup({ step: "copy-r1", attempt: 1, outputs: { plan: PLAN, research: RESEARCH, review } });
      await runCopy(input);
      expect(readStep).toHaveBeenCalledWith("review");
      const sent = ask.mock.calls[0][2] as { notes: unknown; request: string };
      // Both problems, the one for the writer and the one for the designer; what cannot be read is skipped.
      expect(sent.notes).toEqual(PROBLEMS);
      expect(ask.mock.calls[0][1]).toContain("`notes`");
      expect(ask.mock.calls[0][1]).toContain("Fix every one");
      // The request is the same as in the first round.
      await runCopy(setup().input);
      expect((ask.mock.calls[1][2] as { request: string }).request).toBe(sent.request);
    });

    it("una vuelta sin revisión legible no manda notas ni las menciona", async () => {
      for (const review of [null, "x", { approved: true }, { problems: "no" }, { problems: [] }]) {
        ask.mockClear();
        await runCopy(setup({ step: "copy-r2", attempt: 2, outputs: { plan: PLAN, research: RESEARCH, review } }).input);
        expect("notes" in (ask.mock.calls[0][2] as object)).toBe(false);
        expect(ask.mock.calls[0][1]).not.toContain("`notes`");
      }
    });
  });

  describe("el presupuesto del prompt", () => {
    const big: ReviewProblem[] = Array.from({ length: 10 }, (_, i) => ({
      kind: `problema-${i}`.padEnd(40, "k"),
      detail: "d".repeat(300),
      sendBackTo: i % 2 ? "design" : "copy",
    }));
    const manyItems = Array.from({ length: 30 }, (_, i) => ({ kind: "k".repeat(60), detail: "ñ".repeat(500), source: `rank@${i}`.padEnd(120, "s") }));

    it("con el contexto, la investigación y las notas al máximo, el prompt cabe en 28 KB sin recortar el encargo ni las notas", async () => {
      const full = maxContext({ piece: { ...PIECE, topic: "t".repeat(200), objective: "o".repeat(300), keyword: "k".repeat(80) } });
      const { input } = setup({
        step: "copy-r1",
        attempt: 1,
        full,
        outputs: { plan: { goal: "g".repeat(900) }, research: { items: manyItems }, review: { problems: big } },
      });
      expect(promptBytes(Copy, SYSTEM, boundedContext(full))).toBeGreaterThan(PROMPT_BUDGET);
      await runCopy(input);
      const [, system, payload] = ask.mock.calls[0];
      expect(promptBytes(Copy, system, payload)).toBeLessThanOrEqual(PROMPT_BUDGET);
      const sent = payload as { notes: unknown[]; request: string; research: { items: unknown[] } };
      expect(sent.notes).toEqual(big);
      expect(sent.request).toContain("t".repeat(200));
      expect(sent.request).toContain("o".repeat(300));
      expect(sent.request).toContain("g".repeat(500));
      expect(sent.research.items.length).toBeLessThan(15);
    });

    it("un encargo normal no se recorta", async () => {
      const { input, ctx } = setup();
      await runCopy(input);
      const sent = ask.mock.calls[0][2] as { context: unknown };
      expect(sent.context).toEqual(boundedContext({ ...ctx, piece: undefined } as never));
      expect(promptBytes(Copy, ask.mock.calls[0][1], ask.mock.calls[0][2])).toBeLessThan(PROMPT_BUDGET);
    });
  });

  describe("lo que no hace", () => {
    it("el artículo todavía no existe: article y article-r<n> fallan sin leer nada ni llamar al modelo", async () => {
      for (const step of ["article", "article-r1", "video", "copywriter", "review"]) {
        const { input, use } = setup({ step });
        await expect(runCopy(input)).rejects.toThrow("Agente no disponible.");
        expect(use).not.toHaveBeenCalled();
      }
      expect(ask).not.toHaveBeenCalled();
    });

    it("sin modelo configurado, falla con un mensaje claro y sin llamada", async () => {
      const { input, use } = setup({ model: null });
      await expect(runCopy(input)).rejects.toThrow("Falta configurar el modelo del agente de redacción.");
      expect(use).not.toHaveBeenCalled();
      expect(ask).not.toHaveBeenCalled();
    });

    it("sin una pieza legible en el contexto, detiene el paso sin llamar al modelo", async () => {
      for (const piece of [undefined, null, "p1", { id: "p1" }, { ...PIECE, id: "p99" }, { ...PIECE, channels: [] }]) {
        await expect(runCopy(setup({ piece: piece ?? "x" }).input)).rejects.toThrow("La pieza no tiene un plan válido.");
      }
      expect(ask).not.toHaveBeenCalled();
    });

    it("un error del proveedor sube tal cual (una sola llamada, sin reintento)", async () => {
      ask.mockRejectedValueOnce(new AgentError("El proveedor de IA respondió 500. El trabajo se detuvo sin reintentar el cargo."));
      await expect(runCopy(setup().input)).rejects.toThrow("respondió 500");
      expect(ask).toHaveBeenCalledTimes(1);
    });
  });
});

describe("writeCopy sin pieza (el flujo de campañas)", () => {
  it("manda el contexto acotado, la investigación y el encargo tal cual, y ignora las notas", async () => {
    const ctx = context();
    const research = { summary: "Objetivo", keywords: [] };
    await writeCopy({ context: ctx, research, request: "Prepara una campaña", notes: PROBLEMS, model: MODEL });
    const [schema, system, payload, model] = ask.mock.calls[0];
    expect(schema).toBe(Copy);
    expect(system).toBe(
      SYSTEM +
        "\n" +
        MEDIA_POLICY +
        " You are the copy specialist. Write one original campaign post, adapted per channel, plus an original short video script. Use only verified business details and research facts. No made-up discounts, guarantees, statistics or time limits.",
    );
    expect(payload).toEqual({ context: boundedContext(ctx), research, request: "Prepara una campaña" });
    expect(Object.keys(payload as object)).toEqual(["context", "research", "request"]);
    expect(model).toBe(MODEL);
  });
});

describe("agente de diseño", () => {
  const designed = {
    assets: [{ shape: "square", url: "https://example.com/a.jpg", rights: "r", alt: "a" }],
    mediaSelection: { policy: "library_first", source: "library", libraryItems: [{ id: "L1", kind: "photo" }], generatedFromScratch: false },
  };
  beforeEach(() => {
    assets.mockResolvedValue(designed as never);
  });

  it("diseña con el último texto de la pieza; sin diseño anterior no reutiliza nada", async () => {
    const { input, run, use, readStep } = setup({ step: "design", outputs: { copy: { ...COPY, usage } } });
    const result = await runDesign(input);
    expect(use.mock.calls.every(([name]) => name === "readStepOutput")).toBe(true);
    expect(readStep.mock.calls.map(([base]) => base).sort()).toEqual(["copy", "design"]);
    expect(assets).toHaveBeenCalledTimes(1);
    expect(assets).toHaveBeenCalledWith({ run, copy: COPY, language: "es", reuse: [] });
    expect(result).toEqual({
      data: {
        assets: designed.assets,
        mediaSelection: designed.mediaSelection,
        summary: "Reutilicé una foto adecuada de la biblioteca de esta compañía en tres formatos con su marca. No generé una imagen nueva con IA.",
      },
    });
    // No model, no charge.
    expect(result.cents).toBeUndefined();
    expect(ask).not.toHaveBeenCalled();
  });

  it("en una vuelta de corrección reutiliza las fotos del diseño anterior de la pieza", async () => {
    const earlier = { mediaSelection: { libraryItems: [{ id: "L1", kind: "photo" }, { id: "L2", kind: "video" }, { id: 7 }, null, { id: "" }] } };
    const { input, run } = setup({ step: "design-r1", attempt: 1, language: "en", model: null, outputs: { copy: COPY, design: earlier } });
    const result = await runDesign(input);
    expect(assets).toHaveBeenCalledWith({ run, copy: COPY, language: "en", reuse: ["L1", "L2"] });
    expect((result.data as { summary: string }).summary).toMatch(/^Reused a suitable photo/);
  });

  it("sin foto de la biblioteca lo dice en el resumen", async () => {
    assets.mockResolvedValue({ assets: [], mediaSelection: { policy: "library_first", source: "brand_template", libraryItems: [], generatedFromScratch: false } } as never);
    const result = await runDesign(setup({ step: "design", outputs: { copy: COPY } }).input);
    expect((result.data as { summary: string }).summary).toMatch(/^No encontré una foto adecuada/);
  });

  it("un diseño anterior ilegible no reutiliza nada", async () => {
    for (const design of ["x", 5, { mediaSelection: "no" }, { mediaSelection: { libraryItems: "no" } }, { mediaSelection: { libraryItems: [null] } }]) {
      assets.mockClear();
      await runDesign(setup({ step: "design-r2", attempt: 2, outputs: { copy: COPY, design } }).input);
      expect(assets.mock.calls[0][0].reuse).toEqual([]);
    }
  });

  it("sin el texto de la pieza detiene el paso sin diseñar", async () => {
    for (const copy of [null, "x", { title: "solo" }]) {
      await expect(runDesign(setup({ step: "design", outputs: { copy } }).input)).rejects.toThrow("Falta completar el paso anterior.");
    }
    expect(assets).not.toHaveBeenCalled();
  });

  it("solo hace design y design-r<n>", async () => {
    for (const step of ["video", "designer", "render", "copy"]) {
      const { input, use } = setup({ step, outputs: { copy: COPY } });
      await expect(runDesign(input)).rejects.toThrow("Agente no disponible.");
      expect(use).not.toHaveBeenCalled();
    }
    expect(assets).not.toHaveBeenCalled();
  });
});
