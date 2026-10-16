// El agente de video (paso video de una pieza): arma el guion con el texto de la pieza y la biblioteca, lo cotiza y espera la
// aprobación del dueño sin gastar nada. Sin base de datos ni proveedor: las herramientas son de mentira.
// El render que sigue a la aprobación y la reserva exacta están en tests/agent-database.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRun } from "@prisma/client";

vi.mock("@/lib/db", () => ({ db: {} }));
const fal = vi.hoisted(() => ({ max: 50 }));
vi.mock("@/lib/video-jobs", async (original) => ({
  ...(await original<typeof import("@/lib/video-jobs")>()),
  maxCentsPerVideo: () => fal.max,
}));

import { AgentError } from "@/lib/agent/access";
import { AGENTS } from "@/lib/agent/agents";
import { runVideo } from "@/lib/agent/agents/video";
import type { AgentInput } from "@/lib/agent/agents/types";
import { Refusal } from "@/lib/agent/guard";
import { Copy } from "@/lib/agent/schema";
import type { Tools, VideoQuote } from "@/lib/agent/tools";
import type { VideoMedia } from "@/lib/video-plan";
import { context } from "./fixtures/agent-context";

const COPY: Copy = {
  title: "Techos",
  headline: "Cuida tu techo",
  summary: "Tres consejos",
  variants: { facebook: "Texto.", instagram: "", google: "", linkedin: "", x: "", seo: "" },
  script: "Tres consejos para cuidar tu techo antes de la lluvia.",
  alt: "Techo con la marca",
};
const DESIGN = {
  assets: [
    { shape: "square", url: "https://example.com/s.jpg", rights: "x", alt: "x" },
    { shape: "story", url: "https://example.com/t.jpg", rights: "x", alt: "x" },
    { shape: "wide", url: "https://example.com/w.jpg", rights: "x", alt: "x" },
  ],
  mediaSelection: { source: "library", libraryItems: [{ id: "lib1", kind: "photo" }], generatedFromScratch: false },
};
const PIECE = { id: "p3", topic: "Video de techos", objective: "", channels: ["facebook"], format: "video", keyword: "" };
const media = (id: string, kind: "photo" | "video" = "photo"): VideoMedia => ({
  id,
  kind,
  url: `https://example.com/${id}.jpg`,
  thumb: `https://example.com/${id}.jpg`,
  focus: null,
  width: 1080,
  height: 1920,
  durationSec: kind === "video" ? 8 : 0,
  about: id,
});
const STORYBOARD = { v: 1, scenes: [{ id: "s0" }], media: [], music: { on: false } } as never;
const QUOTE = (cents: number): VideoQuote => ({ storyboard: STORYBOARD, cents, maxCents: fal.max });

function setup(
  over: {
    step?: string;
    outputs?: Record<string, unknown>;
    library?: VideoMedia[];
    cents?: number;
    language?: "es" | "en";
  } = {},
) {
  const outputs = over.outputs ?? { copy: COPY, design: DESIGN };
  const readStep = vi.fn(async (base: string) => outputs[base] ?? null);
  const listLibrary = vi.fn<(idea: string, options: object) => Promise<VideoMedia[]>>(
    async () => over.library ?? [media("lib1"), media("clip1", "video")],
  );
  const videoQuote = vi.fn<(idea: string, media: VideoMedia[], language: string) => Promise<VideoQuote>>(
    async () => QUOTE(over.cents ?? 35),
  );
  const use = vi.fn((name: string) => {
    if (name === "readStepOutput") return readStep;
    if (name === "listLibrary") return listLibrary;
    if (name === "videoQuote") return videoQuote;
    throw new AgentError(`La herramienta ${name} no está permitida.`);
  });
  const ctx = context({ piece: PIECE });
  const run = { id: "piece1", businessId: "b1", prompt: "Prepara contenido de techos", context: ctx } as unknown as AgentRun;
  const input: AgentInput = {
    run,
    step: { id: over.step ?? "video", agent: "video", attempt: 0 },
    context: ctx,
    language: over.language ?? "es",
    model: null,
    tools: { use } as unknown as Tools,
  };
  return { input, use, readStep, listLibrary, videoQuote };
}

beforeEach(() => {
  fal.max = 50;
});

