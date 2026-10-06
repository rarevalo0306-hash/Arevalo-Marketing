import { describe, expect, it } from "vitest";
import {
  gapCostEstimate,
  type IntersectionItem,
  mergeGap,
  opportunityScore,
  parseIntersection,
  businessTopicVocab,
  gbpCategory,
  isRelevantKeyword,
  pickGapCompetitors,
  readGapReport,
  relevantGapRows,
  splitGapRows,
  topicVocab,
} from "@/lib/seo/gap";
import { readCompetitorsReport } from "@/lib/seo/competitors";
import fameseg from "./fixtures/fameseg.json";

// Forma real de domain_intersection/live (docs.dataforseo.com/v3/dataforseo_labs/google/domain_intersection/live).
const item = (keyword: string, volume: number | null, first: number | null, second?: number, extra: { kd?: number | null; intent?: string | null; cpc?: number | null } = {}) => ({
  se_type: "google",
  keyword_data: {
    se_type: "google",
    keyword,
    location_code: 2484,
    language_code: "es",
    keyword_info: { se_type: "google", last_updated_time: "2026-09-01 00:00:00 +00:00", competition: 0.4, competition_level: "MEDIUM", cpc: extra.cpc === undefined ? 1.25 : extra.cpc, search_volume: volume, monthly_searches: [] },
    keyword_properties: { se_type: "google", core_keyword: null, keyword_difficulty: extra.kd === undefined ? 25 : extra.kd, detected_language: "es", is_another_language: false },
    search_intent_info: extra.intent === null ? null : { se_type: "google", main_intent: extra.intent ?? "commercial", foreign_intent: ["transactional"] },
    serp_info: null,
    avg_backlinks_info: null,
  },
  first_domain_serp_element: first === null ? null : { se_type: "google", type: "organic", rank_group: first, rank_absolute: first + 1, position: "left", domain: "www.rival.com", url: "https://www.rival.com/x", etv: 12.3 },
  ...(second !== undefined ? { second_domain_serp_element: { se_type: "google", type: "organic", rank_group: second, rank_absolute: second + 2, domain: "mio.com", url: "https://mio.com/y" } } : {}),
});

const result = (items: unknown[]) => [{ se_type: "google", target1: "rival.com", target2: "mio.com", location_code: 2484, language_code: "es", total_count: items.length, items_count: items.length, items }];

const it_ = (keyword: string, competitorPosition: number, yourPosition: number | null, volume: number | null = 100, extra: Partial<IntersectionItem> = {}): IntersectionItem => ({
  keyword,
  volume,
  cpc: 1,
  difficulty: 20,
  intent: "commercial",
  competitorPosition,
  yourPosition,
  ...extra,
});

describe("parseIntersection", () => {
  it("lee keyword_data y la posición del competidor (te faltan)", () => {
    const out = parseIntersection(result([item("Plomero  Urgente", 880, 3), item("", 10, 1), item("sin posición", 10, null)]), "missing");
    expect(out).toEqual([{ keyword: "plomero urgente", volume: 880, cpc: 1.25, difficulty: 25, intent: "commercial", competitorPosition: 3, yourPosition: null }]);
  });
  it("lee tu posición en second_domain_serp_element (estás más abajo)", () => {
    const out = parseIntersection(result([item("destapar caño", 320, 2, 9, { kd: null, intent: null, cpc: null })]), "weak");
    expect(out).toEqual([{ keyword: "destapar caño", volume: 320, cpc: null, difficulty: null, intent: null, competitorPosition: 2, yourPosition: 9 }]);
  });
  it("acepta listas de elementos y respuestas vacías o rotas", () => {
    const raw = item("x y", 5, 7);
    (raw as Record<string, unknown>).first_domain_serp_element = [{ rank_group: 7 }, { rank_group: 4 }];
    expect(parseIntersection(result([raw]), "missing")[0].competitorPosition).toBe(4);
    expect(parseIntersection([], "missing")).toEqual([]);
    expect(parseIntersection([null], "weak")).toEqual([]);
    expect(parseIntersection([{ items: null }], "weak")).toEqual([]);
  });
  it("ignora intenciones desconocidas y limita la dificultad", () => {
    const [r] = parseIntersection(result([item("a b", 1, 2, undefined, { intent: "otra", kd: 140 })]), "missing");
    expect(r.intent).toBeNull();
    expect(r.difficulty).toBe(100);
  });
});

