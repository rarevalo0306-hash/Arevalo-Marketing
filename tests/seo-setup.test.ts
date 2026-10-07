import { describe, expect, it } from "vitest";
import { rankEveryDays, rankIsDue } from "@/lib/seo/rank";
import { guessCountry, plainKeywords } from "@/lib/seo/setup";
import { asFrequency, checkCost, keywordExample, monthlyRankCost, normKeyword, usd, zoneCountry, zoneTypeLabel } from "@/lib/seo/setup-shared";

const H = 3600_000;
const D = 24 * H;

describe("revisión automática de posiciones", () => {
  it("usa 1, 7, 15 o 30 días; otro valor = 7", () => {
    expect(rankEveryDays(1)).toBe(1);
    expect(rankEveryDays(15)).toBe(15);
    expect(rankEveryDays(30)).toBe(30);
    expect(rankEveryDays(3)).toBe(7);
    expect(rankEveryDays(null)).toBe(7);
  });

  it("toca cuando la última revisión tiene más de N días (con 4 horas de margen)", () => {
    const now = 100 * D;
    expect(rankIsDue(0, 7, now)).toBe(true); // nunca se revisó
    expect(rankIsDue(now - 21 * H, 1, now)).toBe(true);
    expect(rankIsDue(now - 19 * H, 1, now)).toBe(false);
    expect(rankIsDue(now - 6 * D, 7, now)).toBe(false);
    expect(rankIsDue(now - 7 * D + 3 * H, 7, now)).toBe(true);
    expect(rankIsDue(now - 10 * D, 15, now)).toBe(false);
    expect(rankIsDue(now - 29 * D, 30, now)).toBe(false);
    expect(rankIsDue(now - 30 * D, 30, now)).toBe(true);
  });
});

describe("frecuencia y costos", () => {
  it("apagado si seoDaily es false; si no, los días guardados", () => {
    expect(asFrequency(false, 1)).toBe(0);
    expect(asFrequency(true, 1)).toBe(1);
    expect(asFrequency(true, 15)).toBe(15);
    expect(asFrequency(true, 4)).toBe(7);
  });

  it("costo al mes = palabras × zonas × precio × revisiones al mes", () => {
    expect(checkCost(10, 3, 0.0035)).toBeCloseTo(0.105);
    expect(monthlyRankCost(1, 10, 3, 0.0035)).toBeCloseTo(3.15);
    expect(monthlyRankCost(7, 10, 3, 0.0035)).toBeCloseTo(0.45);
    expect(monthlyRankCost(30, 10, 3, 0.0035)).toBeCloseTo(0.105);
    expect(monthlyRankCost(0, 10, 3, 0.0035)).toBe(0);
    // Sin zonas todavía se calcula como una zona.
    expect(checkCost(10, 0, 0.0035)).toBeCloseTo(0.035);
  });

  it("dinero en palabras simples", () => {
    expect(usd(0.21, "es")).toBe("US$0.21");
    expect(usd(0.004, "es")).toBe("menos de 1 centavo");
    expect(usd(12.4, "en")).toBe("US$12");
  });
});

describe("zonas", () => {
  it("país de una zona guardada y tipo en palabras", () => {
    expect(zoneCountry("Miami-Dade County,Florida,United States")).toBe("us");
    expect(zoneCountry("Managua,Managua,Nicaragua")).toBe("ni");
    expect(zoneCountry("Atlantis")).toBeNull();
    expect(zoneTypeLabel("County", "es")).toBe("Condado");
    expect(zoneTypeLabel("Department", "en")).toBe("Department");
  });

  it("adivina el país por el perfil", () => {
    expect(guessCountry("Firma en Miami. Zona: Miami-Dade, Broward, Palm Beach y toda Florida.", [])).toBe("us");
    expect(guessCountry("Cortinas en Managua, Nicaragua", [])).toBe("ni");
    expect(guessCountry("cualquier cosa", [{ code: 2558, name: "Nicaragua" }])).toBe("ni");
  });
});

describe("palabras propuestas sin IA", () => {
  it("mezcla Search Console, estudio e ideas, sin repetir ni lo rechazado ni lo que ya sigue", () => {
    const list = plainKeywords(
      { gsc: ["public adjuster miami", "Ajustador Público Miami"], study: ["ajustador público miami", "reclamo de techo miami", "daños por agua"], ideas: [{ keyword: "public adjuster near me", volume: 880 }] },
      new Set(["daños por agua"]),
      new Set(["reclamo de techo miami"]),
    );
    expect(list.map((k) => k.keyword)).toEqual(["public adjuster miami", "ajustador público miami", "public adjuster near me"]);
    expect(list[0].source).toBe("search_console");
    expect(list[2]).toMatchObject({ source: "google_ideas", volume: 880 });
  });

  it("el ejemplo sale del propio negocio o es genérico (nunca de otro negocio)", () => {
    expect(keywordExample(["public adjuster miami"], "en")).toBe("public adjuster miami");
    expect(keywordExample([], "es")).toBe("tu servicio + tu ciudad");
    expect(normKeyword("  Public   Adjuster MIAMI ")).toBe("public adjuster miami");
  });
});
