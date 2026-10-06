import { describe, expect, it } from "vitest";
import { readKeywordsReport } from "@/lib/seo/keywords";
import { readMapReport, type MapReport } from "@/lib/seo/maprank";
import { readRankReport, type RankReport } from "@/lib/seo/rank";
import {
  aiChange,
  aiShare,
  aiVerdict,
  CTR_CURVE,
  CTR_TOTAL,
  ctrAt,
  groupNewestFirst,
  latestMaps,
  mapChange,
  mapShare,
  mapVerdict,
  organicChange,
  organicShare,
  organicVerdict,
  pctText,
} from "@/lib/seo/sov";
import { readVisibilityReport } from "@/lib/seo/visibility";
import fameseg from "./fixtures/fameseg.json";

const website = fameseg.business.website;
const rank = readRankReport(fameseg.reports.rank.data)!;
const keywords = readKeywordsReport(fameseg.reports.keywords.data)!;
const ai = readVisibilityReport(fameseg.reports.ai.data)!;

describe("curva de clics", () => {
  it("sigue la curva documentada y suma los 20 primeros", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(ctrAt)).toEqual([0.28, 0.15, 0.11, 0.08, 0.07, 0.05, 0.04, 0.03, 0.03, 0.025]);
    expect(ctrAt(11)).toBe(0.01);
    expect(ctrAt(20)).toBe(0.003);
    expect(ctrAt(21)).toBe(0);
    expect(ctrAt(null)).toBe(0);
    expect(ctrAt(0)).toBe(0);
    // Del 11 al 20 va bajando.
    for (let i = 10; i < 19; i++) expect(CTR_CURVE[i + 1]).toBeLessThan(CTR_CURVE[i]);
    expect(CTR_TOTAL).toBeCloseTo(0.925, 6);
  });

  it("muestra porcentajes enteros y <1% para los muy chicos", () => {
    expect(pctText(0.1069)).toBe("11%");
    expect(pctText(0.003)).toBe("<1%");
    expect(pctText(0)).toBe("0%");
  });
});

