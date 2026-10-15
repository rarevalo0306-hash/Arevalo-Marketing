import { describe, expect, it } from "vitest";
import type { SerpResult } from "@/lib/seo/rank";
import { domainLookupCost, findLookup, keywordLookupCost, lookupFresh, lookupKey, lookupKeyword, parseDomainOverview, parseLookupSerp, readLookup } from "@/lib/seo/lookup";

// Respuesta de /v3/serp/google/organic/live/advanced (recortada).
const SERP = {
  keyword: "roof repair miami",
  item_types: ["local_pack", "organic", "people_also_ask", "ai_overview"],
  items: [
    { type: "local_pack", rank_group: 1, title: "Joe's Roofing LLC", domain: "joesroofing.com" },
    { type: "local_pack", rank_group: 2, title: "Sun Roofs" },
    { type: "organic", rank_group: 2, domain: "www.yelp.com", url: "https://www.yelp.com/x", title: "Top 10 Roofers" },
    { type: "organic", rank_group: 1, domain: "www.joesroofing.com", url: "https://www.joesroofing.com/roof-repair", title: "Roof Repair in Miami" },
    { type: "organic", rank_group: 3, domain: "sunroofs.com", url: "https://sunroofs.com/", title: "Sun Roofs" },
    { type: "people_also_ask", items: [{ title: "How much is a roof repair?" }, { title: "How much is a roof repair?" }] },
    { type: "paid", title: "Roof Repair Today", description: "Free estimate", domain: "www.ads-roof.com", url: "https://ads-roof.com/x", rank_absolute: 1 },
    { type: "paid", title: "Again", domain: "ads-roof.com", rank_absolute: 2 },
    null,
  ],
} as unknown as SerpResult;

describe("Ver quién sale ahora: palabra", () => {
  it("lee los primeros de Google, el mapa y lo que muestra", () => {
    const r = parseLookupSerp(SERP, "joesroofing.com", "Joe's Roofing");
    expect(r.top.map((x) => [x.position, x.domain, x.mine, x.directory])).toEqual([
      [1, "joesroofing.com", true, false],
      [2, "yelp.com", false, true],
      [3, "sunroofs.com", false, false],
    ]);
    expect(r.yourPosition).toBe(1);
    expect(r.localPack).toEqual({ names: ["Joe's Roofing LLC", "Sun Roofs"], you: 1 });
    expect(r.features).toEqual(["local_pack", "people_also_ask", "ai_overview", "ads"]);
    expect(r.questions).toEqual(["How much is a roof repair?"]);
    // Los anuncios, sin repetir el mismo anunciante.
    expect(r.ads).toEqual([{ position: 1, domain: "ads-roof.com", title: "Roof Repair Today", description: "Free estimate", url: "https://ads-roof.com/x" }]);
  });

  it("sin página web no marca nada como tuyo", () => {
    const r = parseLookupSerp(SERP, "", "Otro Negocio");
    expect(r.yourPosition).toBeNull();
    expect(r.localPack?.you).toBeNull();
    expect(parseLookupSerp(null, "", "")).toEqual({ top: [], yourPosition: null, localPack: null, features: [], questions: [], ads: [] });
  });

  it("normaliza la búsqueda para no pagar dos veces lo mismo", () => {
    expect(lookupKey("keyword", "  Reparación de Techos   MIAMI! ")).toBe("reparacion de techos miami");
    expect(lookupKeyword("  Reparación de Techos MIAMI!")).toBe("reparación de techos miami");
    expect(lookupKey("domain", "https://www.Competencia.com/servicios")).toBe("competencia.com");
    expect(lookupKey("domain", "no es dominio")).toBe("");
  });
});

