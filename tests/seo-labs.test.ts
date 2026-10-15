import { describe, expect, it } from "vitest";
import { type KeywordsReport, labsKeywords, readKeywordsReport, withLabs } from "@/lib/seo/keywords";
import { asIntent, difficultyLevel, labsCost, parseKeywordOverview, sellsIntent } from "@/lib/seo/labs-shared";

// Así viene /v3/dataforseo_labs/google/keyword_overview/live (result[0].items[], meses del más nuevo al más viejo).
const OVERVIEW = [
  {
    se_type: "google",
    location_code: 2840,
    language_code: "en",
    items_count: 2,
    items: [
      {
        se_type: "google",
        keyword: "Roof Repair Miami",
        keyword_info: {
          search_volume: 880,
          cpc: 31.2,
          monthly_searches: [
            { year: 2026, month: 9, search_volume: 1000 },
            { year: 2026, month: 8, search_volume: 900 },
          ],
        },
        keyword_properties: { keyword_difficulty: 37.6 },
        search_intent_info: { main_intent: "transactional", foreign_intent: ["commercial"] },
      },
      { keyword: "how to fix a roof leak", keyword_info: { search_volume: 1600, cpc: null }, keyword_properties: { keyword_difficulty: null }, search_intent_info: { main_intent: "weird" } },
      { keyword: "", keyword_info: {} },
      "basura",
    ],
  },
];

describe("DataForSEO Labs", () => {
  it("lee keyword_overview sin confiar en su forma", () => {
    const rows = parseKeywordOverview(OVERVIEW);
    expect(rows).toEqual([
      { keyword: "roof repair miami", volume: 880, cpc: 31.2, difficulty: 38, intent: "transactional", trend: [900, 1000] },
      { keyword: "how to fix a roof leak", volume: 1600, cpc: null, difficulty: null, intent: null, trend: [] },
    ]);
    expect(parseKeywordOverview([])).toEqual([]);
    expect(parseKeywordOverview([{ items: null }])).toEqual([]);
  });

  it("dificultad e intención en palabras simples", () => {
    expect(difficultyLevel(0)).toBe("easy");
    expect(difficultyLevel(29)).toBe("easy");
    expect(difficultyLevel(30)).toBe("medium");
    expect(difficultyLevel(60)).toBe("hard");
    expect(difficultyLevel(null)).toBeNull();
    expect(difficultyLevel(Number.NaN)).toBeNull();
    expect(asIntent("commercial")).toBe("commercial");
    expect(asIntent("buy")).toBeNull();
    expect(sellsIntent("transactional")).toBe(true);
    expect(sellsIntent("informational")).toBe(false);
  });

  it("calcula el costo de Labs hacia arriba", () => {
    // 1 llamada (0.012) + 150 filas × 0.00012 = 0.03
    expect(labsCost(150)).toBe(0.03);
    expect(labsCost(0)).toBe(0.012);
    expect(labsCost(10, 3)).toBe(0.038);
  });
});

describe("Palabras clave con dificultad", () => {
  const report: KeywordsReport = {
    location: "Miami,Florida,United States",
    locationCode: 1015116,
    language: "en",
    keywords: [{ keyword: "Roof Repair Miami", volume: 720, cpc: 25, competition: "high", competitionIndex: 90, trend: [1, 2] }],
    ideas: [{ keyword: "roof leak", volume: 300, cpc: 10, competition: "low", competitionIndex: 10, trend: [] }],
    cost: 0.15,
    createdAt: "2026-10-01T00:00:00.000Z",
    labsFailed: true,
  };

  it("pide las medidas y las ideas sin repetir", () => {
    expect(labsKeywords({ keywords: report.keywords, ideas: [...report.ideas, report.ideas[0]] })).toEqual(["roof repair miami", "roof leak"]);
  });

  it("agrega dificultad e intención sin tocar las búsquedas de Google Ads", () => {
    const next = withLabs(report, parseKeywordOverview(OVERVIEW), { country: "United States", language: "en", at: "2026-10-02T00:00:00.000Z", cost: 0.0126 });
    expect(next.keywords[0]).toMatchObject({ keyword: "Roof Repair Miami", volume: 720, difficulty: 38, intent: "transactional" });
    // La que Labs no conoce queda con null (sí se preguntó).
    expect(next.ideas[0]).toMatchObject({ keyword: "roof leak", volume: 300, difficulty: null, intent: null });
    expect(next.cost).toBe(0.1626);
    expect(next.labsFailed).toBeUndefined();
    // Se guarda y se vuelve a leer igual.
    const back = readKeywordsReport(JSON.parse(JSON.stringify(next)));
    expect(back?.keywords[0]).toMatchObject({ difficulty: 38, intent: "transactional" });
    expect(back?.ideas[0]).toMatchObject({ difficulty: null, intent: null });
    expect(back?.labs).toEqual({ country: "United States", language: "en", at: "2026-10-02T00:00:00.000Z", cost: 0.0126 });
  });

  it("los reportes viejos se leen sin dificultad", () => {
    const old = readKeywordsReport({ keywords: [{ keyword: "x", volume: 10, trend: [] }], ideas: [] });
    expect(old?.keywords[0]).not.toHaveProperty("difficulty");
    expect(old?.labs).toBeUndefined();
  });
});
