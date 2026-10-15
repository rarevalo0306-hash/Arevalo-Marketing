import { describe, expect, it } from "vitest";
import type { RankRow } from "@/lib/seo/rank";
import { sensorAdvice, sensorLevel, sensorPoints, serpChange, serpMoves } from "@/lib/seo/sensor";

const top = (...domains: string[]) => domains.map((domain, i) => ({ position: i + 1, domain, title: "", url: "" }));
const row = (keyword: string, t: ReturnType<typeof top>, extra: Partial<RankRow> = {}): RankRow => ({ keyword, position: null, url: null, localPack: null, top: t, features: [], ...extra });

describe("¿Se movió Google?", () => {
  it("mide cuánto cambiaron los 5 primeros (0 a 10)", () => {
    expect(serpChange(row("a", top("a.com", "b.com", "c.com", "d.com", "e.com")), row("a", top("a.com", "b.com", "c.com", "d.com", "e.com")))).toBe(0);
    // Cambian por completo: 10.
    expect(serpChange(row("a", top("a.com", "b.com", "c.com", "d.com", "e.com")), row("a", top("f.com", "g.com", "h.com", "i.com", "j.com")))).toBe(10);
    // Se cambian de lugar el 1 y el 2: |1-2| + |2-1| = 2 de 30 → 0.7.
    expect(serpChange(row("a", top("a.com", "b.com", "c.com")), row("a", top("b.com", "a.com", "c.com")))).toBe(0.7);
    expect(serpChange(row("a", []), row("a", top("a.com")))).toBeNull();
  });

  it("dice qué entró y qué salió", () => {
    expect(serpMoves(row("a", top("a.com", "b.com")), row("a", top("a.com", "c.com")))).toEqual({ entered: ["c.com"], left: ["b.com"] });
  });

  it("arma un punto por cada par de revisiones (del más viejo al más nuevo)", () => {
    const r1 = { createdAt: "2026-10-01T10:00:00.000Z", rows: [row("techos", top("a.com", "b.com", "c.com", "d.com", "e.com")), row("goteras", top("x.com"))] };
    const r2 = { createdAt: "2026-10-02T10:00:00.000Z", rows: [row("techos", top("a.com", "b.com", "c.com", "d.com", "e.com")), row("goteras", top("y.com")), row("nueva", top("z.com"))] };
    const r3 = { createdAt: "2026-10-09T10:00:00.000Z", rows: [row("techos", top("f.com", "g.com", "h.com", "i.com", "j.com")), row("goteras", [], { error: { es: "x", en: "x" } })] };
    const points = sensorPoints([r3, r2, r1]);
    expect(points.map((p) => [p.at.slice(0, 10), p.days, p.keywords, p.score])).toEqual([
      // techos 0 y goteras: x.com sale del 1 (|1-6| = 5) y entra y.com (5) → 10/30 → 3.3; promedio 1.7
      ["2026-10-02", 1, 2, 1.7],
      ["2026-10-09", 7, 1, 10],
    ]);
    expect(points[0].moved).toEqual([{ keyword: "goteras", score: 3.3, entered: ["y.com"], left: ["x.com"] }]);
    expect(sensorPoints([r1])).toEqual([]);
  });

  it("niveles y consejo como Semrush Sensor", () => {
    expect([0, 1.9, 2, 4.9, 5, 7.9, 8, 10].map(sensorLevel)).toEqual(["calm", "calm", "normal", "normal", "high", "high", "very-high", "very-high"]);
    const shaky = { at: "x", days: 1, score: 8.5, keywords: 3, moved: [] };
    const calm = { ...shaky, score: 0.5 };
    expect(sensorAdvice(shaky, true).es).toMatch(/espera unos días/);
    expect(sensorAdvice(shaky, false).es).toMatch(/Vigila/);
    expect(sensorAdvice(calm, true).es).toMatch(/competidor/);
    expect(sensorAdvice(calm, false).es).toMatch(/tranquilo/);
    expect(sensorAdvice({ ...calm, score: 3 }, true).es).toMatch(/^Google se movió lo normal pero bajaste/);
  });
});
