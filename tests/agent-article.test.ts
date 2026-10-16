// El artículo para la web, sin base de datos ni proveedor: el paso `article` del agente de redacción y las herramientas
// `writeArticle` y `publishArticle`. Google, la IA y GitHub son simulacros; la reserva, la aprobación y el cobro con la base real
// están en tests/agent-database.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRun } from "@prisma/client";

const m = vi.hoisted(() => ({
  stepFirst: vi.fn(),
  business: vi.fn(),
  createArticleReport: vi.fn(),
  prepareForSite: vi.fn(),
  approveForSite: vi.fn(),
  sitePhotoApproval: vi.fn(),
  sitePhotoCents: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { agentStep: { findFirst: m.stepFirst }, business: { findUnique: m.business } },
}));
vi.mock("@/lib/seo/writer-run", () => ({ createArticleReport: m.createArticleReport }));
vi.mock("@/lib/seo/site-article-run", () => ({
  prepareForSite: m.prepareForSite,
  approveForSite: m.approveForSite,
  sitePhotoApproval: m.sitePhotoApproval,
  sitePhotoCents: m.sitePhotoCents,
}));

import { AgentError } from "@/lib/agent/access";
import { AGENTS } from "@/lib/agent/agents";
import { runCopy } from "@/lib/agent/agents/copy";
import type { AgentInput } from "@/lib/agent/agents/types";
import { articleCharge } from "@/lib/agent/article-cost";
import type { Piece } from "@/lib/agent/plan";
import { toolsFor, type Tools } from "@/lib/agent/tools";
import { bi } from "@/lib/i18n";
import { approveCostCents, type SitePhoto } from "@/lib/seo/site-article";
import { context } from "./fixtures/agent-context";

const PIECE: Piece = {
  id: "p4",
  topic: "Reparación de techos en Miami",
  objective: "",
  channels: ["seo"],
  format: "articulo",
  keyword: "reparación de techos",
};
const MADE = { id: "rep1", score: 82, cost: 0.002, pagesRead: 4, provider: "gemini" };
const run = { id: "piece1", businessId: "b1", prompt: "Prepara contenido de techos" } as unknown as AgentRun;

function setup(over: { step?: string; piece?: unknown; writeArticle?: ReturnType<typeof vi.fn>; language?: "es" | "en" } = {}) {
  const piece = over.piece === undefined ? PIECE : over.piece;
  const ctx = context({ piece });
  const writeArticle = over.writeArticle ?? vi.fn().mockResolvedValue(MADE);
  const use = vi.fn((name: string) => {
    if (name === "writeArticle") return writeArticle;
    throw new AgentError(`La herramienta ${name} no está permitida.`);
  });
  const id = over.step ?? "article";
  const input: AgentInput = {
    run: { ...run, context: ctx } as unknown as AgentRun,
    step: { id, agent: "copy", attempt: id === "article" ? 0 : 1 },
    context: ctx,
    language: over.language ?? "es",
    model: null,
    tools: { use } as unknown as Tools,
  };
  return { input, use, writeArticle };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.stepFirst.mockResolvedValue({ reservedCents: 5 });
  m.business.mockResolvedValue({ seoLanguage: "es" });
});

