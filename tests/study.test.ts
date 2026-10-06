import { describe, expect, it } from "vitest";
import { campaignIdea, EMPTY_INPUT, htmlToText, readInput, readStudy, type Study, studyContext, studyIdeas, topKeywords } from "@/lib/study-shape";

const kw = (keyword: string, intent: Study["keywords"][number]["intent"], volume: Study["keywords"][number]["volume"], difficulty: Study["keywords"][number]["difficulty"]) => ({
  keyword, lang: "es" as const, intent, volume, difficulty, idea: `Idea ${keyword}`,
});

const study: Study = {
  summary: "Ajustadores públicos en Miami.",
  suggestedProfile: "Somos ajustadores públicos.",
  services: [{ name: "Reclamos por huracán", description: "Ayuda con el reclamo." }],
  audiences: [{ name: "Dueño de casa", description: "Tiene un reclamo.", pains: ["reclamo negado"], channels: "Facebook" }],
  differentiators: ["Atendemos en español"],
  objections: [{ objection: "¿Cuánto cobran?", answer: "Pregunta en la evaluación." }],
  market: { area: "Miami-Dade.", places: ["Hialeah", "Doral"], seasonality: ["Junio a noviembre: huracanes"], competitors: [], opportunities: ["Contenido en español"] },
  keywords: [
    kw("qué hace un ajustador público", "informativa", "medio", "baja"),
    kw("ajustador público en hialeah", "local", "medio", "baja"),
    kw("public adjuster miami", "comercial", "alto", "alta"),
  ],
  ads: { metaAudience: "30-65 años", googleKeywords: ["ajustador público"], negativeKeywords: ["empleo"], budgetTip: "Empieza con poco." },
  pillars: [{ name: "Educación", description: "Cómo funciona un reclamo", share: 60 }, { name: "Confianza", description: "Equipo", share: 40 }],
  campaigns: [{ title: "Tu reclamo fue negado", audience: "Dueño de casa", hook: "¿Te negaron el reclamo?", message: "Llámanos.", photo: "a roof", video: "Techo dañado" }],
  visualStyle: "Bright Florida homes.",
  avoid: ["Prometer dinero"],
  caveats: "Los volúmenes son estimados.",
};

describe("readStudy", () => {
  it("lee un estudio guardado con sus fuentes y quita enlaces raros", () => {
    const s = readStudy({ ...study, researched: true, sources: [{ url: "https://a.com", title: "A" }, { url: "javascript:alert(1)", title: "x" }] });
    expect(s?.researched).toBe(true);
    expect(s?.sources).toEqual([{ url: "https://a.com", title: "A" }]);
  });
  it("devuelve null si no hay estudio o está incompleto", () => {
    expect(readStudy(null)).toBeNull();
    expect(readStudy({ summary: "x" })).toBeNull();
  });
});

describe("topKeywords", () => {
  it("pone primero las búsquedas locales fáciles", () => {
    expect(topKeywords(study)[0]).toBe("ajustador público en hialeah");
    expect(topKeywords(study, 2)).toHaveLength(2);
  });
});

describe("studyContext", () => {
  it("resume el estudio para la IA", () => {
    const c = studyContext(study);
    expect(c).toContain("Hialeah");
    expect(c).toContain("ajustador público en hialeah");
    expect(c).toContain("Bright Florida homes.");
    expect(c).toContain("Prometer dinero");
  });
  it("queda vacío sin estudio", () => {
    expect(studyContext(null)).toBe("");
  });
});

describe("ideas del estudio", () => {
  it("usa los títulos de las campañas", () => {
    expect(studyIdeas(study)).toEqual(["Tu reclamo fue negado"]);
    expect(studyIdeas(undefined)).toEqual([]);
  });
  it("arma la idea completa para el compositor", () => {
    expect(campaignIdea(study.campaigns[0])).toContain("Gancho: ¿Te negaron el reclamo?");
  });
});

describe("htmlToText", () => {
  it("saca el texto visible de una página", () => {
    const html = `<html><head><title>Arevalo &amp; Co</title><meta name="description" content="Ajustadores en Miami"><style>p{}</style></head>
      <body><script>var x = 1;</script><h1>Reclamos</h1><p>Huracán,&nbsp;agua y fuego</p><!-- nota --></body></html>`;
    const t = htmlToText(html);
    expect(t).toContain("Arevalo & Co");
    expect(t).toContain("Ajustadores en Miami");
    expect(t).toContain("Huracán, agua y fuego");
    expect(t).not.toContain("var x");
    expect(t).not.toContain("nota");
  });
});

describe("readInput", () => {
  it("lee respuestas guardadas antes de la entrevista (sin preguntas)", () => {
    const old = { services: "Cortinas", customers: "", zone: "Managua", competitors: "", different: "", goal: "llamadas", lang: "es" };
    expect(readInput(old)?.answers).toEqual([]);
  });
  it("guarda las respuestas de la entrevista", () => {
    const input = { ...EMPTY_INPUT, services: "Cortinas", answers: [{ question: "¿Qué tipos haces?", answer: "Enrollables, motorizadas" }] };
    expect(readInput(input)?.answers[0].answer).toBe("Enrollables, motorizadas");
  });
});
