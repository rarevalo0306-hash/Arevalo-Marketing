import { describe, expect, it } from "vitest";
import {
  cleanQuestions,
  computeScores,
  domainOf,
  mentionMatcher,
  nameVariants,
  normalizeText,
  positionOf,
  rankCompetitors,
  rankDomains,
  readVisibilityReport,
  sourceDomain,
} from "@/lib/seo/visibility";

const biz = { name: "Arévalo Public Adjusters, LLC", website: "https://www.arevalopa.com/" };
const m = mentionMatcher(biz);

describe("mention detection", () => {
  it("normalizes accents, case and punctuation", () => {
    expect(normalizeText("ARÉVALO & Co., L.L.C.")).toBe("arevalo and co l l c");
    expect(nameVariants("The Roof Doctors Inc.")).toEqual(["the roof doctors inc", "roof doctors"]);
  });

  it("finds the name without accents or in other case", () => {
    expect(m.inText("Te recomiendo AREVALO PUBLIC ADJUSTERS en Hialeah.")).toBe(true);
    expect(m.inText("Try arévalo public adjusters.")).toBe(true);
  });

  it("finds the name without the LLC suffix or with it", () => {
    expect(m.inText("1. Arevalo Public Adjusters — bilingual team")).toBe(true);
    expect(m.inText("Arevalo Public Adjusters LLC is in Miami")).toBe(true);
  });

  it("ignores a leading 'The'", () => {
    const roof = mentionMatcher({ name: "The Roof Doctors Inc", website: "" });
    expect(roof.inText("Call Roof Doctors in Doral.")).toBe(true);
  });

  it("finds the website domain in the text and in the sources", () => {
    expect(domainOf("www.arevalopa.com/contact")).toBe("arevalopa.com");
    expect(m.inText("See arevalopa.com for details.")).toBe(true);
    expect(m.inSources([{ url: "https://blog.arevalopa.com/post", title: "" }])).toBe(true);
    // Gemini: enlace de redirección de Google con el dominio en el título.
    const gemini = { url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "arevalopa.com" };
    expect(sourceDomain(gemini)).toBe("arevalopa.com");
    expect(m.inSources([gemini])).toBe(true);
    // El nombre en la dirección de una página de directorio.
    expect(m.inSources([{ url: "https://www.yelp.com/biz/arevalo-public-adjusters-miami", title: "Yelp" }])).toBe(true);
  });

  it("does not match a partial word or a look-alike domain", () => {
    const short = mentionMatcher({ name: "Ajuste Pro", website: "ajustepro.com" });
    expect(short.inText("Ajuste Profesional de Reclamos es una opción")).toBe(false);
    expect(short.inText("Visit notajustepro.com")).toBe(false);
    expect(short.inSources([{ url: "https://ajustepro.com.evil.net/", title: "" }])).toBe(false);
    expect(m.inText("Other Arevalo Public Adjustersmiami firm")).toBe(false);
    expect(m.inText("Los ajustadores públicos de Miami")).toBe(false);
  });

  it("finds the position in the list of named businesses", () => {
    expect(positionOf(["Storm Claims Co", "Arevalo Public Adjusters", "Other PA"], m)).toBe(2);
    expect(positionOf(["Storm Claims Co"], m)).toBeNull();
  });
});

describe("scores", () => {
  it("computes the overall and per-AI score without counting errors", () => {
    const r = computeScores([
      { provider: "gemini", mentioned: true },
      { provider: "gemini", mentioned: false },
      { provider: "claude", mentioned: true },
      { provider: "claude", mentioned: false, error: "timeout" },
      { provider: "openai", mentioned: false },
    ]);
    expect(r.score).toBe(50);
    expect(r.byProvider.gemini).toEqual({ score: 50, mentioned: 1, total: 2, errors: 0 });
    expect(r.byProvider.claude).toEqual({ score: 100, mentioned: 1, total: 1, errors: 1 });
    expect(r.byProvider.openai?.score).toBe(0);
  });

  it("returns null when every answer failed", () => {
    expect(computeScores([{ provider: "gemini", mentioned: false, error: "x" }]).score).toBeNull();
  });

  it("ranks competitors and cited websites by number of answers", () => {
    const top = rankCompetitors([{ competitors: ["Storm Claims Co", "Other PA"] }, { competitors: ["Storm Claims Co LLC", "storm claims co"] }]);
    expect(top[0]).toEqual({ name: "Storm Claims Co", count: 2 });
    const domains = rankDomains(
      [{ sources: [{ url: "https://www.yelp.com/a", title: "" }, { url: "https://arevalopa.com", title: "" }] }, { sources: [{ url: "https://yelp.com/b", title: "" }] }],
      biz.website,
    );
    expect(domains).toEqual([{ domain: "yelp.com", count: 2 }]);
  });
});

describe("questions and saved reports", () => {
  it("cleans the owner's questions", () => {
    expect(cleanQuestions([" a ", "", "A", "b", "c", "d", "e", "f", "x".repeat(300)])).toEqual(["a", "b", "c", "d", "e"]);
    expect(cleanQuestions(["x".repeat(300)])[0]).toHaveLength(200);
  });

  it("reads old or broken reports without failing", () => {
    expect(readVisibilityReport(null)).toBeNull();
    expect(readVisibilityReport({ score: 3 })).toBeNull();
    const r = readVisibilityReport({ results: [{ question: "q", provider: "gemini", mentioned: true }, { provider: "nope" }], recommendations: ["Pide reseñas"] });
    expect(r?.results).toHaveLength(1);
    expect(r?.score).toBe(100);
    expect(r?.questions).toEqual(["q"]);
    expect(r?.recommendations).toEqual([{ title: "Pide reseñas", detail: "" }]);
  });
});
