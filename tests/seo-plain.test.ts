import { describe, expect, it } from "vitest";
import { businessTopicVocab, readGapReport, relevantGapRows } from "@/lib/seo/gap";
import { readKeywordsReport } from "@/lib/seo/keywords";
import { joinNames, ordinal, pageMismatch, plainSummary, positionText, rankedPageName, rowAdvice, urlPath, verdictOf } from "@/lib/seo/plain";
import { readRankReport, type RankRow } from "@/lib/seo/rank";
import { readVisibilityReport } from "@/lib/seo/visibility";
import fameseg from "./fixtures/fameseg.json";

// Datos reales de Fameseg (cortinas metálicas y portones, Managua) guardados el 6 de octubre de 2026.
const rank = readRankReport(fameseg.reports.rank.data)!;
const keywords = readKeywordsReport(fameseg.reports.keywords.data)!;
const ai = readVisibilityReport(fameseg.reports.ai.data)!;
const gap = readGapReport(fameseg.reports.gap.data)!;
const vocab = businessTopicVocab(fameseg.business);
const row = (k: string) => rank.rows.find((r) => r.keyword === k)!;

describe("qué quiere decir cada posición", () => {
  it("veredicto: Excelente, Bien, Casi, Lejos, No sales", () => {
    expect([1, 3, 4, 10, 11, 15, 16, 20, null].map(verdictOf)).toEqual(["excellent", "excellent", "good", "good", "close", "close", "far", "far", "none"]);
  });

  it("la celda en palabras: Google y el mapa", () => {
    expect(positionText(row("cortinas metálicas managua"))).toEqual({
      organic: { es: "2° en Google", en: "#2 on Google" },
      map: { es: "Hay mapa, pero no sales", en: "There's a map, but you're not on it" },
    });
    expect(positionText(row("mantenimiento de cortinas metálicas"))).toEqual({
      organic: { es: "No sales (top 20)", en: "Not in top 20" },
      map: { es: "3° en el mapa", en: "#3 on the map" },
    });
    expect(positionText(row("portones tipo americano nicaragua")).map).toEqual({ es: "Google no mostró mapa", en: "Google showed no map" });
  });

  it("ordinal y nombres juntos", () => {
    expect(ordinal(2)).toEqual({ es: "2°", en: "#2" });
    expect(joinNames(["a", "b", "c", "d", "e"])).toEqual({ es: "«a», «b», «c» y 2 más", en: "“a”, “b”, “c” and 2 more" });
    expect(joinNames(["a"]).es).toBe("«a»");
  });
});

describe("la página que sale trata de otra cosa", () => {
  it("detecta el artículo de equipos de protección personal que sale para «cortinas tubulares managua»", () => {
    const r = row("cortinas tubulares managua");
    expect(rowAdvice(r)).toEqual({ verdict: "good", mismatch: true, page: "Equipos de protección personal: qué necesita su empresa en Nicaragua" });
  });

  it("no marca la página correcta (cortina metálica) ni la página principal", () => {
    expect(rowAdvice(row("cortinas metálicas managua")).mismatch).toBe(false);
    expect(pageMismatch("cortinas metálicas managua", "https://fameseg.com/")).toBe(false);
    expect(pageMismatch("cortinas metálicas managua", null)).toBe(false);
  });

  it("una página de cobertura de Managua no es sobre portones tipo americano (el lugar no cuenta)", () => {
    expect(pageMismatch("portones tipo americano nicaragua", "https://fameseg.com/cobertura/managua")).toBe(true);
    expect(rankedPageName(row("portones tipo americano nicaragua"))).toBe("cobertura/managua");
    expect(pageMismatch("portones tipo americano", "https://fameseg.com/servicios/portones-americanos")).toBe(false);
  });

  it("lee la dirección con acentos y sin terminación", () => {
    expect(urlPath("https://x.com/blog/reparaci%C3%B3n-de-techos.html")).toBe("blog/reparación-de-techos");
    expect(pageMismatch("reparación de techos miami", "https://x.com/blog/reparacion-techo.html")).toBe(false);
  });

  it("no falla con filas sin dirección", () => {
    const r: RankRow = { keyword: "x y z", position: null, url: null, localPack: null, top: [], features: [] };
    expect(rowAdvice(r)).toEqual({ verdict: "none", mismatch: false, page: "" });
  });
});

