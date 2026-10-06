import { describe, expect, it } from "vitest";
import {
  type ArticleDraft,
  articleHtml,
  articleMarkdown,
  CHECK_WEIGHTS,
  cleanDraft,
  type CompetitorPage,
  contentTargets,
  type ContentTargets,
  extractHeadings,
  hasKeyword,
  inlineHtml,
  type KeywordResearch,
  mainWords,
  markdownToHtml,
  pagesToRead,
  parseWriterSerp,
  readability,
  readArticleReport,
  scoreDraft,
  slugify,
  targetUsage,
} from "@/lib/seo/writer";

const KEYWORD = "reparación de techos en miami";

const page = (position: number, domain: string, words: number, headings: string[], extra: Partial<CompetitorPage> = {}): CompetitorPage => ({
  position,
  url: `https://${domain}/reparacion-techos`,
  domain,
  title: `Reparación de techos en Miami | ${domain}`,
  h1: "Reparación de techos en Miami",
  headings: headings.map((text) => ({ level: 2 as const, text })),
  words,
  ...extra,
});

const research: KeywordResearch = {
  keyword: KEYWORD,
  language: "es",
  location: "Miami,Florida,United States",
  locationCode: 1015116,
  organic: [
    { position: 1, title: "Reparación de techos en Miami - Techos Pérez", url: "https://techosperez.com/reparacion", domain: "techosperez.com", description: "Reparación de techos de tejas y techos planos en Miami. Inspección gratis y estimado." },
    { position: 2, title: "Roof Repair Miami | Reparación de goteras", url: "https://miamiroof.com/es", domain: "miamiroof.com", description: "Reparamos goteras, tejas rotas y daños por huracán. Inspección del techo." },
    { position: 3, title: "Reparación de techos - Yelp", url: "https://www.yelp.com/search?x=1", domain: "yelp.com", description: "Los 10 mejores techadores en Miami." },
    { position: 4, title: "Cuánto cuesta reparar un techo en Miami", url: "https://blogcasa.com/costo-techo", domain: "blogcasa.com", description: "Costo de reparación de techos de tejas, daños por huracán y goteras." },
  ],
  questions: ["¿Cuánto cuesta reparar un techo en Miami?", "¿Cuánto dura un techo de tejas?", "¿El seguro cubre la reparación del techo?", "¿Cómo saber si mi techo tiene goteras?"],
  related: ["reparación de goteras miami", "techos de tejas miami", "daños por huracán techo"],
  localPack: true,
  aiOverview: false,
  featuredSnippet: false,
  pages: [
    page(1, "techosperez.com", 1400, ["Señales de que tu techo necesita reparación", "Reparación de goteras", "Daños por huracán", "Inspección del techo gratis", "Preguntas frecuentes"]),
    page(2, "miamiroof.com", 900, ["Reparación de goteras en Miami", "Techos de tejas y techos planos", "Daños por huracán y el seguro", "Contáctanos"]),
    page(4, "blogcasa.com", 1800, ["Costo de reparación de techos", "Señales de daño en el techo", "Inspección después de un huracán", "¿El seguro paga el techo?"]),
    page(5, "roto.com", 0, [], { error: "timeout" }),
  ],
  cost: 0.002,
};

const goodDraft: ArticleDraft = {
  title: "Reparación de techos en Miami: guía completa",
  metaDescription: "Reparación de techos en Miami: señales de daño, goteras, daños por huracán y cuándo llamar a un experto. Pide tu inspección del techo hoy mismo.",
  slug: "reparacion-de-techos-en-miami",
  h1: "Reparación de techos en Miami: lo que debes saber",
  outline: [],
  markdown: "",
  socialPost: "¿Goteras? Lee nuestra guía.",
};