describe("Google: tu parte de los clics (Fameseg)", () => {
  // Pesos: "cortinas metálicas managua" 40 búsquedas, "mantenimiento…" 10; las otras 3 sin dato → 5 cada una. Total 65.
  const s = organicShare([rank], { website, keywords: [keywords] })!;

  it("pesa cada búsqueda por las búsquedas al mes", () => {
    expect(s.weighting).toBe("volume");
    expect(s.keywords).toBe(5);
    // Fameseg: 2.º en la de 40 (15 %), 4.º en una de 5 (8 %) y 15.º en otra de 5 (0.6 %) → 6.43 / (65 × 0.925).
    expect(s.you).toBeCloseTo(6.43 / 60.125, 6);
    expect(pctText(s.you)).toBe("11%");
  });

  it("junta directorios y redes y suma 100 %", () => {
    // Facebook, Instagram, Páginas Amarillas, Waze, Encuentra24 y DireDi: 36.25 de 60.125.
    expect(s.directories).toBeCloseTo(36.25 / 60.125, 6);
    expect(s.directoryNames[0]).toBe("facebook.com");
    expect(s.competitors.map((c) => c.label)).toEqual(["cortinasmetalicasurgentes.com", "arteytecnica.com", "portoneselectricosbasilio.com", "cormetal.com.ni"]);
    expect(s.competitors.some((c) => c.label === "facebook.com" || c.label === "fameseg.com")).toBe(false);
    const sum = s.you + s.directories + s.others + s.competitors.reduce((a, c) => a + c.share, 0);
    expect(sum).toBeCloseTo(1, 9);
    expect(s.others).toBeGreaterThan(0.2);
  });

  it("dice en una línea cómo vas", () => {
    expect(organicVerdict(s).es).toBe("Te llevas el 11% de los clics posibles en tus búsquedas: más que cualquier competidor (los directorios y redes se llevan el 60%).");
    expect(organicVerdict({ ...s, directories: 0.05 }).en).toBe("You get 11% of the possible clicks on your searches: more than any competitor.");
    const behind = { ...s, you: 0.12, leader: { key: "cortyport.com", label: "cortyport.com", share: 0.25 } };
    expect(organicVerdict(behind).es).toBe("Te llevas el 12% de los clics posibles en tus búsquedas; cortyport.com se lleva el 25%.");
    expect(organicVerdict({ ...behind, you: 0 }).en).toContain("You don't get clicks");
  });

  it("sin reporte de palabras clave todas las búsquedas pesan igual", () => {
    const eq = organicShare([rank], { website })!;
    expect(eq.weighting).toBe("equal");
    expect(eq.you).toBeCloseTo((0.15 + 0.08 + 0.006) / (5 * 0.925), 6);
  });

  it("vacío: sin reportes o con todas las búsquedas fallidas", () => {
    expect(organicShare([], { website })).toBeNull();
    const failed: RankReport = { ...rank, rows: rank.rows.map((r) => ({ ...r, error: { es: "x", en: "x" } })) };
    expect(organicShare([failed], { website })).toBeNull();
  });

  it("compara con la revisión anterior solo en las palabras que están en las dos", () => {
    // Antes Fameseg estaba 5.º en "cortinas metálicas managua" y no estaba en "cortinas tubulares".
    const before: RankReport = {
      ...rank,
      rows: rank.rows.map((r) =>
        r.keyword === "cortinas metálicas managua"
          ? { ...r, position: 5, top: r.top.filter((t) => t.domain !== "fameseg.com") }
          : r.keyword === "cortinas tubulares managua"
            ? { ...r, position: null, top: r.top.filter((t) => t.domain !== "fameseg.com") }
            : r,
      ),
    };
    const change = organicChange([[rank, before]], { website, keywords: [keywords] })!;
    // Ahora 6.43 de 60.125 (10.7 %); antes 40 × 7 % + 5 × 0.6 % = 2.83 (4.7 %) → +6 puntos.
    expect(change).toBeCloseTo(Math.round(((6.43 - 2.83) / 60.125) * 1000) / 10, 6);
    // Una palabra nueva (que antes no se revisaba) no cuenta en el cambio.
    const withNew: RankReport = { ...rank, rows: [...rank.rows, { keyword: "nueva", position: 1, url: null, localPack: null, top: [{ position: 1, domain: "fameseg.com", title: "", url: "" }], features: [] }] };
    expect(organicChange([[withNew, before]], { website, keywords: [keywords] })).toBe(change);
    expect(organicChange([[rank]], { website })).toBeNull();
  });

  it("suma varias zonas", () => {
    const other: RankReport = { ...rank, locationCode: 1234, rows: rank.rows.slice(0, 1) };
    const both = organicShare([rank, other], { website, keywords: [keywords] })!;
    // La zona 1234 no tiene reporte de palabras: usa las búsquedas de la zona principal.
    expect(both.keywords).toBe(6);
    expect(both.you).toBeCloseTo((6.43 + 6) / ((65 + 40) * 0.925), 6);
  });
});

