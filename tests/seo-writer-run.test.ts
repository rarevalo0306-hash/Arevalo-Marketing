// El núcleo de «Escribir un artículo» (createArticleReport) y la acción del escritor que lo llama: los mensajes de siempre.
// Sin base de datos, Google ni IA: todo es de mentira. La parte pura del escritor está en tests/seo-writer.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findBusiness: vi.fn(),
  create: vi.fn(),
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  hasBusiness: vi.fn(),
  lang: { current: "es" as "es" | "en" },
}));
vi.mock("@/lib/db", () => ({
  db: {
    business: { findUnique: m.findBusiness },
    seoReport: { create: m.create, findMany: m.findMany, deleteMany: m.deleteMany },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  hasBusiness: m.hasBusiness,
  deniedText: vi.fn().mockResolvedValue("Sin permiso."),
}));
vi.mock("@/lib/i18n-server", () => ({
  getT: async () => ({
    lang: m.lang.current,
    t: (es: string, en: string) => (m.lang.current === "en" ? en : es),
  }),
}));
vi.mock("@/lib/ai", async (original) => ({
  ...(await original<typeof import("@/lib/ai")>()),
  aiEnabled: vi.fn(),
  pickText: vi.fn(),
  writeSeoArticle: vi.fn(),
}));
vi.mock("@/lib/seo/dataforseo", async (original) => ({
  ...(await original<typeof import("@/lib/seo/dataforseo")>()),
  dataForSeoEnabled: vi.fn(),
}));
vi.mock("@/lib/seo/writer", async (original) => ({
  ...(await original<typeof import("@/lib/seo/writer")>()),
  researchKeyword: vi.fn(),
}));

import { aiEnabled, pickText, writeSeoArticle } from "@/lib/ai";
import { BiError } from "@/lib/i18n";
import { writeArticle } from "@/app/actions-seo-writer";
import { dataForSeoEnabled } from "@/lib/seo/dataforseo";
import { MAX_ARTICLES, readArticleReport, researchKeyword, type KeywordResearch } from "@/lib/seo/writer";
import { articleSetup, createArticleReport } from "@/lib/seo/writer-run";

const BUSINESS = {
  name: "Techos Miami",
  website: "https://mio.com",
  phone: "305-555-0100",
  aiProfile: "Reparamos techos.",
  aiText: "",
  brandVoice: "",
  study: null,
  seoLocations: null,
  seoLocationCode: 1015116,
  seoLocationName: "Miami,Florida,United States",
};
const research = (over: Partial<KeywordResearch> = {}): KeywordResearch => ({
  keyword: "reparación de techos",
  language: "es",
  location: "Miami,Florida,United States",
  locationCode: 1015116,
  organic: [
    { position: 1, title: "Reparación de techos en Miami", url: "https://techosperez.com/r", domain: "techosperez.com", description: "Reparación de techos." },
  ],
  questions: ["¿Cuánto cuesta reparar un techo?"],
  related: [],
  localPack: false,
  aiOverview: false,
  featuredSnippet: false,
  pages: [
    { position: 1, url: "https://techosperez.com/r", domain: "techosperez.com", title: "t", h1: "h", headings: [], words: 1200 },
    { position: 2, url: "https://x.com/r", domain: "x.com", title: "t", h1: "", headings: [], words: 0, error: "timeout" },
  ],
  cost: 0.002,
  ...over,
});
const DRAFT = {
  title: "Reparación de techos en Miami: guía",
  metaDescription: "Guía de reparación de techos en Miami.",
  slug: "reparacion-de-techos-en-miami",
  h1: "Reparación de techos en Miami",
  outline: ["Señales"],
  markdown: "La reparación de techos en Miami importa mucho. ".repeat(30),
  socialPost: "Lee la guía.",
};

beforeEach(() => {
  vi.clearAllMocks();
  m.lang.current = "es";
  m.hasBusiness.mockResolvedValue(true);
  m.findBusiness.mockResolvedValue(BUSINESS);
  m.create.mockImplementation(async ({ data }: { data: { kind: string; data: unknown } }) => ({ id: "rep1", ...data }));
  m.findMany.mockResolvedValue([]);
  vi.mocked(dataForSeoEnabled).mockReturnValue(true);
  vi.mocked(aiEnabled).mockReturnValue(true);
  vi.mocked(pickText).mockReturnValue("gemini");
  vi.mocked(researchKeyword).mockResolvedValue(research());
  vi.mocked(writeSeoArticle).mockResolvedValue(DRAFT);
});

const form = (keyword: string, language = "es") => {
  const f = new FormData();
  f.set("keyword", keyword);
  f.set("language", language);
  return f;
};
const bi = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (error: unknown) => error,
  );
  expect(e).toBeInstanceOf(BiError);
  return e as BiError;
};