/** Un artículo de unas 1.400 palabras con todo lo que piden las metas. */
function goodMarkdown(): string {
  const filler = "Un techo bien cuidado protege tu casa y tu familia. Revisa las tejas después de cada tormenta fuerte. Si ves manchas en el techo interior, actúa rápido.";
  const para = (n: number) => Array.from({ length: n }, () => filler).join(" ");
  const section = () => `${para(3)}\n\n${para(3)}`;
  return [
    `La **reparación de techos en Miami** es clave por el clima, las lluvias y los huracanes. ${filler}`,
    "",
    "## Señales de que tu techo necesita reparación",
    section(),
    "",
    "## Reparación de goteras y techos de tejas en Miami",
    section(),
    "- Tejas rotas o sueltas",
    "- Manchas de humedad",
    "",
    "## Daños por huracán y el seguro",
    section(),
    "",
    "## Inspección del techo",
    section(),
    "",
    "## Costo de la reparación de techos en Miami",
    section(),
    "",
    "## Preguntas frecuentes",
    "### ¿Cuánto cuesta reparar un techo en Miami?",
    para(4),
    "### ¿Cuánto dura un techo de tejas?",
    para(4),
    "### ¿El seguro cubre la reparación del techo?",
    para(4),
    "### ¿Cómo saber si mi techo tiene goteras?",
    para(4),
    "",
    "## Habla con nosotros",
    "Llámanos al (305) 555-0123 o escríbenos en techosperez.com para agendar tu inspección.",
  ].join("\n");
}

describe("hasKeyword", () => {
  it("acepta acentos, mayúsculas, plurales y otro orden", () => {
    expect(hasKeyword("Reparacion de TECHO en Miami", KEYWORD)).toBe(true);
    expect(hasKeyword("Miami: reparación de techos", KEYWORD)).toBe(true);
    expect(hasKeyword("Techos en Miami", KEYWORD)).toBe(false);
  });
});

describe("parseWriterSerp", () => {
  it("lee resultados, preguntas, búsquedas relacionadas y lo que muestra Google", () => {
    const r = parseWriterSerp({
      item_types: ["local_pack", "organic", "people_also_ask", "related_searches", "ai_overview"],
      items: [
        { type: "local_pack", title: "Techos Pérez" },
        { type: "organic", rank_group: 2, title: "B", url: "https://b.com/x", domain: "www.b.com", description: "desc b" },
        { type: "organic", rank_group: 1, title: "A", url: "https://a.com/", domain: "a.com" },
        { type: "organic", rank_group: 3, title: "Sin URL" },
        { type: "people_also_ask", items: [{ type: "people_also_ask_element", title: "¿Cuánto cuesta?" }, { title: "¿Cuánto cuesta?" }, { title: "¿Qué incluye?" }] },
        { type: "related_searches", items: ["techos miami", "goteras miami"] },
        { type: "people_also_search", items: ["techos baratos"] },
      ],
    });
    expect(r.organic.map((o) => o.title)).toEqual(["A", "B"]);
    expect(r.organic[1].domain).toBe("b.com");
    expect(r.questions).toEqual(["¿Cuánto cuesta?", "¿Qué incluye?"]);
    expect(r.related).toEqual(["techos miami", "goteras miami", "techos baratos"]);
    expect(r.localPack).toBe(true);
    expect(r.aiOverview).toBe(true);
    expect(r.featuredSnippet).toBe(false);
  });

  it("no se rompe con respuestas vacías o raras", () => {
    expect(parseWriterSerp(null).organic).toEqual([]);
    expect(parseWriterSerp({ items: "x" as unknown }).questions).toEqual([]);
  });
});

describe("pagesToRead", () => {
  it("salta directorios, redes, archivos, direcciones privadas y sitios repetidos", () => {
    const list = pagesToRead([
      { position: 1, title: "", url: "https://www.yelp.com/biz/x", domain: "yelp.com", description: "" },
      { position: 2, title: "", url: "https://m.facebook.com/x", domain: "m.facebook.com", description: "" },
      { position: 3, title: "", url: "https://a.com/guia", domain: "a.com", description: "" },
      { position: 4, title: "", url: "https://www.a.com/otra", domain: "a.com", description: "" },
      { position: 5, title: "", url: "https://b.com/guia.pdf", domain: "b.com", description: "" },
      { position: 6, title: "", url: "http://192.168.0.1/", domain: "192.168.0.1", description: "" },
      { position: 7, title: "", url: "https://maps.google.com/x", domain: "maps.google.com", description: "" },
      { position: 8, title: "", url: "https://c.com/", domain: "c.com", description: "" },
    ]);
    expect(list.map((p) => p.position)).toEqual([3, 8]);
  });
});

