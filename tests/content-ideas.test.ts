import { describe, expect, it } from "vitest";
import { noRepeat } from "@/lib/ai";
import { isBilingual, joinBilingual } from "@/lib/bilingual";
import { buildIdeas, type IdeaInput, ideasBasis, pickDaily, postedRecently } from "@/lib/content-ideas";
import type { RankReport } from "@/lib/seo/rank";

const rank = (rows: { keyword: string; position: number | null }[]): RankReport => ({
  location: "Nicaragua",
  locationCode: 2558,
  language: "es",
  device: "mobile",
  rows: rows.map((r) => ({ ...r, url: null, localPack: null, top: [], features: [] })),
  cost: 0,
  createdAt: "2026-10-01T00:00:00Z",
  avgPosition: null,
  inTop3: 0,
  inTop10: 0,
  visibility: 0,
});

const base = (over: Partial<IdeaInput> = {}): IdeaInput => ({
  lang: "es",
  businessName: "Fameseg",
  aiProfile: "Cortinas metálicas en Managua",
  tracked: [],
  vocab: [],
  rank: [],
  volumes: new Map(),
  keywords: null,
  gap: [],
  questions: [],
  decay: [],
  maps: [],
  gsc: [],
  study: null,
  recent: [],
  month: 10,
  ...over,
});

describe("buildIdeas", () => {
  it("pone primero lo que más buscan y donde no sales, con el porqué", () => {
    const ideas = buildIdeas(
      base({
        rank: [rank([{ keyword: "cortinas metálicas managua", position: 2 }, { keyword: "portones automáticos nicaragua", position: null }, { keyword: "cortinas tubulares managua", position: 6 }])],
        volumes: new Map([["portones automaticos nicaragua", 320]]),
      }),
    );
    expect(ideas[0].topic).toBe("Portones automáticos nicaragua");
    expect(ideas[0].why).toBe("La buscan 320 veces al mes y no sales en Google");
    expect(ideas[0].idea).toContain("«portones automáticos nicaragua»");
    // En el top 3 no hace falta empujar.
    expect(ideas.some((x) => x.keyword === "cortinas metálicas managua")).toBe(false);
    expect(ideas.find((x) => x.keyword === "cortinas tubulares managua")?.source).toBe("near");
    expect(ideasBasis(ideas)).toBe("seo");
  });

  it("quita lo que ya se publicó en los últimos días y las búsquedas de otra cosa", () => {
    const ideas = buildIdeas(
      base({
        rank: [rank([{ keyword: "portones automáticos nicaragua", position: null }])],
        gap: [{ keyword: "gas cerca de mí", volume: 5400, cpc: null, difficulty: 0, intent: null, yourPosition: null, competitors: [], type: "missing", opportunity: 90 }],
        vocab: ["cortin", "porton", "metalic"],
        recent: ["¡Nuevos portones automáticos en Nicaragua! Abre desde tu celular."],
      }),
    );
    expect(ideas.some((x) => x.keyword === "portones automáticos nicaragua")).toBe(false);
    expect(ideas.some((x) => x.keyword === "gas cerca de mí")).toBe(false);
    // Siempre queda algo (temporada / general).
    expect(ideas.length).toBeGreaterThan(0);
    expect(ideasBasis(ideas)).toBe("season");
  });

  it("no repite la misma búsqueda de dos fuentes", () => {
    const ideas = buildIdeas(
      base({
        rank: [rank([{ keyword: "cortinas tubulares managua", position: 14 }])],
        gsc: [{ key: "cortinas tubulares en managua", clicks: 0, impressions: 200, ctr: 0, position: 14 }],
      }),
    );
    expect(ideas.filter((x) => /tubular/i.test(x.topic))).toHaveLength(1);
  });
});

describe("pickDaily", () => {
  const list = buildIdeas(base({ rank: [rank(Array.from({ length: 12 }, (_, i) => ({ keyword: `cortina modelo ${String.fromCharCode(97 + i)}${i} managua`, position: null })))] }));
  it("da 6 ideas, igual todo el día y distintas otro día", () => {
    const a = pickDaily(list, 6, "2026-10-07|x");
    expect(a).toHaveLength(6);
    expect(pickDaily(list, 6, "2026-10-07|x").map((x) => x.id)).toEqual(a.map((x) => x.id));
    const days = ["2026-10-08|x", "2026-10-09|x", "2026-10-10|x"].map((d) => pickDaily(list, 6, d).map((x) => x.id).join());
    expect(days.some((d) => d !== a.map((x) => x.id).join())).toBe(true);
  });
});

describe("postedRecently", () => {
  it("compara por palabras, con plurales y sin acentos", () => {
    expect(postedRecently({ keyword: "mantenimiento de cortinas metálicas", topic: "" }, ["Haz el mantenimiento de tu cortina metalica cada año"])).toBe(true);
    expect(postedRecently({ keyword: "portones corredizos", topic: "" }, ["Haz el mantenimiento de tu cortina metalica cada año"])).toBe(false);
  });
});

describe("bilingüe", () => {
  it("detecta un negocio que atiende en español e inglés", () => {
    expect(isBilingual("Zona: Miami.\n\nIdiomas: español e inglés.")).toBe(true);
    expect(isBilingual("We speak English and Spanish")).toBe(true);
    expect(isBilingual("Atendemos en Managua")).toBe(false);
  });
  it("une las dos versiones con una raya", () => {
    expect(joinBilingual("Hola", "Hello")).toBe("Hola\n\n— English —\n\nHello");
    expect(joinBilingual("Hello", "Hola", "en")).toBe("Hello\n\n— Español —\n\nHola");
    expect(joinBilingual("Hola", "")).toBe("Hola");
  });
});

describe("noRepeat", () => {
  it("le pasa a la IA los comienzos recientes y evita empezar con pregunta si ya se repitió", () => {
    const recent = ["¿Notaste una mancha de humedad en el techo?", "¿Sabías que las filtraciones en el techo…?", "Tip del día"];
    for (let i = 0; i < 10; i++) {
      const txt = noRepeat(recent, i / 10);
      expect(txt).toContain("¿Notaste una mancha de humedad en el techo?");
      expect(txt).not.toMatch(/Start with a question/);
    }
    expect(noRepeat([], 0)).not.toContain("Recent posts");
  });
});