describe("createArticleReport", () => {
  it("mira Google, la IA escribe, se puntúa y se guarda como reporte «article»; devuelve el id, el puntaje y lo que costó", async () => {
    const made = await createArticleReport("b1", "  Reparación de TECHOS!! ", "es");
    expect(made).toMatchObject({ id: "rep1", cost: 0.002, pagesRead: 1, provider: "gemini" });
    expect(made.score).toBeGreaterThanOrEqual(0);
    expect(made.score).toBeLessThanOrEqual(100);
    // The keyword is cleaned like the writer's form does, and the research uses the business's main Google area.
    expect(researchKeyword).toHaveBeenCalledExactlyOnceWith("reparación de techos", { code: 1015116, name: "Miami,Florida,United States" }, "es");
    expect(m.findBusiness).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "b1" } }));
    expect(m.create).toHaveBeenCalledTimes(1);
    const saved = m.create.mock.calls[0][0].data as { businessId: string; kind: string; data: Record<string, unknown> };
    expect(saved).toMatchObject({ businessId: "b1", kind: "article" });
    expect(saved.data).toMatchObject({ version: 1, keyword: "reparación de techos", language: "es", cost: 0.002, provider: "gemini", score: made.score });
    // What was saved reads back as an article.
    expect(readArticleReport(saved.data)).toMatchObject({ keyword: "reparación de techos", draft: { title: DRAFT.title } });
  });

  it("las notas del dueño llegan a la IA solo cuando las hay; sin ellas la llamada es la de siempre", async () => {
    await createArticleReport("b1", "reparación de techos", "es");
    expect(vi.mocked(writeSeoArticle).mock.calls[0][0]).not.toHaveProperty("notes");
    await createArticleReport("b1", "reparación de techos", "es", []);
    expect(vi.mocked(writeSeoArticle).mock.calls[1][0]).not.toHaveProperty("notes");
    await createArticleReport("b1", "reparación de techos", "es", ["Menciona el seguro de inundación"]);
    expect(vi.mocked(writeSeoArticle).mock.calls[2][0]).toMatchObject({ keyword: "reparación de techos", language: "es", notes: ["Menciona el seguro de inundación"] });
  });

  it("deja solo los últimos artículos del negocio", async () => {
    m.findMany.mockResolvedValue([{ id: "old1" }, { id: "old2" }]);
    await createArticleReport("b1", "reparación de techos", "es");
    expect(m.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: "b1", kind: "article" }, skip: MAX_ARTICLES }),
    );
    expect(m.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["old1", "old2"] } } });
  });

  it("lo que falta se avisa en los dos idiomas y antes de gastar nada", async () => {
    const none = async (run: () => Promise<unknown>, es: string, en: string) => {
      const e = await bi(run());
      expect([e.message, e.en]).toEqual([es, en]);
      expect(researchKeyword).not.toHaveBeenCalled();
      expect(writeSeoArticle).not.toHaveBeenCalled();
      expect(m.create).not.toHaveBeenCalled();
    };
    await none(() => createArticleReport("b1", "a", "es"), "Escribe la búsqueda para la que quieres salir en Google.", "Enter the search you want to show up for on Google.");
    vi.mocked(dataForSeoEnabled).mockReturnValue(false);
    await none(
      () => createArticleReport("b1", "reparación de techos", "es"),
      "Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).",
      "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).",
    );
    vi.mocked(dataForSeoEnabled).mockReturnValue(true);
    vi.mocked(aiEnabled).mockReturnValue(false);
    await none(
      () => createArticleReport("b1", "reparación de techos", "es"),
      "Falta la clave de la IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en Vercel.",
      "The AI key (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY) is missing in Vercel.",
    );
    vi.mocked(aiEnabled).mockReturnValue(true);
    m.findBusiness.mockResolvedValue(null);
    await none(() => createArticleReport("b1", "reparación de techos", "es"), "Negocio no encontrado.", "Business not found.");
    m.findBusiness.mockResolvedValue({ ...BUSINESS, seoLocationCode: null });
    await none(
      () => createArticleReport("b1", "reparación de techos", "es"),
      "Primero elige tu zona de Google en SEO y visibilidad, pestaña «⚙ Ajustes», y guarda.",
      "First pick your Google area in SEO and visibility, “⚙ Settings” tab, and save.",
    );
  });

  it("si Google no devuelve resultados no escribe ni guarda nada", async () => {
    vi.mocked(researchKeyword).mockResolvedValue(research({ organic: [] }));
    const e = await bi(createArticleReport("b1", "reparación de techos", "es"));
    expect(e.message).toBe("Google no devolvió resultados para esa búsqueda en tu zona. Prueba con otras palabras.");
    expect(e.en).toBe("Google returned no results for that search in your area. Try other words.");
    expect(writeSeoArticle).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("articleSetup comprueba todo sin gastar y devuelve la búsqueda limpia, el negocio y su zona", async () => {
    const setup = await articleSetup("b1", "Reparación de TECHOS");
    expect(setup.keyword).toBe("reparación de techos");
    expect(setup.zone).toEqual({ code: 1015116, name: "Miami,Florida,United States" });
    expect(setup.business.aiText).toBe("");
    expect(researchKeyword).not.toHaveBeenCalled();
  });
});