describe("extractHeadings y mainWords", () => {
  const html = `<html><body><nav><h2>Menú</h2></nav><main><h1>Título</h1><h2>Señales de daño</h2><p>${"palabra ".repeat(300)}</p>
    <h3>Goteras &amp; humedad</h3><h2>Compartir</h2><script>var h2 = "<h2>x</h2>";</script></main><footer><h2>Contáctanos</h2><p>${"pie ".repeat(500)}</p></footer></body></html>`;
  it("lee los subtítulos del contenido, sin menú, pie ni basura", () => {
    expect(extractHeadings(html)).toEqual([
      { level: 2, text: "Señales de daño" },
      { level: 3, text: "Goteras & humedad" },
    ]);
  });
  it("cuenta las palabras del contenido principal", () => {
    const n = mainWords(html, 9999);
    expect(n).toBeGreaterThan(300);
    expect(n).toBeLessThan(320);
    expect(mainWords("<body><p>corto</p></body>", 42)).toBe(42);
  });
});

describe("contentTargets", () => {
  const targets = contentTargets(research);

  it("recomienda el largo con la mediana de las páginas leídas", () => {
    expect(targets.competitorWords).toEqual([1400, 900, 1800]);
    expect(targets.wordCount).toBe(1400);
  });

  it("limita el largo entre 600 y 2500 y usa 1000 si no se leyó nada", () => {
    const short = contentTargets({ ...research, pages: [page(1, "a.com", 250, []), page(2, "b.com", 300, [])] });
    expect(short.wordCount).toBe(600);
    const long = contentTargets({ ...research, pages: [page(1, "a.com", 5000, []), page(2, "b.com", 4000, [])] });
    expect(long.wordCount).toBe(2500);
    expect(contentTargets({ ...research, pages: [] }).wordCount).toBe(1000);
  });

  it("encuentra los temas que se repiten en varias páginas", () => {
    const texts = targets.headings.map((h) => h.text.toLowerCase());
    expect(texts.some((t) => t.includes("huracán"))).toBe(true);
    expect(texts.some((t) => t.includes("goteras"))).toBe(true);
    expect(texts.some((t) => t.includes("señales"))).toBe(true);
    const hurricane = targets.headings.find((h) => h.text.toLowerCase().includes("huracán"));
    expect(hurricane!.pages).toBeGreaterThanOrEqual(2);
    // Sin repetir el mismo tema dos veces.
    expect(texts.filter((t) => t.startsWith("daños por huracán")).length).toBeLessThanOrEqual(1);
  });

  it("usa las preguntas de Google", () => {
    expect(targets.questions).toEqual(research.questions);
  });

  it("si Google no trae preguntas, usa subtítulos que son preguntas", () => {
    const t = contentTargets({ ...research, questions: [] });
    expect(t.questions).toContain("¿El seguro paga el techo?");
  });

  it("saca palabras relacionadas sin palabras vacías ni la palabra clave", () => {
    expect(targets.terms.length).toBeGreaterThan(2);
    const all = targets.terms.join(" | ");
    expect(all).toMatch(/goteras/);
    expect(all).toMatch(/huracán/);
    for (const term of targets.terms) {
      expect(term).not.toMatch(/^(de|en|el|la|los|the|and|com)$/);
      expect(["techos", "miami", "reparación"]).not.toContain(term);
    }
  });
});

