import { describe, expect, it } from "vitest";
import { applyAiGroups, buildClusters, type ClusterKeyword, clusterNext, ignoreStems, mergeKeywords, pageKind, readClustersReport, wordGroups } from "@/lib/seo/clusters";

const kw = (keyword: string, volume: number | null = null, extra: Partial<ClusterKeyword> = {}): ClusterKeyword => ({ keyword, volume, difficulty: null, intent: null, position: null, sources: ["keywords"], ...extra });

describe("Tus temas", () => {
  it("une las búsquedas repetidas con el mejor dato de cada fuente", () => {
    const out = mergeKeywords([
      { keyword: "Reparación de techos Miami", source: "tracked" },
      { keyword: "reparacion de techos miami", volume: 90, difficulty: 22, intent: "transactional", source: "keywords" },
      { keyword: "reparación de techos  miami", position: 7, source: "rank" },
      { keyword: "techos", volume: 500, source: "gap" },
      { keyword: "x", source: "study" },
    ]);
    expect(out).toEqual([
      { keyword: "techos", volume: 500, difficulty: null, intent: null, position: null, sources: ["gap"] },
      { keyword: "Reparación de techos Miami", volume: 90, difficulty: 22, intent: "transactional", position: 7, sources: ["tracked", "rank", "keywords"] },
    ]);
  });

  it("sin IA agrupa por palabras en común, sin contar la ciudad", () => {
    const ignore = ignoreStems(["Miami", "Florida"], "Joe Roofing");
    const groups = wordGroups([kw("roof repair miami", 500), kw("roof repair", 300), kw("roof leak repair", 100), kw("gutter cleaning miami", 80), kw("miami", 10)], ignore);
    expect(groups.map((g) => g.map((k) => k.keyword))).toEqual([["roof repair miami", "roof repair", "roof leak repair"], ["gutter cleaning miami"], ["miami"]]);
  });

  it("usa los grupos de la IA solo con búsquedas que existen y sin repetir", () => {
    const list = [kw("roof repair miami", 500), kw("roof repair", 300), kw("how much does a new roof cost", 200), kw("roof leak repair", 100), kw("gutter cleaning", 50)];
    const { groups } = applyAiGroups(list, [
      { nameEs: "Reparación de techos", nameEn: "Roof repair", main: "ROOF REPAIR", kind: "service", keywords: ["roof repair miami", "roof repair", "inventada", "roof repair"] },
      { nameEs: "Precio de un techo", nameEn: "Roof cost", main: "no está", kind: "article", keywords: ["how much does a new roof cost"] },
      { nameEs: "Vacío", nameEn: "Empty", main: "x", kind: "raro", keywords: ["nada"] },
    ]);
    expect(groups.map((g) => [g.name.es, g.main, g.kind, g.items.map((k) => k.keyword)])).toEqual([
      // «roof leak repair» no estaba en ningún grupo: va al que comparte más palabras.
      ["Reparación de techos", "roof repair", "service", ["roof repair miami", "roof repair", "roof leak repair"]],
      ["Precio de un techo", "how much does a new roof cost", "article", ["how much does a new roof cost"]],
      // «gutter cleaning» no comparte palabras con ninguno: tema nuevo.
      ["gutter cleaning", "gutter cleaning", null, ["gutter cleaning"]],
    ]);
  });

  it("elige el tipo de página: artículo, zona o servicio", () => {
    const places = ignoreStems(["Doral", "Miami"]);
    expect(pageKind([kw("cómo saber si mi techo tiene goteras"), kw("qué causa goteras")], places)).toBe("article");
    expect(pageKind([kw("techos doral", 10, { intent: "transactional" }), kw("techos en doral", 5)], places)).toBe("area");
    expect(pageKind([kw("reparación de techos", 10, { intent: "commercial" })], places)).toBe("service");
  });

  it("arma cada tema con sus totales y la página que ya lo cubre", () => {
    const clusters = buildClusters(
      [
        { name: { es: "Goteras", en: "Leaks" }, main: "reparar goteras", kind: null, items: [kw("reparar goteras", 100, { difficulty: 20, intent: "transactional", position: 12 }), kw("goteras en el techo", 300, { difficulty: 40, intent: "informational", position: 5 })] },
        { name: { es: "Canaletas", en: "Gutters" }, main: "limpieza de canaletas", kind: "service", items: [kw("limpieza de canaletas", 50)] },
      ],
      { pages: [{ url: "https://x.com/goteras", label: "Reparación de goteras", text: "Reparación de goteras en el techo" }], articles: [], places: new Set() },
    );
    expect(clusters[0]).toMatchObject({ main: "reparar goteras", volume: 400, difficulty: 35, intent: "informational", bestPosition: 5, page: { url: "https://x.com/goteras" } });
    expect(clusters[0].keywords.map((k) => k.keyword)).toEqual(["goteras en el techo", "reparar goteras"]);
    expect(clusters[1]).toMatchObject({ kind: "service", page: null, article: null, difficulty: null });
  });

  it("dice qué hacer con cada tema", () => {
    expect(clusterNext({ page: null, article: null, kind: "service", bestPosition: 2 })).toBe("keep");
    expect(clusterNext({ page: { url: "u", label: "l" }, article: null, kind: "service", bestPosition: 9 })).toBe("improve");
    expect(clusterNext({ page: null, article: null, kind: "article", bestPosition: null })).toBe("write");
    expect(clusterNext({ page: null, article: null, kind: "area", bestPosition: 15 })).toBe("create");
  });

  it("guarda y lee los temas", () => {
    const report = { clusters: buildClusters([{ name: { es: "A", en: "A" }, main: "a b", kind: "article", items: [kw("a b", 10, { sources: ["gsc", "question"] })] }], { pages: [], articles: [], places: new Set() }), total: 1, by: "ai" as const, createdAt: "2026-10-01T00:00:00.000Z" };
    expect(readClustersReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
    expect(readClustersReport({ clusters: "x" })).toBeNull();
  });
});

describe("palabras comunes del rubro", () => {
  it("no juntan servicios distintos solo por compartir «claim» o «damage»", () => {
    const list = [
      kw("hurricane damage claim", 880),
      kw("roof damage insurance claim", 720),
      kw("how to file a hurricane insurance claim", 590),
      kw("water damage claim miami", 390),
      kw("roof leak insurance claim", 320),
      kw("mold damage claim florida", 210),
      kw("denied insurance claim help", 260),
      kw("insurance claim denied what to do", 480),
    ];
    const groups = wordGroups(list, ignoreStems(["Miami", "Florida"])).map((g) => g.map((k) => k.keyword));
    expect(groups).toEqual([
      ["hurricane damage claim"],
      ["roof damage insurance claim", "roof leak insurance claim"],
      // Una pregunta («how to…») va en un artículo: no se junta con la página del servicio.
      ["how to file a hurricane insurance claim"],
      ["water damage claim miami"],
      ["mold damage claim florida"],
      ["denied insurance claim help", "insurance claim denied what to do"],
    ]);
  });
});

describe("preguntas y servicios", () => {
  it("las preguntas se juntan entre ellas", () => {
    const groups = wordGroups([kw("public adjuster near me", 2900), kw("public adjuster miami", 1300), kw("how much does a public adjuster charge", 300), kw("how much do public adjusters charge", 90)]);
    expect(groups.map((g) => g.map((k) => k.keyword))).toEqual([
      ["public adjuster near me", "public adjuster miami"],
      ["how much does a public adjuster charge", "how much do public adjusters charge"],
    ]);
  });
});