describe("el paso article del agente de redacción", () => {
  it("escribe un borrador con la búsqueda de la pieza, sin modelo, y deja el id del reporte", async () => {
    const { input, use, writeArticle } = setup();
    const result = await runCopy(input);
    expect(writeArticle).toHaveBeenCalledExactlyOnceWith("reparación de techos");
    expect(use.mock.calls.map(([n]) => n)).toEqual(["writeArticle"]);
    expect(result.data).toEqual({ reportId: "rep1" });
    expect(result.state).toBeUndefined();
    expect(result.text).toBe("Escribí el artículo «reparación de techos»: sacó 82/100. Costo de Google: US$0.002. Ahora pasa a la revisión editorial.");
    // Scoped to the run's business when it reads its own reservation.
    expect(m.stepFirst).toHaveBeenCalledExactlyOnceWith({
      where: { runId: "piece1", run: { businessId: "b1" }, name: "article" },
      select: { reservedCents: true },
    });
  });

  it("sin palabra clave escribe con el tema de la pieza; la vuelta de corrección es otro borrador igual", async () => {
    const { input, writeArticle } = setup({ piece: { ...PIECE, keyword: "" }, step: "article-r1" });
    await runCopy(input);
    expect(writeArticle).toHaveBeenCalledExactlyOnceWith("Reparación de techos en Miami");
    expect(m.stepFirst.mock.calls[0][0].where.name).toBe("article-r1");
  });

  it("cobra a Google lo que cobró y a la IA lo que se le anunció al dueño, nunca más de lo que el paso reservó", async () => {
    const run1 = await runCopy(setup().input);
    expect(run1.cents).toBe(articleCharge(0.002, "gemini", 5));
    expect(run1.cents).toBe(5);
    // A smaller reservation caps the charge (finishStep would otherwise block the work and turn MATYA off).
    m.stepFirst.mockResolvedValue({ reservedCents: 2 });
    expect((await runCopy(setup().input)).cents).toBe(2);
    // No reservation found: nothing is charged beyond zero.
    m.stepFirst.mockResolvedValue(null);
    expect((await runCopy(setup().input)).cents).toBe(0);
  });

  it("si el escritor falla, el error sigue su camino y no se cobra nada desde aquí", async () => {
    const writeArticle = vi.fn().mockRejectedValue(new AgentError("Falta conectar DataForSEO."));
    await expect(runCopy(setup({ writeArticle }).input)).rejects.toThrow("Falta conectar DataForSEO.");
    expect(m.stepFirst).not.toHaveBeenCalled();
  });

  it("solo escribe artículos para una pieza de artículo con un plan válido", async () => {
    for (const piece of [{ ...PIECE, format: "post" }, null, { id: "x" }]) {
      const { input, writeArticle } = setup({ piece });
      await expect(runCopy(input)).rejects.toThrow(/La pieza no tiene un plan válido\.|Agente no disponible\./);
      expect(writeArticle).not.toHaveBeenCalled();
    }
    // The publication is not a writing step.
    const publish = setup({ step: "article_publish" });
    await expect(runCopy(publish.input)).rejects.toThrow("Agente no disponible.");
    expect(publish.use).not.toHaveBeenCalled();
  });

  it("el agente de redacción sigue usando modelo para el texto de sus piezas", () => {
    expect(AGENTS.copy.usesModel).toBe(true);
    expect(AGENTS.copy.tools).toContain("writeArticle");
  });
});

describe("la herramienta writeArticle", () => {
  const tool = () => toolsFor({ key: "copy", tools: ["writeArticle"] }, run).use("writeArticle");

  it("escribe en el idioma en que buscan los clientes del negocio, o en el que se le pida", async () => {
    m.createArticleReport.mockResolvedValue(MADE);
    expect(await tool()("reparación de techos")).toBe(MADE);
    expect(m.createArticleReport).toHaveBeenLastCalledWith("b1", "reparación de techos", "es");
    m.business.mockResolvedValue({ seoLanguage: "en" });
    await tool()("roof repair");
    expect(m.createArticleReport).toHaveBeenLastCalledWith("b1", "roof repair", "en");
    expect(m.business).toHaveBeenLastCalledWith({ where: { id: "b1" }, select: { seoLanguage: true } });
    await tool()("roof repair", "es");
    expect(m.createArticleReport).toHaveBeenLastCalledWith("b1", "roof repair", "es");
    m.business.mockResolvedValue(null);
    await tool()("x y");
    expect(m.createArticleReport).toHaveBeenLastCalledWith("b1", "x y", "es");
  });

  it("lo que dice el escritor (en los dos idiomas) llega como un AgentError en español; los demás errores no cambian", async () => {
    m.createArticleReport.mockRejectedValue(bi("Falta conectar DataForSEO.", "DataForSEO isn't connected."));
    const e = await tool()("x y").catch((error: unknown) => error);
    expect(e).toBeInstanceOf(AgentError);
    expect((e as Error).message).toBe("Falta conectar DataForSEO.");
    const boom = new Error("red caída");
    m.createArticleReport.mockRejectedValue(boom);
    await expect(tool()("x y")).rejects.toBe(boom);
  });
});

