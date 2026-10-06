import { describe, expect, it } from "vitest";
import {
  cleanKeyword,
  costText,
  type KeywordsReport,
  keywordsCostEstimate,
  type KwRow,
  mergeZoneRows,
  monthlyTrend,
  normalizeRow,
  pickIdeas,
  pickSeeds,
  readKeywordsReport,
  reportLookup,
  trendDirection,
  uniqueKeywords,
  volumeFormat,
  zoneTotal,
  zoneVolumes,
} from "@/lib/seo/keywords";
import { groupByZone, latestByZone, zonesWithout } from "@/lib/seo/zones";

// Así viene un resultado de /v3/keywords_data/google_ads/search_volume/live (meses del más nuevo al más viejo).
const API_ITEM = {
  keyword: "Roofing Miami",
  spell: null,
  location_code: 1015116,
  language_code: "en",
  search_partners: false,
  competition: "HIGH",
  competition_index: 87,
  search_volume: 1300,
  low_top_of_page_bid: 8.1,
  high_top_of_page_bid: 31.5,
  cpc: 22.47,
  monthly_searches: [
    { year: 2026, month: 9, search_volume: 1600 },
    { year: 2026, month: 8, search_volume: 1600 },
    { year: 2026, month: 7, search_volume: 1300 },
    { year: 2026, month: 6, search_volume: 1300 },
    { year: 2026, month: 5, search_volume: 1000 },
    { year: 2026, month: 4, search_volume: 1000 },
    { year: 2026, month: 3, search_volume: 1000 },
    { year: 2026, month: 2, search_volume: 880 },
    { year: 2026, month: 1, search_volume: 880 },
    { year: 2025, month: 12, search_volume: 880 },
    { year: 2025, month: 11, search_volume: 1000 },
    { year: 2025, month: 10, search_volume: 1300 },
  ],
};

const row = (keyword: string, volume: number | null, extra: Partial<KwRow> = {}): KwRow => ({
  keyword,
  volume,
  cpc: null,
  competition: null,
  competitionIndex: null,
  trend: [],
  ...extra,
});

describe("normalizeRow", () => {
  it("convierte el formato de la API", () => {
    expect(normalizeRow(API_ITEM)).toEqual({
      keyword: "roofing miami",
      volume: 1300,
      cpc: 22.47,
      competition: "high",
      competitionIndex: 87,
      trend: [1300, 1000, 880, 880, 880, 1000, 1000, 1000, 1300, 1300, 1600, 1600],
    });
  });

  it("acepta datos que faltan", () => {
    expect(normalizeRow({ keyword: "techos", search_volume: null, cpc: null, competition: null, competition_index: null, monthly_searches: null })).toEqual(
      row("techos", null),
    );
    expect(normalizeRow({ keyword: "x", competition: "UNSPECIFIED", search_volume: -5, cpc: "3" })).toMatchObject({ competition: null, volume: null, cpc: null });
  });

  it("descarta lo que no es una palabra", () => {
    expect(normalizeRow(null)).toBeNull();
    expect(normalizeRow("roofing")).toBeNull();
    expect(normalizeRow({ keyword: "  " })).toBeNull();
    expect(normalizeRow({ search_volume: 10 })).toBeNull();
  });

  it("ordena los meses y se queda con los últimos 12", () => {
    const months = Array.from({ length: 14 }, (_, i) => ({ year: 2025 + Math.floor(i / 12), month: (i % 12) + 1, search_volume: i }));
    expect(monthlyTrend([...months].reverse())).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(monthlyTrend([{ year: 2026, month: 1, search_volume: null }, "x"])).toEqual([0]);
    expect(monthlyTrend(null)).toEqual([]);
  });
});

describe("cleanKeyword / uniqueKeywords", () => {
  it("deja la palabra como la acepta Google Ads", () => {
    expect(cleanKeyword("  Reparación de TECHOS!! en Miami 🏠 ")).toBe("reparación de techos en miami");
    expect(cleanKeyword("a b c d e f g h i j k l")).toBe("a b c d e f g h i j");
    expect(cleanKeyword("x".repeat(120)).length).toBe(80);
    expect(cleanKeyword("🏠")).toBe("");
  });

  it("quita repetidas sin importar mayúsculas y respeta el máximo", () => {
    expect(uniqueKeywords(["Techos Miami", "techos miami", "", "Roofing"], 10)).toEqual(["techos miami", "roofing"]);
    expect(uniqueKeywords(Array.from({ length: 150 }, (_, i) => `kw ${i}`))).toHaveLength(100);
  });
});