describe("agente de video", () => {
  it("está registrado, no usa modelo y su caja de herramientas no incluye el render", () => {
    expect(AGENTS.video.run).toBe(runVideo);
    expect(AGENTS.video.usesModel).toBe(false);
    expect(AGENTS.video.tools).toEqual(["readContext", "readStepOutput", "listLibrary", "videoQuote"]);
  });

  it("arma el guion con el texto de la pieza y su biblioteca, lo cotiza y espera la aprobación sin gastar", async () => {
    const { input, listLibrary, videoQuote } = setup();
    const result = await runVideo(input);
    expect(result.state).toBe("waiting_approval");
    expect(result.cents).toBeUndefined();
    expect(result.advance).toBeUndefined();
    expect(result.data).toMatchObject({
      storyboard: STORYBOARD,
      provider: "fal.ai",
      cents: 35,
      mediaSelection: { source: "library", libraryItems: [{ id: "lib1", kind: "photo" }, { id: "clip1", kind: "video" }], generatedFromScratch: false },
    });
    expect(result.text).toBe("Video listo para generar con fal.ai: US$0.35. Apruébalo para empezar.");
    // The same query as the design step, and the photos this piece's design already used may come out again.
    expect(listLibrary).toHaveBeenCalledExactlyOnceWith(
      "Prepara contenido de techos\nTechos\nCuida tu techo\nTres consejos",
      { language: "es", reuse: ["lib1"] },
    );
    expect(videoQuote).toHaveBeenCalledExactlyOnceWith(COPY.script, [media("lib1"), media("clip1", "video")], "es");
  });

  it("sin material adecuado en la biblioteca usa los diseños de marca de la pieza, nunca una imagen nueva", async () => {
    const { input, videoQuote } = setup({ library: [] });
    const result = await runVideo(input);
    const [idea, used] = videoQuote.mock.calls[0];
    expect(idea).toBe(COPY.script);
    expect(used).toEqual([
      expect.objectContaining({ id: "design-0", kind: "photo", url: "https://example.com/s.jpg", width: 1080, height: 1080 }),
      expect.objectContaining({ id: "design-1", url: "https://example.com/t.jpg", height: 1920 }),
      expect.objectContaining({ id: "design-2", url: "https://example.com/w.jpg", width: 1600, height: 900 }),
    ]);
    expect(result.data).toMatchObject({ mediaSelection: { source: "brand_template", libraryItems: [], generatedFromScratch: false } });
  });

  it("en inglés avisa en inglés", async () => {
    const result = await runVideo(setup({ language: "en", cents: 7 }).input);
    expect(result.text).toBe("Video ready to generate with fal.ai: US$0.07. Approve it to start.");
  });

  it("un guion vacío usa el resumen o el titular de la pieza", async () => {
    const { input, videoQuote } = setup({ outputs: { copy: { ...COPY, script: "  " }, design: DESIGN } });
    await runVideo(input);
    expect(videoQuote.mock.calls[0][0]).toBe(COPY.summary);
    const second = setup({ outputs: { copy: { ...COPY, script: "", summary: "" }, design: DESIGN } });
    await runVideo(second.input);
    expect(second.videoQuote.mock.calls[0][0]).toBe(COPY.headline);
  });

  it("una cotización que pasa del máximo se rechaza antes de pedir la aprobación", async () => {
    for (const cents of [51, 400]) {
      await expect(runVideo(setup({ cents }).input)).rejects.toThrow("El video supera el máximo autorizado");
    }
    await expect(runVideo(setup({ cents: 51 }).input)).rejects.toBeInstanceOf(Refusal);
    await expect(runVideo(setup({ cents: 51 }).input)).rejects.toBeInstanceOf(AgentError);
    // Exactly the maximum is allowed.
    expect((await runVideo(setup({ cents: 50 }).input)).state).toBe("waiting_approval");
  });

  it("sin texto de la pieza o sin diseños ni biblioteca se detiene con un mensaje claro y sin cotizar", async () => {
    for (const outputs of [{ design: DESIGN }, { copy: { title: "solo" }, design: DESIGN }]) {
      const s = setup({ outputs });
      await expect(runVideo(s.input)).rejects.toThrow("Falta completar el paso anterior.");
      expect(s.videoQuote).not.toHaveBeenCalled();
    }
    const none = setup({ library: [], outputs: { copy: COPY, design: { assets: [] } } });
    await expect(runVideo(none.input)).rejects.toThrow("No hay fotos");
    expect(none.videoQuote).not.toHaveBeenCalled();
  });

  it("sin fotos ni diseños es un rechazo: nada se gastó ni se escribió, así que la pieza queda bloqueada, no incierta", async () => {
    const none = setup({ library: [], outputs: { copy: COPY, design: { assets: [] } } });
    await expect(runVideo(none.input)).rejects.toBeInstanceOf(Refusal);
    await expect(runVideo(none.input)).rejects.toThrow(
      "No hay fotos ni diseños para armar el video. Los textos están guardados.",
    );
  });

  it("solo hace el paso video", async () => {
    for (const step of ["render", "video_wait", "video-r1", "videos"]) {
      const s = setup({ step });
      await expect(runVideo(s.input)).rejects.toThrow("Agente no disponible.");
      expect(s.use).not.toHaveBeenCalled();
    }
  });

  it("usa solo sus herramientas: nunca empieza un render", async () => {
    const s = setup();
    await runVideo(s.input);
    const names = s.use.mock.calls.map(([n]) => n).sort();
    expect(names).toEqual(["listLibrary", "readStepOutput", "videoQuote"]);
    expect(names).not.toContain("startVideo");
  });
});