describe("la herramienta publishArticle", () => {
  const tool = () => toolsFor({ key: "matya", tools: ["publishArticle"] }, run).use("publishArticle");
  const library: SitePhoto = { kind: "library", itemId: "i1", url: "https://example.com/p.jpg", thumb: "https://example.com/p.jpg", label: "Techo" };
  const generate: SitePhoto = { kind: "generate", idea: "A roof" };
  const generated: SitePhoto = { kind: "generated", url: "https://example.com/g.jpg", idea: "A roof", costCents: 4 };
  const current: SitePhoto = { kind: "current", url: "https://mio.com/p.jpg" };
  const stock: SitePhoto = { kind: "stock" };
  const prepared = (photo: SitePhoto) => ({ photo, es: { title: "Reparación" }, en: { title: "Repair" }, urlEs: "https://mio.com/es/x", urlEn: "https://mio.com/en/x" });
  const out = { url: "https://mio.com/es/x", urlEn: "https://mio.com/en/x", costCents: 1, photoFailed: false, already: false, extra: "no sale" };

  beforeEach(() => {
    m.approveForSite.mockResolvedValue(out);
    m.sitePhotoCents.mockResolvedValue(4);
  });

  it("una foto sin costo extra se autoriza de una vez, por exactamente approveCostCents(foto, 0)", async () => {
    for (const photo of [library, current, stock]) {
      m.prepareForSite.mockResolvedValue(prepared(photo));
      m.approveForSite.mockClear();
      expect(await tool()("rep1")).toEqual({
        published: true,
        url: out.url,
        urlEn: out.urlEn,
        costCents: 1,
        photoFailed: false,
        already: false,
      });
      expect(m.prepareForSite).toHaveBeenLastCalledWith("b1", "rep1");
      expect(m.approveForSite).toHaveBeenCalledExactlyOnceWith("b1", "rep1", approveCostCents(photo, 0));
      expect(approveCostCents(photo, 0)).toBe(0);
    }
    expect(m.sitePhotoApproval).not.toHaveBeenCalled();
  });

  it("una foto que la IA tiene que crear (o ya creó) espera: no se autoriza ni se genera nada, y se dice cuánto costaría", async () => {
    m.prepareForSite.mockResolvedValue(prepared(generate));
    expect(await tool()("rep1")).toEqual({
      published: false,
      photo: "generate",
      photoCents: 4,
      title: "Reparación",
      urlEs: "https://mio.com/es/x",
      urlEn: "https://mio.com/en/x",
    });
    m.prepareForSite.mockResolvedValue(prepared(generated));
    expect(await tool()("rep1")).toMatchObject({ published: false, photo: "generated", photoCents: 0 });
    expect(m.approveForSite).not.toHaveBeenCalled();
  });

  it("con la aprobación del dueño autoriza la vista previa guardada al precio que tiene ahora, sin prepararla otra vez", async () => {
    m.sitePhotoApproval.mockResolvedValue({ photo: generate, cents: 4 });
    expect(await tool()("rep1", { approved: true })).toMatchObject({ published: true, url: out.url });
    expect(m.sitePhotoApproval).toHaveBeenCalledExactlyOnceWith("b1", "rep1");
    expect(m.approveForSite).toHaveBeenCalledExactlyOnceWith("b1", "rep1", 4);
    expect(m.prepareForSite).not.toHaveBeenCalled();
  });

  it("lo que dice la web (en los dos idiomas) llega como un AgentError en español", async () => {
    m.prepareForSite.mockRejectedValue(bi("Tu web no está conectada.", "Your website isn't connected."));
    const e = await tool()("rep1").catch((error: unknown) => error);
    expect(e).toBeInstanceOf(AgentError);
    expect((e as Error).message).toBe("Tu web no está conectada.");
    expect(m.approveForSite).not.toHaveBeenCalled();
    m.approveForSite.mockRejectedValue(bi("El costo cambió.", "The cost changed."));
    m.sitePhotoApproval.mockResolvedValue({ photo: generate, cents: 4 });
    await expect(tool()("rep1", { approved: true })).rejects.toThrow("El costo cambió.");
  });

  it("ningún agente con modelo tiene la herramienta que publica", () => {
    for (const a of Object.values(AGENTS)) expect(a.tools).not.toContain("publishArticle");
  });
});