describe("opportunityScore", () => {
  it("más búsquedas, menos dificultad y más competidores suben el puntaje", () => {
    const base = { volume: 1000, difficulty: 20, intent: "commercial" as const, competitors: 1 };
    expect(opportunityScore({ ...base, volume: 5000 })).toBeGreaterThan(opportunityScore(base));
    expect(opportunityScore({ ...base, difficulty: 80 })).toBeLessThan(opportunityScore(base));
    expect(opportunityScore({ ...base, competitors: 3 })).toBeGreaterThan(opportunityScore(base));
    expect(opportunityScore({ ...base, intent: "transactional" })).toBeGreaterThan(opportunityScore({ ...base, intent: "informational" }));
    expect(opportunityScore({ ...base, intent: "navigational" })).toBeLessThan(opportunityScore({ ...base, intent: "informational" }));
  });
  it("sigue la fórmula documentada", () => {
    // 20 × log10(1001) × (0.3 + 0.7 × 0.8) × 1.3 × 1.15 × 1.15
    const expected = 20 * Math.log10(1001) * 0.86 * 1.3 * 1.15 * 1.15;
    expect(opportunityScore({ volume: 1000, difficulty: 20, intent: "transactional", competitors: 2, yourPosition: 12 })).toBeCloseTo(expected, 0);
    expect(opportunityScore({ volume: null, difficulty: null, intent: null, competitors: 1 })).toBe(0);
  });
});

describe("mergeGap", () => {
  const competitors = ["rival.com", "otro.com"];
  it("junta por búsqueda, ordena posiciones y suma competidores", () => {
    const rows = mergeGap({
      self: "mio.com",
      competitors,
      missing: [
        { domain: "rival.com", items: [it_("Plomero 24 horas", 5, null, 500)] },
        { domain: "otro.com", items: [it_("plomero 24 horas", 2, null, 700)] },
      ],
      weak: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ keyword: "plomero 24 horas", volume: 700, type: "missing", yourPosition: null });
    expect(rows[0].competitors).toEqual([
      { domain: "otro.com", position: 2 },
      { domain: "rival.com", position: 5 },
    ]);
    expect(rows[0].opportunity).toBe(opportunityScore({ volume: 700, difficulty: 20, intent: "commercial", competitors: 2 }));
  });
  it("aplica los filtros de cada lista", () => {
    const rows = mergeGap({
      self: "mio.com",
      competitors,
      missing: [{ domain: "rival.com", items: [it_("lejos", 25, null), it_("cerca", 8, null)] }],
      weak: [
        {
          domain: "rival.com",
          items: [
            it_("ya en top 3", 1, 3), // tú estás en el top 3
            it_("tú ganas", 9, 6), // tú estás más arriba
            it_("empate", 6, 6),
            it_("te gana", 2, 11),
            it_("sin tu posición", 2, null),
          ],
        },
      ],
    });
    expect(rows.map((r) => r.keyword).sort()).toEqual(["cerca", "te gana"]);
    expect(rows.find((r) => r.keyword === "te gana")).toMatchObject({ type: "weak", yourPosition: 11 });
  });
  it("quita marcas (tuyas o de la competencia) y búsquedas de navegar", () => {
    const rows = mergeGap({
      self: "plomeriamia.com",
      competitors: ["rivalplomeros.com"],
      missing: [
        {
          domain: "rivalplomeros.com",
          items: [it_("Rival Plomeros telefono", 1, null), it_("plomeria mia opiniones", 2, null), it_("facebook login", 1, null, 9000, { intent: "navigational" }), it_("plomero barato", 4, null)],
        },
      ],
      weak: [],
    });
    expect(rows.map((r) => r.keyword)).toEqual(["plomero barato"]);
  });
  it("si una búsqueda sale en las dos listas, queda como 'estás más abajo'", () => {
    const rows = mergeGap({
      self: "mio.com",
      competitors,
      missing: [{ domain: "otro.com", items: [it_("fuga de agua", 4, null)] }],
      weak: [{ domain: "rival.com", items: [it_("fuga de agua", 2, 15)] }],
    });
    expect(rows[0]).toMatchObject({ type: "weak", yourPosition: 15 });
    expect(rows[0].competitors.map((c) => c.domain)).toEqual(["rival.com", "otro.com"]);
  });
  it("ordena por puntaje y respeta el máximo", () => {
    const rows = mergeGap({
      self: "mio.com",
      competitors,
      missing: [{ domain: "rival.com", items: [it_("poca", 3, null, 10), it_("mucha", 3, null, 10000), it_("media", 3, null, 500)] }],
      weak: [],
      keep: 2,
    });
    expect(rows.map((r) => r.keyword)).toEqual(["mucha", "media"]);
  });
});