describe("plainSummary con los datos de Fameseg", () => {
  const lines = plainSummary({
    businessId: "fameseg",
    rank,
    keywords,
    tracked: fameseg.business.seoKeywords,
    ai,
    gap: relevantGapRows(gap.rows, vocab),
  });

  it("arma 6 frases simples, de lo más importante a lo menos", () => {
    expect(lines.map((l) => l.text.es)).toEqual([
      "Para «cortinas metálicas managua» sales 2° en Google: muy bien, casi todos los clics se los llevan los 3 primeros.",
      "Para «portones automáticos nicaragua» no sales en los primeros 20 resultados: casi nadie te encuentra. Escribe un artículo o crea una página sobre eso.",
      "Para «portones tipo americano nicaragua» sales 15°, en la segunda página de Google: casi nadie llega ahí. Mejora esa página o escribe un artículo para pasar a la primera.",
      "Para «cortinas tubulares managua» Google muestra tu página «Equipos de protección personal: qué necesita su empresa en Nicaragua», que no habla específicamente de eso. Una página o artículo sobre «cortinas tubulares managua» te ayudaría a subir.",
      "En el mapa de Google sales 3° para «mantenimiento de cortinas metálicas» y 3° para «cortinas tubulares managua». El mapa sale arriba de todo: ahí te llaman directo.",
      "ChatGPT te recomienda en 4 de 5 preguntas. Gemini no se pudo revisar (llegó a su límite gratis por minuto): vuelve a intentar en un rato.",
    ]);
    expect(lines.map((l) => l.icon)).toEqual(["✅", "⚠️", "🔸", "🔀", "📍", "🤖"]);
    expect(lines.map((l) => l.tone)).toEqual(["good", "bad", "warn", "warn", "good", "good"]);
  });

  it("cada frase lleva a su sección y, si hay algo que hacer, al asistente para escribir", () => {
    expect(lines.map((l) => l.link.href)).toEqual(["#posiciones", "#posiciones", "#posiciones", "#posiciones", "#posiciones", "#ia"]);
    expect(lines[1].action?.href).toBe("/b/fameseg/seo/escribir?kw=portones%20autom%C3%A1ticos%20nicaragua");
    expect(lines[3].action?.href).toBe("/b/fameseg/seo/escribir?kw=cortinas%20tubulares%20managua");
  });

  it("también en inglés", () => {
    expect(lines[0].text.en).toBe("For “cortinas metálicas managua” you're #2 on Google: great, the top 3 get almost all the clicks.");
    expect(lines[5].text.en).toBe("ChatGPT recommends you in 4 of 5 questions. Gemini couldn't be checked (it hit its free per-minute limit): try again in a while.");
  });

  it("con más espacio agrega la oportunidad de la competencia (solo las del negocio) y las palabras sin búsquedas", () => {
    const all = plainSummary({ businessId: "fameseg", rank, keywords, tracked: fameseg.business.seoKeywords, ai, gap: relevantGapRows(gap.rows, vocab), max: 20 });
    const extra = all.slice(6).map((l) => l.text.es);
    expect(extra).toEqual([
      "Tu competencia sale en Google por «portones corredizos» (320 búsquedas al mes) y tú no: es tu mejor oportunidad para escribir.",
      "Para «cortinas metálicas managua» y «portones automáticos nicaragua» Google muestra un mapa con 3 negocios y tú no estás. Completa tu Perfil de Google y pide reseñas a tus clientes.",
      "3 de tus 5 palabras clave casi no se buscan en Google (menos de unas 10 veces al mes, por eso salen con «—»). Sigue también alguna de las ideas que sí se buscan.",
    ]);
    // Sin el filtro de relevancia, la "mejor oportunidad" sería «gas cerca de mí» (de Páginas Amarillas).
    expect(gap.rows[0].keyword).toBe("gas cerca de mí");
  });

  it("una IA que solo tuvo errores no cuenta como 0 %", () => {
    expect(ai.byProvider.gemini).toEqual({ score: null, mentioned: 0, total: 0, errors: 5 });
    expect(ai.score).toBe(80);
  });

  it("sin posiciones pide empezar por ahí; sin nada, no inventa", () => {
    expect(plainSummary({ businessId: "x", rank: null })[0].id).toBe("no-rank");
    expect(plainSummary({ businessId: "x", rank: { ...rank, rows: [] } })).toEqual([]);
  });

  it("varias palabras en el top 3 van en una sola frase", () => {
    const r = { ...rank, rows: rank.rows.map((x) => (x.keyword === "portones automáticos nicaragua" ? { ...x, position: 1 } : x)) };
    const first = plainSummary({ businessId: "x", rank: r })[0];
    expect(first.text.es).toBe("Para «portones automáticos nicaragua» y «cortinas metálicas managua» sales entre los 3 primeros de Google: muy bien, casi todos los clics se los llevan los 3 primeros.");
  });
});

describe("veredicto con el mapa", () => {
  it("fuera de la primera página pero entre los 3 del mapa es «Bien en el mapa»", () => {
    expect(verdictOf(null, 3)).toBe("map");
    expect(verdictOf(15, 2)).toBe("map");
    expect(verdictOf(4, 2)).toBe("good");
    expect(verdictOf(null, null)).toBe("none");
    expect(verdictOf(null, 5)).toBe("none");
  });
});
