import { describe, expect, it } from "vitest";
import { cleanSeed, filterCounts, filterIdeas, ideasCostEstimate, isLocal, isQuestion, type IdeaRow, readIdeasReport, sortIdeas } from "@/lib/seo/ideas";
import { parseLabsItemsAll } from "@/lib/seo/labs-shared";

const row = (keyword: string, volume: number | null, difficulty: number | null = null, intent: IdeaRow["intent"] = null, cpc: number | null = null): IdeaRow => ({ keyword, volume, difficulty, intent, cpc, trend: [] });
const ROWS = [
  row("reparación de techos", 1300, 45, "commercial", 25),
  row("cómo reparar un techo con goteras", 480, 22, "informational", 3),
  row("reparación de techos miami", 210, 18, "transactional", 30),
  row("reparación de techos cerca de mí", 590, 35, "transactional", 28),
  row("reparación de techos gratis", 40, 10, "informational", null),
  row("how much does roof repair cost", 900, 41, "informational", 6),
];

describe("Ideas de palabras", () => {
  it("lee keyword_suggestions aunque la semilla y las ideas vengan en elementos distintos", () => {
    const res = [
      { seed_keyword: "techos", seed_keyword_data: { keyword: "techos", keyword_info: { search_volume: 5000 } } },
      { total_count: 1234, items: [{ keyword: "Techos Baratos", keyword_info: { search_volume: 90, cpc: 2 }, keyword_properties: { keyword_difficulty: 12 }, search_intent_info: { main_intent: "commercial" } }, { keyword: "techos" }, { keyword: "" }] },
    ];
    const { rows, total } = parseLabsItemsAll(res);
    expect(total).toBe(1234);
    expect(rows.map((r) => [r.keyword, r.volume, r.difficulty, r.intent])).toEqual([
      ["techos", 5000, null, null],
      ["techos baratos", 90, 12, "commercial"],
    ]);
  });

  it("reconoce preguntas y búsquedas locales", () => {
    expect(isQuestion("¿Cómo reparar un techo?")).toBe(true);
    expect(isQuestion("how much does roof repair cost")).toBe(true);
    expect(isQuestion("reparación de techos")).toBe(false);
    expect(isLocal("reparación de techos cerca de mí")).toBe(true);
    expect(isLocal("roofer near me")).toBe(true);
    expect(isLocal("reparación de techos miami", ["Miami"])).toBe(true);
    expect(isLocal("reparación de techos", ["Miami"])).toBe(false);
  });

  it("filtra por tipo, por palabras y por búsquedas al mes", () => {
    const k = (list: IdeaRow[]) => list.map((r) => r.keyword);
    expect(k(filterIdeas(ROWS, { filter: "questions" }))).toEqual(["cómo reparar un techo con goteras", "how much does roof repair cost"]);
    expect(k(filterIdeas(ROWS, { filter: "easy" }))).toEqual(["cómo reparar un techo con goteras", "reparación de techos miami", "reparación de techos gratis"]);
    expect(k(filterIdeas(ROWS, { filter: "buyers" }))).toEqual(["reparación de techos", "reparación de techos miami", "reparación de techos cerca de mí"]);
    expect(k(filterIdeas(ROWS, { filter: "local", places: ["Miami"] }))).toEqual(["reparación de techos miami", "reparación de techos cerca de mí"]);
    expect(k(filterIdeas(ROWS, { exclude: "gratis", minVolume: 400, include: "reparacion" }))).toEqual(["reparación de techos", "reparación de techos cerca de mí"]);
    expect(filterCounts(ROWS, ["Miami"])).toEqual({ all: 6, questions: 2, easy: 3, buyers: 3, local: 2 });
  });

  it("ordena por búsquedas, facilidad o CPC", () => {
    expect(sortIdeas(ROWS, "volume")[0].keyword).toBe("reparación de techos");
    expect(sortIdeas(ROWS, "difficulty")[0].keyword).toBe("reparación de techos gratis");
    expect(sortIdeas(ROWS, "cpc")[0].keyword).toBe("reparación de techos miami");
  });

  it("limpia la palabra, guarda el reporte y dice lo que cuesta", () => {
    expect(cleanSeed("  ¡Reparación de TECHOS!!  en  Miami Florida hoy mismo ya ")).toBe("reparación de techos en miami florida");
    const r = { seed: "techos", country: "United States", language: "es", total: 10, rows: ROWS, related: false, cost: 0.048, createdAt: "2026-10-14T00:00:00.000Z" };
    expect(readIdeasReport(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(readIdeasReport({ rows: [] })).toBeNull();
    // 0.012 + 300 × 0.00012 = 0.048
    expect(ideasCostEstimate()).toBe(0.048);
  });
});