describe("Ver quién sale ahora: página web", () => {
  it("lee domain_rank_overview", () => {
    const res = [
      {
        items: [
          {
            metrics: {
              organic: { pos_1: 11, pos_2_3: 28, pos_4_10: 100, pos_11_20: 135, etv: 3055.7, count: 1788, estimated_paid_traffic_cost: 15078.9, is_new: 661, is_lost: 547 },
              paid: { etv: 32.1, count: 11 },
            },
          },
        ],
      },
    ];
    expect(parseDomainOverview(res)).toEqual({ traffic: 3055.7, keywords: 1788, top3: 39, top10: 139, trafficValue: 15078.9, newKeywords: 661, lostKeywords: 547, paidKeywords: 11, paidTraffic: 32.1 });
    expect(parseDomainOverview([{ items: [] }])).toBeNull();
    expect(parseDomainOverview([{ items: [{ metrics: { organic: { etv: 5 } } }] }])).toMatchObject({ traffic: 5, top3: null, top10: null });
  });
});

describe("Búsquedas guardadas", () => {
  const kw = {
    type: "keyword",
    key: "roof repair miami",
    keyword: "roof repair miami",
    zone: { code: 1015116, name: "Miami,Florida,United States" },
    device: "mobile",
    ...parseLookupSerp(SERP, "joesroofing.com", "Joe's Roofing"),
    facts: { volume: 880, cpc: 31.2, difficulty: 38, intent: "transactional", trend: [1, 2], country: "United States" },
    notes: [{ es: "nota", en: "note" }, { es: 1 }],
    cost: 0.0141,
    createdAt: "2026-10-10T00:00:00.000Z",
  };
  const dom = { type: "domain", key: "sunroofs.com", domain: "sunroofs.com", country: "United States", overview: { traffic: 10 }, top: [{ keyword: "roof", position: 3, volume: 100, url: "u" }, { keyword: "", position: 1 }], competitors: [{ domain: "x.com", overlap: 3 }], notes: [], cost: 0.04, createdAt: "2026-10-10T00:00:00.000Z" };

  it("se leen sin confiar en su forma", () => {
    const k = readLookup(JSON.parse(JSON.stringify(kw)));
    expect(k?.type).toBe("keyword");
    if (k?.type === "keyword") {
      expect(k.top).toHaveLength(3);
      expect(k.facts).toMatchObject({ volume: 880, difficulty: 38, intent: "transactional", country: "United States" });
      expect(k.notes).toEqual([{ es: "nota", en: "note" }]);
    }
    const d = readLookup(dom);
    expect(d?.type).toBe("domain");
    if (d?.type === "domain") {
      expect(d.top).toHaveLength(1);
      expect(d.overview?.traffic).toBe(10);
      expect(d.overview?.keywords).toBeNull();
    }
    expect(readLookup({ type: "other", key: "x", createdAt: "y" })).toBeNull();
    expect(readLookup(null)).toBeNull();
  });

  it("encuentra la misma búsqueda aunque se escriba distinto", () => {
    const saved = [dom, kw];
    expect(findLookup(saved, "keyword", "Roof Repair  Miami")?.key).toBe("roof repair miami");
    expect(findLookup(saved, "domain", "https://www.sunroofs.com/")?.key).toBe("sunroofs.com");
    expect(findLookup(saved, "keyword", "otra cosa")).toBeNull();
    expect(findLookup(saved, "domain", "roof repair miami")).toBeNull();
  });

  it("una búsqueda guardada sirve por una semana", () => {
    const now = Date.parse("2026-10-14T00:00:00.000Z");
    expect(lookupFresh({ createdAt: "2026-10-10T00:00:00.000Z" }, now)).toBe(true);
    expect(lookupFresh({ createdAt: "2026-10-01T00:00:00.000Z" }, now)).toBe(false);
  });

  it("muestra lo que cuesta", () => {
    expect(keywordLookupCost()).toBe(0.015);
    // 3 llamadas (0.036) + 18 filas (0.00216) = 0.03816 → 0.039
    expect(domainLookupCost()).toBe(0.039);
  });
});