describe("pickGapCompetitors", () => {
  const c = (domain: string, analyzed: boolean) => ({ domain, analyzed }) as never;
  it("usa los analizados (hasta 3) o, si no hay, los primeros", () => {
    expect(pickGapCompetitors(null)).toEqual([]);
    expect(pickGapCompetitors({ competitors: [c("a.com", true), c("b.com", false), c("c.com", true)] })).toEqual(["a.com", "c.com"]);
    expect(pickGapCompetitors({ competitors: [c("a.com", false), c("b.com", false), c("c.com", false), c("d.com", false)] })).toEqual(["a.com", "b.com", "c.com"]);
  });
});

describe("gapCostEstimate", () => {
  it("estima el costo máximo: 2 llamadas por competidor con hasta 100 filas", () => {
    expect(gapCostEstimate(3)).toBeCloseTo(6 * (0.012 + 100 * 0.00012), 3);
    expect(gapCostEstimate(1)).toBeCloseTo(2 * 0.024, 3);
    expect(gapCostEstimate(10)).toBe(gapCostEstimate(3));
  });
});

describe("readGapReport", () => {
  it("lee un reporte guardado e ignora filas rotas", () => {
    const r = readGapReport({
      domain: "mio.com",
      location: { code: 1010043, name: "Managua,Nicaragua", local: true, countryCode: 2558, countryName: "Nicaragua", countryIso: "NI", language: "es" },
      competitors: ["rival.com", 3, ""],
      rows: [
        { keyword: "plomero", volume: 100, cpc: 2, difficulty: 10, intent: "transactional", yourPosition: 5, competitors: [{ domain: "rival.com", position: 2 }], type: "missing", opportunity: 50 },
        { keyword: "fuga", volume: null, difficulty: "x", intent: "raro", yourPosition: 12, competitors: [{ domain: "rival.com", position: 1 }, { domain: "", position: 3 }], type: "weak" },
        { keyword: "", competitors: [{ domain: "rival.com", position: 1 }] },
        { keyword: "sin competidores", competitors: [] },
        null,
      ],
      notes: [{ es: "hola", en: "hi" }, { es: "solo es" }],
      cost: 0.0732,
      createdAt: "2026-10-06T10:00:00.000Z",
    });
    expect(r).not.toBeNull();
    expect(r!.competitors).toEqual(["rival.com"]);
    expect(r!.rows).toHaveLength(2);
    expect(r!.rows[0]).toMatchObject({ keyword: "plomero", type: "missing", yourPosition: null, opportunity: 50 });
    expect(r!.rows[1]).toMatchObject({ keyword: "fuga", type: "weak", yourPosition: 12, difficulty: null, intent: null, competitors: [{ domain: "rival.com", position: 1 }] });
    expect(r!.rows[1].opportunity).toBe(opportunityScore({ volume: null, difficulty: null, intent: null, competitors: 1, yourPosition: 12 }));
    expect(r!.location.countryName).toBe("Nicaragua");
    expect(r!.notes).toEqual([{ es: "hola", en: "hi" }]);
    expect(r!.cost).toBe(0.0732);
  });
  it("devuelve null con datos viejos o rotos", () => {
    expect(readGapReport(null)).toBeNull();
    expect(readGapReport("x")).toBeNull();
    expect(readGapReport({ domain: "mio.com" })).toBeNull();
    expect(readGapReport({ rows: [] })).toBeNull();
    const r = readGapReport({ domain: "mio.com", rows: [] });
    expect(r).toMatchObject({ domain: "mio.com", competitors: [], rows: [], notes: [], cost: 0, location: { language: "es", countryCode: 0 } });
  });
});

