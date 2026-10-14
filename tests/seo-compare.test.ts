import { describe, expect, it } from "vitest";
import { bestIn, compareCostEstimate, compareDomains, type CompareReport, type CompareRow, compareSummary, parseBulk, readCompareReport } from "@/lib/seo/compare";

const row = (domain: string, traffic: number | null, own = false, extra: Partial<CompareRow> = {}): CompareRow => ({
  domain,
  own,
  traffic,
  keywords: null,
  top3: null,
  top10: null,
  trafficValue: null,
  newKeywords: null,
  lostKeywords: null,
  paidKeywords: null,
  paidTraffic: null,
  rank: null,
  referringDomains: null,
  ...extra,
});

describe("Comparar páginas", () => {
  it("arma la lista: la tuya primero, sin repetir ni subdominios, máximo 5", () => {
    expect(compareDomains(["https://www.a.com/x", "A.com", "blog.a.com", "b.com", "no válido", "c.com", "d.com", "e.com", "f.com"], "https://mio.com")).toEqual(["mio.com", "a.com", "b.com", "c.com", "d.com"]);
    expect(compareDomains(["mio.com", "www.mio.com", "x.com"], "mio.com")).toEqual(["mio.com", "x.com"]);
    expect(compareDomains(["x.com"], null)).toEqual(["x.com"]);
  });

  it("lee las respuestas en lote de enlaces", () => {
    const ranks = parseBulk([{ items: [{ target: "a.com", rank: 312 }, { target: "https://www.b.com/", rank: 90 }, { target: "c.com", rank: null }, "x"] }], "rank");
    expect([...ranks]).toEqual([["a.com", 312], ["b.com", 90]]);
    const refs = parseBulk([{ items: [{ target: "a.com", referring_domains: 40, referring_main_domains: 30 }] }], "referring_domains");
    expect(refs.get("a.com")).toBe(40);
    expect(parseBulk([], "rank").size).toBe(0);
  });

  it("marca el mejor de cada columna (sin empates)", () => {
    const rows = [row("mio.com", 100, true), row("a.com", 300), row("b.com", null)];
    expect(bestIn(rows, "traffic")).toBe("a.com");
    expect(bestIn([row("a.com", 5), row("b.com", 5)], "traffic")).toBeNull();
    expect(bestIn(rows, "rank")).toBeNull();
  });

  it("resume en palabras cuánto te gana el más fuerte", () => {
    const base = { country: "United States", notes: [], cost: 0.1, createdAt: "2026-10-01T00:00:00.000Z" };
    const r: CompareReport = { ...base, rows: [row("mio.com", 100, true), row("a.com", 320), row("b.com", 150)] };
    expect(compareSummary(r)?.es).toBe("a.com recibe unas 3.2 veces tus visitas de Google.");
    expect(compareSummary({ ...base, rows: [row("mio.com", 400, true), row("a.com", 320)] })?.es).toMatch(/Tienes más visitas/);
    expect(compareSummary({ ...base, rows: [row("mio.com", 0, true), row("a.com", 320)] })?.es).toBe("a.com recibe más visitas de Google que tú.");
    expect(compareSummary({ ...base, rows: [row("a.com", 320)] })).toBeNull();
  });

  it("guarda y lee la comparación", () => {
    const r: CompareReport = { country: "US", rows: [row("mio.com", 100, true, { rank: 200 }), row("a.com", 320)], linksLocked: true, notes: [{ es: "n", en: "n" }], cost: 0.08, createdAt: "2026-10-01T00:00:00.000Z" };
    expect(readCompareReport(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(readCompareReport({ rows: [], createdAt: "x" })).toBeNull();
    expect(readCompareReport({ rows: [{ domain: "a.com" }] })).toBeNull();
  });

  it("calcula lo máximo que cuesta", () => {
    // 5 × (0.012 + 0.00012) + 2 × 0.024 + 10 × 0.000036 = 0.10896 → 0.109
    expect(compareCostEstimate(5)).toBe(0.109);
    expect(compareCostEstimate(2)).toBeLessThan(compareCostEstimate(5));
  });
});
