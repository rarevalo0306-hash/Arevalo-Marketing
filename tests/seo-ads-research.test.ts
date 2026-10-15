import { describe, expect, it } from "vitest";
import { adsCostEstimate, advertisersFrom, dfsTime, hasSavedAds, parsePaidKeywords, parseTransparency, pickAdCompetitors, readAdsReport } from "@/lib/seo/ads-research";
import type { RankRow } from "@/lib/seo/rank";

const row = (keyword: string, ads?: RankRow["ads"]): RankRow => ({ keyword, position: null, url: null, localPack: null, top: [], features: [], ...(ads ? { ads } : {}) });
const ad = (domain: string, title: string, position = 1) => ({ position, domain, title, description: `${title} desc`, url: `https://${domain}/` });

describe("Anuncios de tu competencia", () => {
  it("junta quién anuncia en tus búsquedas (sin tu página ni textos repetidos)", () => {
    const reports = [
      { rows: [row("techos miami", [ad("rivalroof.com", "Techos 24/7"), ad("mipagina.com", "Yo")]), row("goteras", [ad("www.rivalroof.com", "Techos 24/7"), ad("otro.com", "Otro")])] },
      { rows: [row("canaletas", [ad("rivalroof.com", "Canaletas hoy", 2)]), { ...row("x", [ad("z.com", "z")]), error: { es: "x", en: "x" } }] },
    ];
    const list = advertisersFrom(reports, "https://mipagina.com");
    expect(list.map((a) => [a.domain, a.keywords, a.ads.map((x) => x.title)])).toEqual([
      ["rivalroof.com", ["techos miami", "goteras", "canaletas"], ["Techos 24/7", "Canaletas hoy"]],
      ["otro.com", ["goteras"], ["Otro"]],
    ]);
    expect(hasSavedAds([{ rows: [row("a")] }])).toBe(false);
    expect(hasSavedAds([{ rows: [row("a", [])] }])).toBe(true);
  });

  it("lee las búsquedas pagadas de ranked_keywords", () => {
    const res = [
      {
        total_count: 120,
        metrics: { paid: { count: 118, etv: 340.5, estimated_paid_traffic_cost: 2900.2 } },
        items: [
          { keyword_data: { keyword: "Roof Repair Miami", keyword_info: { search_volume: 880, cpc: 31.5 } }, ranked_serp_element: { serp_item: { type: "paid", rank_group: 1, title: "Roof Repair  Miami", description: "Free estimate", url: "https://rival.com/x" } } },
          { keyword_data: { keyword: "roof repair miami" }, ranked_serp_element: { serp_item: {} } },
          { keyword_data: {} },
        ],
      },
    ];
    expect(parsePaidKeywords(res)).toEqual({
      paidKeywords: 118,
      paidTraffic: 340.5,
      paidCost: 2900.2,
      keywords: [{ keyword: "roof repair miami", position: 1, volume: 880, cpc: 31.5, title: "Roof Repair Miami", description: "Free estimate", url: "https://rival.com/x" }],
    });
    expect(parsePaidKeywords([])).toEqual({ paidKeywords: null, paidTraffic: null, paidCost: null, keywords: [] });
  });

  it("lee el Centro de Transparencia y cuenta los anuncios recientes", () => {
    const now = Date.parse("2026-10-14T00:00:00Z");
    const res = [
      {
        items_count: 3,
        items: [
          { type: "ads_search", title: "Rival Roofing LLC", format: "text", preview_image: { url: "https://tpc.googlesyndication.com/a.png" }, url: "https://adstransparency.google.com/advertiser/AR1/creative/CR1", first_shown: "2026-09-01 10:00:00 +00:00", last_shown: "2026-10-10 10:00:00 +00:00" },
          { type: "ads_search", format: "image", preview_image: { url: "https://tpc.googlesyndication.com/b.png" }, url: "https://adstransparency.google.com/x", first_shown: "2025-01-01 10:00:00 +00:00", last_shown: "2025-02-01 10:00:00 +00:00" },
          { type: "ads_search", format: "video" },
        ],
      },
    ];
    const tr = parseTransparency(res, now);
    expect(tr.advertiser).toBe("Rival Roofing LLC");
    expect(tr.total).toBe(3);
    expect(tr.recent).toBe(1);
    expect(tr.ads.map((a) => a.preview)).toEqual(["https://tpc.googlesyndication.com/a.png", "https://tpc.googlesyndication.com/b.png"]);
    expect(dfsTime("2026-10-10 10:00:00 +00:00")).toBe("2026-10-10T10:00:00.000Z");
    expect(dfsTime("nada")).toBeNull();
  });

  it("elige a quién revisar: lo escrito, la competencia y los que más anuncian; sin directorios ni tu página", () => {
    expect(
      pickAdCompetitors({
        typed: ["https://www.rival.com/x", ""],
        competitors: ["yelp.com", "rival.com", "dos.com"],
        advertisers: [{ domain: "mipagina.com", keywords: [], ads: [] }, { domain: "tres.com", keywords: [], ads: [] }, { domain: "cuatro.com", keywords: [], ads: [] }],
        self: "mipagina.com",
      }),
    ).toEqual(["rival.com", "dos.com", "tres.com"]);
  });

  it("guarda el reporte sin aceptar enlaces raros y calcula el costo", () => {
    const r = {
      country: "United States",
      competitors: [{ domain: "rival.com", paidKeywords: 10, paidTraffic: 5, paidCost: 100, keywords: [], transparency: { advertiser: "Rival", total: 2, recent: 1, ads: [{ format: "text", preview: "javascript:alert(1)", url: "https://adstransparency.google.com/x", firstShown: null, lastShown: null }] }, ok: true }],
      notes: [],
      cost: 0.04,
      createdAt: "2026-10-14T00:00:00.000Z",
    };
    const back = readAdsReport(r);
    expect(back?.competitors[0].transparency?.ads[0].preview).toBe("");
    expect(back?.competitors[0].transparency?.ads[0].url).toBe("https://adstransparency.google.com/x");
    expect(readAdsReport({})).toBeNull();
    // 3 × (0.012 + 20 × 0.00012 + 0.002) = 0.0492 → 0.05
    expect(adsCostEstimate(3)).toBe(0.05);
  });
});
