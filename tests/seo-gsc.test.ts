import { describe, expect, it } from "vitest";
import { asGscReport, findLowCtr, findOpportunities, gscRanges, matchSite, siteHost, type GscRow } from "@/lib/seo/gsc";

describe("siteHost", () => {
  it("quita protocolo, www y ruta", () => {
    expect(siteHost("https://www.Panaderia.com/menu")).toBe("panaderia.com");
    expect(siteHost("panaderia.com")).toBe("panaderia.com");
    expect(siteHost("")).toBeNull();
  });
});

describe("matchSite", () => {
  it("prefiere la propiedad de dominio sobre la de prefijo de URL", () => {
    const sites = ["https://www.panaderia.com/", "sc-domain:panaderia.com", "https://otra.com/"];
    expect(matchSite("https://www.panaderia.com", sites)).toBe("sc-domain:panaderia.com");
  });

  it("una propiedad de dominio cubre www y subdominios", () => {
    expect(matchSite("http://www.panaderia.com", ["sc-domain:panaderia.com"])).toBe("sc-domain:panaderia.com");
    expect(matchSite("https://tienda.panaderia.com", ["sc-domain:panaderia.com"])).toBe("sc-domain:panaderia.com");
    expect(matchSite("https://panaderia.com.mx", ["sc-domain:panaderia.com"])).toBeNull();
  });

  it("acepta prefijo de URL con o sin www", () => {
    expect(matchSite("panaderia.com", ["https://www.panaderia.com/"])).toBe("https://www.panaderia.com/");
    expect(matchSite("https://www.panaderia.com", ["https://panaderia.com/"])).toBe("https://panaderia.com/");
  });

  it("prefiere el mismo www que la página cuando hay los dos", () => {
    const sites = ["https://panaderia.com/", "https://www.panaderia.com/"];
    expect(matchSite("https://www.panaderia.com", sites)).toBe("https://www.panaderia.com/");
    expect(matchSite("https://panaderia.com", sites)).toBe("https://panaderia.com/");
  });

  it("prefiere https sobre http y acepta http si es lo único", () => {
    expect(matchSite("panaderia.com", ["http://panaderia.com/", "https://panaderia.com/"])).toBe("https://panaderia.com/");
    expect(matchSite("https://panaderia.com", ["http://panaderia.com/"])).toBe("http://panaderia.com/");
  });

  it("prefiere la raíz y solo usa una subcarpeta si la página está dentro", () => {
    expect(matchSite("https://panaderia.com/blog", ["https://panaderia.com/blog/", "https://panaderia.com/"])).toBe("https://panaderia.com/");
    expect(matchSite("https://panaderia.com/blog/x", ["https://panaderia.com/blog/"])).toBe("https://panaderia.com/blog/");
    expect(matchSite("https://panaderia.com", ["https://panaderia.com/blog/"])).toBeNull();
  });

  it("no coincide con otros dominios ni sin página", () => {
    expect(matchSite("https://panaderia.com", ["https://otra.com/", "sc-domain:otra.com"])).toBeNull();
    expect(matchSite("", ["sc-domain:panaderia.com"])).toBeNull();
  });
});

const row = (key: string, position: number, impressions: number, clicks = 0): GscRow => ({
  key,
  position,
  impressions,
  clicks,
  ctr: impressions ? clicks / impressions : 0,
});

describe("findOpportunities", () => {
  it("toma posiciones 4–20 con al menos 20 impresiones, de más a menos impresiones", () => {
    const rows = [
      row("arriba", 2, 500, 50),
      row("casi", 6.4, 120, 2),
      row("pagina dos", 15, 300, 1),
      row("muy lejos", 35, 900),
      row("pocas", 8, 19),
      row("borde 4", 4, 20),
      row("borde 20", 20, 40),
      row("pasado 20", 20.1, 40),
    ];
    expect(findOpportunities(rows).map((r) => r.key)).toEqual(["pagina dos", "casi", "borde 20", "borde 4"]);
  });

  it("respeta el límite", () => {
    const rows = Array.from({ length: 15 }, (_, i) => row(`q${i}`, 8, 100 + i));
    expect(findOpportunities(rows, 3).map((r) => r.key)).toEqual(["q14", "q13", "q12"]);
  });
});

describe("findLowCtr", () => {
  it("toma posiciones ≤ 5 con CTR menor a 2 %", () => {
    const rows = [row("bien", 2, 200, 30), row("sin clics", 3, 400, 2), row("justo 2%", 1, 100, 2), row("abajo", 9, 500, 0), row("pocas", 2, 10, 0)];
    expect(findLowCtr(rows).map((r) => r.key)).toEqual(["sin clics"]);
  });
});

describe("gscRanges", () => {
  it("termina hace 3 días y compara con los 28 días anteriores", () => {
    const { range, previousRange } = gscRanges(new Date("2026-10-06T15:00:00Z"));
    expect(range).toEqual({ start: "2026-09-06", end: "2026-10-03" });
    expect(previousRange).toEqual({ start: "2026-08-09", end: "2026-09-05" });
  });
});

describe("asGscReport", () => {
  it("lee reportes viejos o incompletos sin romperse", () => {
    expect(asGscReport(null)).toBeNull();
    expect(asGscReport({ foo: 1 })).toBeNull();
    const r = asGscReport({ totals: { clicks: "x", impressions: 10 }, queries: [{ key: "pan", clicks: 1 }, null] });
    expect(r?.totals).toEqual({ clicks: 0, impressions: 10, ctr: 0, position: 0 });
    expect(r?.queries[0]).toEqual({ key: "pan", clicks: 1, impressions: 0, ctr: 0, position: 0 });
    expect(r?.pages).toEqual([]);
  });
});