describe("la acción writeArticle no cambia", () => {
  it("sin permiso, el mensaje de siempre y no hace nada", async () => {
    m.hasBusiness.mockResolvedValue(false);
    expect(await writeArticle("b1", null, form("reparación de techos"))).toEqual({ ok: false, message: "Sin permiso." });
    expect(researchKeyword).not.toHaveBeenCalled();
  });

  it("un artículo bien hecho: el mensaje con el puntaje, las páginas leídas y el costo, en español y en inglés", async () => {
    const es = await writeArticle("b1", null, form("reparación de techos"));
    expect(es).toMatchObject({ ok: true, id: "rep1" });
    expect(es?.message).toMatch(/^Listo: tu artículo sacó \d+\/100\. Leímos 1 página de los que ganan\. Costo de DataForSEO: \$0\.002\.$/);
    m.lang.current = "en";
    const en = await writeArticle("b1", null, form("reparación de techos", "en"));
    expect(en?.message).toMatch(/^Done: your article scored \d+\/100\. We read 1 winning page\. DataForSEO cost: \$0\.002\.$/);
    expect(researchKeyword).toHaveBeenLastCalledWith("reparación de techos", expect.anything(), "en");
  });

  it("lo que falta o sale mal se devuelve como mensaje en el idioma de la app, nunca como error", async () => {
    expect(await writeArticle("b1", null, form("a"))).toEqual({
      ok: false,
      message: "Escribe la búsqueda para la que quieres salir en Google.",
    });
    vi.mocked(dataForSeoEnabled).mockReturnValue(false);
    m.lang.current = "en";
    expect(await writeArticle("b1", null, form("reparación de techos"))).toEqual({
      ok: false,
      message: "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).",
    });
    vi.mocked(dataForSeoEnabled).mockReturnValue(true);
    m.lang.current = "es";
    vi.mocked(researchKeyword).mockResolvedValue(research({ organic: [] }));
    expect(await writeArticle("b1", null, form("reparación de techos"))).toEqual({
      ok: false,
      message: "Google no devolvió resultados para esa búsqueda en tu zona. Prueba con otras palabras.",
    });
    vi.mocked(researchKeyword).mockRejectedValue(new Error("se cayó la red"));
    expect(await writeArticle("b1", null, form("reparación de techos"))).toEqual({ ok: false, message: "se cayó la red" });
    expect(m.create).not.toHaveBeenCalled();
  });
});