describe("trendDirection", () => {
  it("compara los últimos 3 meses con los 3 anteriores", () => {
    expect(trendDirection([100, 100, 100, 150, 150, 150])).toBe("up");
    expect(trendDirection([300, 300, 300, 200, 200, 200])).toBe("down");
    expect(trendDirection([100, 100, 100, 105, 100, 100])).toBe("flat");
    expect(trendDirection([5, 5, 5, 5, 5, 5, 500, 500, 500, 10, 10, 10])).toBe("down");
  });

  it("casos sin suficientes datos o en cero", () => {
    expect(trendDirection([])).toBe("flat");
    expect(trendDirection([10, 20, 30, 40, 50])).toBe("flat");
    expect(trendDirection([0, 0, 0, 0, 0, 0])).toBe("flat");
    expect(trendDirection([0, 0, 0, 10, 0, 0])).toBe("up");
  });
});

describe("pickIdeas / pickSeeds", () => {
  it("ordena por búsquedas, sin repetir ni incluir las ya medidas", () => {
    const ideas = [
      row("roof repair", 500, { competitionIndex: 50 }),
      row("roofing miami", 1300),
      row("roof leak", 500, { competitionIndex: 10 }),
      row("Roof Repair", 400),
      row("techo nuevo", null),
      row("tejas", 0),
      row("roofers near me", 2400),
    ];
    expect(pickIdeas(ideas, ["Roofing Miami"]).map((r) => r.keyword)).toEqual(["roofers near me", "roof leak", "roof repair"]);
    expect(pickIdeas(ideas, [], 2).map((r) => r.keyword)).toEqual(["roofers near me", "roofing miami"]);
  });

  it("elige las semillas con más búsquedas, o las primeras", () => {
    const measured = [row("a", 10), row("b", 900), row("c", null), row("d", 50)];
    expect(pickSeeds(["a", "b", "c", "d"], measured, 2)).toEqual(["b", "d"]);
    expect(pickSeeds(["x", "y", "z"], [], 2)).toEqual(["x", "y"]);
    expect(pickSeeds(Array.from({ length: 10 }, (_, i) => `k${i}`), [])).toHaveLength(5);
  });
});

describe("readKeywordsReport", () => {
  const saved = {
    location: "Miami,Florida,United States",
    locationCode: 1015116,
    language: "en",
    keywords: [normalizeRow(API_ITEM)],
    ideas: [row("roofers near me", 2400)],
    cost: 0.15,
    createdAt: "2026-10-06T12:00:00.000Z",
  };

  it("lee un reporte guardado", () => {
    const r = readKeywordsReport(JSON.parse(JSON.stringify(saved)));
    expect(r).toEqual(saved);
    expect(reportLookup(r).get("roofing miami")?.volume).toBe(1300);
    expect(reportLookup(r).get("roofers near me")?.volume).toBe(2400);
  });

  it("no se rompe con datos dañados o viejos", () => {
    expect(readKeywordsReport(null)).toBeNull();
    expect(readKeywordsReport("x")).toBeNull();
    expect(readKeywordsReport([])).toBeNull();
    expect(readKeywordsReport({ ideas: [] })).toBeNull();
    const r = readKeywordsReport({ keywords: [null, { keyword: "ok", volume: "10", trend: [1, "x", -3], competition: "LOW" }, { volume: 5 }], ideas: "no", cost: "1", language: "fr", ideasFailed: true });
    expect(r).toEqual({
      location: "",
      locationCode: 0,
      language: "es",
      keywords: [{ keyword: "ok", volume: null, cpc: null, competition: "low", competitionIndex: null, trend: [1, 0, 0] }],
      ideas: [],
      cost: 0,
      createdAt: "",
      ideasFailed: true,
    });
    expect(reportLookup(null).size).toBe(0);
  });
});

