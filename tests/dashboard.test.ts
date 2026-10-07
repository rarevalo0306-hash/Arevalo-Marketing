import { describe, expect, it } from "vitest";
import { looksLikeDomain, toSeries, weeklyCounts } from "@/lib/dashboard";

describe("Tablero: buscador", () => {
  it("reconoce páginas web y palabras clave", () => {
    expect(looksLikeDomain("competencia.com")).toBe(true);
    expect(looksLikeDomain("https://www.cortinas.com.ni/precios")).toBe(true);
    expect(looksLikeDomain("www.ejemplo.com.ni")).toBe(true);
    expect(looksLikeDomain("cortinas metálicas managua")).toBe(false);
    expect(looksLikeDomain("precio 1.5 metros")).toBe(false);
    expect(looksLikeDomain("portones")).toBe(false);
    expect(looksLikeDomain("")).toBe(false);
  });
});

describe("Tablero: historia", () => {
  it("toSeries: del más nuevo al más viejo → valor actual, anterior e historia en orden", () => {
    const at = (d: number) => new Date(Date.UTC(2026, 9, d));
    const s = toSeries([
      { value: 74, at: at(6) },
      { value: null, at: at(4) },
      { value: 66, at: at(2) },
      { value: 58, at: at(1) },
    ]);
    expect(s.now).toBe(74);
    expect(s.prev).toBe(66);
    expect(s.history).toEqual([58, 66, 74]);
    expect(s.at).toEqual(at(6));
    expect(toSeries([]).now).toBeNull();
  });

  it("weeklyCounts: cuenta por semana (la última es la de ahora)", () => {
    const now = new Date(Date.UTC(2026, 9, 7, 12));
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
    expect(weeklyCounts([ago(1), ago(2), ago(9), ago(60), ago(-1)], now, 4)).toEqual([0, 0, 1, 2]);
  });
});