describe("Google Maps: en qué parte del mapa sales en el top 3", () => {
  const point = (rank: number | null, top3: string[]) => ({ lat: 12.1, lng: -86.2, rank, top3: top3.map((title, i) => ({ title, rank: i + 1 })) });
  const map = (keyword: string, points: ReturnType<typeof point>[], createdAt = "2026-10-06T00:00:00Z") =>
    readMapReport({ keyword, place: { title: "Fameseg", cid: "" }, center: { lat: 12.1, lng: -86.2 }, size: 2, spacingKm: 1, points, createdAt }) as MapReport;
  const now = map("cortinas metálicas", [
    point(1, ["Fameseg", "CortyPort Industrial", "Metalfa"]),
    point(4, ["CortyPort Industrial", "Metalfa", "INDUMECAR"]),
    point(2, ["CortyPort Industrial", "Fameseg", "Metalfa"]),
    point(null, ["CortyPort Industrial", "INDUMECAR", "Metalfa"]),
  ]);

  it("cuenta los puntos donde sale cada negocio en el top 3", () => {
    const s = mapShare([now])!;
    expect(s.points).toBe(4);
    expect(s.youPoints).toBe(2);
    expect(s.you).toBe(0.5);
    expect(s.competitors.map((c) => [c.label, c.points])).toEqual([
      ["CortyPort Industrial", 4],
      ["Metalfa", 4],
      ["INDUMECAR", 2],
    ]);
    expect(mapVerdict(s).es).toBe("Sales entre los 3 primeros en el 50% del mapa; CortyPort Industrial en el 100%.");
  });

  it("usa el último mapa de cada búsqueda y compara con el anterior", () => {
    const old = map("Cortinas metálicas ", [point(5, ["CortyPort Industrial", "Metalfa", "INDUMECAR"]), point(null, ["A", "B", "C"]), point(2, ["X", "Fameseg", "Y"]), point(9, ["A", "B", "C"])]);
    const other = map("portones", [point(3, ["A", "B", "Fameseg"])]);
    const { latest, pairs } = latestMaps([now, other, old]);
    expect(latest).toEqual([now, other]);
    expect(pairs).toEqual([[now, old]]);
    // Ahora 2 de 4, antes 1 de 4 → +25 puntos.
    expect(mapChange(pairs)).toBe(25);
    expect(mapChange([])).toBeNull();
    expect(mapShare(latest)!.points).toBe(5);
  });

  it("vacío: sin mapas o con todos los puntos fallidos", () => {
    expect(mapShare([])).toBeNull();
    const failed = { ...now, points: now.points.map((p) => ({ ...p, error: { es: "x", en: "x" } })) };
    expect(mapShare([failed])).toBeNull();
  });
});

describe("IAs: tu parte de las menciones (Fameseg)", () => {
  const s = aiShare(ai)!;

  it("cuenta tus menciones contra las de los competidores", () => {
    // ChatGPT contestó 5 (Gemini llegó a su límite): te nombra en 4 y nombra 20 veces a otros negocios.
    expect(s.answers).toBe(5);
    expect(s.youMentions).toBe(4);
    expect(s.mentions).toBe(24);
    expect(s.you).toBeCloseTo(4 / 24, 9);
    expect(s.leader).toMatchObject({ label: "Inmenicsa", count: 4 });
    // "Metalníca S.A." y "Metalníca" son el mismo negocio.
    expect(s.competitors.find((c) => c.label.startsWith("Metalníca"))?.count).toBe(2);
    expect(s.you + s.others + s.competitors.reduce((a, c) => a + c.share, 0)).toBeCloseTo(1, 9);
    expect(aiVerdict(s).es).toBe("Te llevas el 17% de las menciones de negocios en las IAs, igual que Inmenicsa.");
  });

  it("por IA: solo las que contestaron", () => {
    expect(s.byProvider).toEqual([{ provider: "openai", you: 4 / 24, mentions: 24, answers: 5 }]);
  });

  it("compara con la revisión anterior", () => {
    const before = { ...ai, results: ai.results.map((r, i) => (i === 1 ? { ...r, mentioned: false } : r)) };
    // Antes 3 de 23.
    expect(aiChange(ai, before)).toBe(Math.round((4 / 24 - 3 / 23) * 1000) / 10);
    expect(aiChange(ai, null)).toBeNull();
  });

  it("vacío: sin respuestas o sin negocios nombrados", () => {
    expect(aiShare({ ...ai, results: ai.results.filter((r) => r.error) })).toBeNull();
    const none = aiShare({ ...ai, results: ai.results.map((r) => ({ ...r, mentioned: false, competitors: [] })) })!;
    expect(none.mentions).toBe(0);
    expect(none.you).toBe(0);
    expect(aiVerdict(none).es).toBe("Las IAs no nombraron ningún negocio en sus respuestas.");
  });
});

describe("groupNewestFirst", () => {
  it("agrupa manteniendo el orden y salta los vacíos", () => {
    const g = groupNewestFirst([{ z: 1, n: "a" }, null, { z: 2, n: "b" }, { z: 1, n: "c" }], (r) => r.z);
    expect([...g.entries()]).toEqual([
      [1, [{ z: 1, n: "a" }, { z: 1, n: "c" }]],
      [2, [{ z: 2, n: "b" }]],
    ]);
  });
});