describe("formato", () => {
  it("costo y volumen", () => {
    expect(costText(0.15)).toBe("$0.15");
    expect(costText(0.075)).toBe("$0.075");
    expect(costText(0)).toBe("$0.00");
    expect(costText(Number.NaN)).toBe("$0.00");
    expect(volumeFormat("es").format(1300)).toBe("1.300");
    expect(volumeFormat("en").format(1300)).toBe("1,300");
  });
});

describe("varias zonas", () => {
  const zones = [
    { code: 1, name: "Managua,Managua,Nicaragua", type: "City" },
    { code: 2, name: "León,León,Nicaragua", type: "City" },
    { code: 3, name: "Nicaragua", type: "Country" },
  ];
  const rep = (locationCode: number, keywords: KwRow[], createdAt = "2026-10-06T12:00:00.000Z"): KeywordsReport => ({
    location: zones.find((z) => z.code === locationCode)?.name ?? "",
    locationCode,
    language: "es",
    keywords,
    ideas: [],
    cost: 0.075,
    createdAt,
  });

  it("toma el reporte más nuevo de cada zona y avisa cuáles faltan", () => {
    const newest = rep(1, [row("techos", 100)], "2026-10-06T12:00:00.000Z");
    const older = rep(1, [row("techos", 90)], "2026-10-01T12:00:00.000Z");
    const leon = rep(2, [row("techos", 20)]);
    const removed = rep(99, [row("techos", 5)]);
    const byZone = latestByZone([newest, null, removed, leon, older], zones);
    expect(byZone.get(1)).toBe(newest);
    expect(byZone.get(2)).toBe(leon);
    expect(byZone.has(3)).toBe(false);
    expect(byZone.has(99)).toBe(false);
    expect(zonesWithout(zones, byZone).map((z) => z.code)).toEqual([3]);
    expect(groupByZone([newest, older], zones).get(1)).toEqual([newest, older]);
  });

  it("los reportes viejos sin código de zona cuentan como de la principal", () => {
    const old = rep(0, [row("techos", 100)]);
    expect(latestByZone([old], zones).get(1)).toBe(old);
    expect(latestByZone([old], []).size).toBe(0);
  });

  it("une las filas: datos de la principal y una columna de búsquedas por zona", () => {
    const byZone = new Map<number, KeywordsReport>([
      [1, rep(1, [row("techos", 100, { cpc: 2, trend: [1, 2] }), row("goteras", null), row("tejas", 10)])],
      [2, rep(2, [row("techos", 20), row("goteras", 300)])],
    ]);
    const rows = mergeZoneRows(["Techos", "goteras", "tejas", "techos", "nueva"], zones, byZone);
    expect(rows.map((r) => r.row.keyword)).toEqual(["techos", "tejas", "goteras", "nueva"]);
    expect(rows[0]).toEqual({ row: row("techos", 100, { cpc: 2, trend: [1, 2] }), volumes: [100, 20, undefined] });
    // tejas no se midió en León; goteras no tiene datos en Managua.
    expect(rows[1].volumes).toEqual([10, undefined, undefined]);
    expect(rows[2].volumes).toEqual([null, 300, undefined]);
    expect(rows[3]).toEqual({ row: row("nueva", null), volumes: [undefined, undefined, undefined] });
  });

  it("sin reporte de la principal ordena por el total de las otras zonas", () => {
    const byZone = new Map<number, KeywordsReport>([[2, rep(2, [row("a", 5), row("b", 50)])]]);
    expect(mergeZoneRows(["a", "b"], zones, byZone).map((r) => r.row.keyword)).toEqual(["b", "a"]);
  });

  it("volúmenes por zona y total", () => {
    const byZone = new Map<number, KeywordsReport>([
      [1, rep(1, [row("techos", 1300)])],
      [3, rep(3, [row("techos", 2100)])],
    ]);
    const v = zoneVolumes(" TECHOS ", zones, byZone);
    expect(v).toEqual([1300, undefined, 2100]);
    expect(zoneTotal(v)).toBe(3400);
    expect(zoneTotal([undefined, null])).toBeNull();
  });

  it("costo estimado: volúmenes por zona + ideas en la principal", () => {
    expect(keywordsCostEstimate(1)).toBe(0.15);
    expect(keywordsCostEstimate(3)).toBe(0.3);
    expect(keywordsCostEstimate(0)).toBe(0.15);
  });
});