describe("scoreDraft", () => {
  const targets: ContentTargets = contentTargets(research);
  const business = { phone: "(305) 555-0123", website: "https://www.techosperez.com" };

  it("los pesos suman 100", () => {
    expect(Object.values(CHECK_WEIGHTS).reduce((s, n) => s + n, 0)).toBe(100);
  });

  it("un buen artículo saca un puntaje alto", () => {
    const draft = { ...goodDraft, markdown: goodMarkdown() };
    const { score, checklist } = scoreDraft(draft, KEYWORD, targets, business);
    const failing = checklist.filter((c) => !c.ok).map((c) => c.id);
    expect(failing).toEqual([]);
    expect(score).toBe(100);
    expect(checklist.every((c) => c.es && c.en)).toBe(true);
  });

  it("un borrador flojo pierde puntos y dice qué falta", () => {
    const draft: ArticleDraft = {
      ...goodDraft,
      title: "Todo lo que necesitas saber sobre el cuidado de tu casa en esta temporada de lluvias",
      metaDescription: "Consejos.",
      h1: "Consejos para tu casa",
      markdown: `Hoy hablamos de ${"muchas cosas importantes que tienen que ver con la casa y que todo propietario debería conocer muy bien antes de la temporada ".repeat(4)}.\n\n## Consejos\nRevisa todo.`,
    };
    const { score, checklist } = scoreDraft(draft, KEYWORD, targets, business);
    const failing = new Set(checklist.filter((c) => !c.ok).map((c) => c.id));
    for (const id of ["title-keyword", "title-length", "h1-keyword", "intro-keyword", "h2-keyword", "meta", "length", "questions", "cta", "sentences"] as const) {
      expect(failing.has(id)).toBe(true);
    }
    expect(score).toBeLessThan(30);
    const title = checklist.find((c) => c.id === "title-length")!;
    expect(title.es).toMatch(/60/);
    expect(title.en).toMatch(/60/);
  });

  it("da medio puntaje a la llamada a la acción sin el teléfono ni la página", () => {
    const draft = { ...goodDraft, markdown: goodMarkdown().replace("Llámanos al (305) 555-0123 o escríbenos en techosperez.com", "Llámanos hoy") };
    const cta = scoreDraft(draft, KEYWORD, targets, business).checklist.find((c) => c.id === "cta")!;
    expect(cta.ok).toBe(false);
    expect(cta.points).toBe(4);
    // Si el negocio no tiene teléfono ni página, basta con invitar a contactar.
    expect(scoreDraft(draft, KEYWORD, targets, {}).checklist.find((c) => c.id === "cta")!.ok).toBe(true);
  });

  it("sin preguntas ni términos en las metas, esos puntos no se pierden", () => {
    const empty = { ...targets, questions: [], terms: [] };
    const { checklist } = scoreDraft({ ...goodDraft, markdown: goodMarkdown() }, KEYWORD, empty, business);
    expect(checklist.find((c) => c.id === "questions")!.ok).toBe(true);
    expect(checklist.find((c) => c.id === "terms")!.ok).toBe(true);
  });

  it("marca qué temas, preguntas y términos usa el borrador", () => {
    const u = targetUsage({ ...goodDraft, markdown: goodMarkdown() }, targets);
    expect(u.questions.every(Boolean)).toBe(true);
    expect(u.headings.filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(u.terms.length).toBe(targets.terms.length);
  });
});

describe("readability", () => {
  it("mide oraciones y párrafos", () => {
    const r = readability("Una dos tres. Cuatro cinco seis siete.\n\n- Punto uno\n\nOtro párrafo aquí.");
    expect(r.sentences).toBe(4);
    expect(r.avgSentence).toBe(3);
    expect(r.longestParagraph).toBe(7);
  });
});

describe("markdownToHtml", () => {
  it("convierte títulos, párrafos, listas, negritas, cursivas y enlaces", () => {
    const html = markdownToHtml("## Título\n\nTexto con **negrita** y *cursiva*.\nSigue el párrafo.\n\n- uno\n- [dos](https://ejemplo.com/a?b=1&c=2)\n\n1. primero\n2. segundo\n\n---");
    expect(html).toBe(
      [
        "<h2>Título</h2>",
        "<p>Texto con <strong>negrita</strong> y <em>cursiva</em>. Sigue el párrafo.</p>",
        '<ul><li>uno</li><li><a href="https://ejemplo.com/a?b=1&amp;c=2" rel="noopener noreferrer nofollow" target="_blank">dos</a></li></ul>',
        "<ol><li>primero</li><li>segundo</li></ol>",
        "<hr>",
      ].join("\n"),
    );
  });

  it("escapa el HTML que venga en el texto", () => {
    const html = markdownToHtml('<script>alert(1)</script>\n\n## <img src=x onerror="alert(1)">\n\nA & B "c"');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("A &amp; B &quot;c&quot;");
  });

  it("no deja pasar enlaces javascript:, data: ni atributos inyectados", () => {
    expect(inlineHtml("[clic](javascript:alert(1))")).not.toContain("<a");
    expect(inlineHtml("[clic](JaVaScRiPt:alert(1))")).not.toContain("href");
    expect(inlineHtml("[img](data:text/html;base64,xx)")).not.toContain("href");
    expect(inlineHtml('[x](https://a.com"onmouseover="alert(1))')).not.toContain('"onmouseover');
    expect(inlineHtml("[**fuerte**](https://a.com)")).toBe('<a href="https://a.com" rel="noopener noreferrer nofollow" target="_blank"><strong>fuerte</strong></a>');
    expect(inlineHtml("[llama](tel:+13055550123)")).toContain('href="tel:+13055550123"');
  });

  it("no se confunde con caracteres de control en el texto", () => {
    expect(inlineHtml("a\u00000\u0000b [x](https://a.com)")).toBe('a0b <a href="https://a.com" rel="noopener noreferrer nofollow" target="_blank">x</a>');
  });

  it("arma el artículo completo con el H1 arriba", () => {
    const d = { h1: "Mi <título>", markdown: "# Viejo H1\n\nHola." };
    expect(articleHtml(d)).toBe("<h1>Mi &lt;título&gt;</h1>\n<p>Hola.</p>");
    expect(articleMarkdown(d)).toBe("# Mi <título>\n\nHola.\n");
  });
});

describe("cleanDraft y slugify", () => {
  it("limpia lo que devuelve la IA", () => {
    const d = cleanDraft({ ...goodDraft, slug: "Reparación de Techos ¡Miami!", h1: "# Título", outline: ["## Uno", " "], markdown: "# Título\r\n\r\nTexto" });
    expect(d.slug).toBe("reparacion-de-techos-miami");
    expect(d.h1).toBe("Título");
    expect(d.outline).toEqual(["Uno"]);
    expect(d.markdown).toBe("Texto");
    expect(slugify("¿?")).toBe("articulo");
  });
});

describe("readArticleReport", () => {
  const draft = { ...goodDraft, markdown: goodMarkdown() };
  const targets = contentTargets(research);
  const { score, checklist } = scoreDraft(draft, KEYWORD, targets);
  const saved = JSON.parse(
    JSON.stringify({
      version: 1,
      keyword: KEYWORD,
      language: "es",
      zone: { code: 1015116, name: "Miami,Florida,United States" },
      research,
      targets,
      draft,
      score,
      checklist,
      cost: 0.002,
      provider: "gemini",
      createdAt: "2026-10-05T13:00:00.000Z",
    }),
  );

  it("lee un reporte guardado igual a como se guardó", () => {
    const r = readArticleReport(saved)!;
    expect(r.keyword).toBe(KEYWORD);
    expect(r.score).toBe(score);
    expect(r.checklist).toEqual(checklist);
    expect(r.draft).toEqual(draft);
    expect(r.targets).toEqual(targets);
    expect(r.research.pages.length).toBe(4);
    expect(r.research.pages[3].error).toBe("timeout");
    expect(r.zone.code).toBe(1015116);
  });

  it("devuelve null si no es un artículo", () => {
    expect(readArticleReport(null)).toBeNull();
    expect(readArticleReport([])).toBeNull();
    expect(readArticleReport("x")).toBeNull();
    expect(readArticleReport({ keyword: "x" })).toBeNull();
    expect(readArticleReport({ keyword: "", draft: { markdown: "hola" } })).toBeNull();
  });

  it("tolera datos incompletos o raros", () => {
    const r = readArticleReport({
      keyword: "techos",
      language: "fr",
      draft: { markdown: "Hola", title: 5 },
      score: 250,
      checklist: [{ id: "meta", ok: "yes", points: 99, es: "x" }, { id: "inventado", ok: true }],
      research: { organic: [{ position: 1, url: "javascript:x" }, { position: 2, url: "https://a.com", title: "A" }], pages: "x" },
      createdAt: "no es fecha",
    })!;
    expect(r.language).toBe("es");
    expect(r.draft.title).toBe("");
    expect(r.score).toBe(100);
    expect(r.checklist).toEqual([{ id: "meta", ok: false, points: 10, max: 10, es: "x", en: "x" }]);
    expect(r.research.organic).toEqual([{ position: 2, url: "https://a.com", title: "A", domain: "", description: "" }]);
    expect(r.research.pages).toEqual([]);
    expect(r.targets.wordCount).toBe(1000);
    expect(r.createdAt).toBe(new Date(0).toISOString());
  });
});