describe("pickGapCompetitors sin directorios", () => {
  it("con el reporte de Fameseg deja fuera a Páginas Amarillas", () => {
    expect(pickGapCompetitors(readCompetitorsReport(fameseg.reports.competitors.data))).toEqual(["arteytecnica.com", "cormetal.com.ni"]);
  });
  it("respeta un directorio que agregó el dueño", () => {
    const c = (domain: string, source: string) => ({ domain, analyzed: true, source }) as never;
    expect(pickGapCompetitors({ competitors: [c("paginasamarillas.com.ni", "owner"), c("facebook.com", "serp"), c("a.com", "labs")] })).toEqual(["paginasamarillas.com.ni", "a.com"]);
  });
});

describe("relevancia de las búsquedas (Fameseg: cortinas metálicas y portones en Managua)", () => {
  const vocab = businessTopicVocab(fameseg.business);
  const report = readGapReport(fameseg.reports.gap.data)!;

  it("arma el vocabulario con las palabras que sigue y el estudio, sin lugares ni palabras genéricas", () => {
    expect(vocab).toEqual(expect.arrayContaining(["cortina", "metalic", "porton", "automat", "tubular", "america", "acero", "motor"]));
    for (const w of ["managua", "nicaragu", "manteni", "fabrica", "tipo", "reparac", "masaya"]) expect(vocab).not.toContain(w);
  });

  it("oculta las búsquedas que no tienen que ver y deja las de portones", () => {
    const { relevant, hidden } = splitGapRows(report.rows, vocab);
    const kept = relevant.map((r) => r.keyword);
    const gone = hidden.map((r) => r.keyword);
    for (const k of ["gas cerca de mí", "super express 14 de septiembre", "concentrix nic 2", "restaurante eskimo managua", "el eskimo nicaragua", "motel barato en managua", "7 sur managua", "sur", "resina epoxica nicaragua", "grama artificial", "dentista cerca de mí", "fesame", "inmenicsa"])
      expect(gone, k).toContain(k);
    expect(kept).toEqual(["portones corredizos", "portón corredizo", "porton corredizo", "portón", "portones automatizados", "portones de metal", "portones automaticos"]);
    expect(relevantGapRows(report.rows, vocab)).toEqual(relevant);
    expect(relevant.length + hidden.length).toBe(report.rows.length);
  });

  it("también sirve para el adelanto del reporte de competencia (todas eran de Páginas Amarillas)", () => {
    const comp = readCompetitorsReport(fameseg.reports.competitors.data)!;
    const kept = relevantGapRows(comp.gap, vocab).map((g) => g.keyword);
    expect(kept).toEqual([]);
    for (const k of ["super mercado la union", "ministerio de salud concepción palacios minsa central", "gas cerca de mí"]) expect(isRelevantKeyword(k, vocab), k).toBe(false);
  });

  it("acepta plurales, acentos y variantes", () => {
    expect(isRelevantKeyword("Cortina Metálica precio", vocab)).toBe(true);
    expect(isRelevantKeyword("motores para portones", vocab)).toBe(true);
    expect(isRelevantKeyword("mantenimiento de aire acondicionado managua", vocab)).toBe(false);
  });

  it("sin vocabulario no oculta nada", () => {
    expect(topicVocab({})).toEqual([]);
    expect(relevantGapRows([{ keyword: "lo que sea" }], [])).toEqual([{ keyword: "lo que sea" }]);
  });

  it("usa la categoría del Perfil de Google si la hay", () => {
    expect(gbpCategory({ profile: { category: "Proveedor de toldos" } })).toBe("Proveedor de toldos");
    expect(gbpCategory(null)).toBe("");
    const v = topicVocab({ keywords: ["cortinas metálicas"], category: "Proveedor de toldos" });
    expect(isRelevantKeyword("toldos para negocio", v)).toBe(true);
  });

  it("los reportes nuevos guardan aparte las que no tienen que ver", () => {
    const r = readGapReport({ ...fameseg.reports.gap.data, rows: report.rows.slice(0, 2), offTopic: report.rows.slice(2, 4) })!;
    expect(r.offTopic?.map((x) => x.keyword)).toEqual(report.rows.slice(2, 4).map((x) => x.keyword));
    expect(readGapReport(fameseg.reports.gap.data)!.offTopic).toEqual([]);
  });
});
