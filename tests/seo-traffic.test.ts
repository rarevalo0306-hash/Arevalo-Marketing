import { describe, expect, it } from "vitest";
import { readCompetitorsReport } from "@/lib/seo/competitors";
import {
  addMonths,
  etvAt,
  hasData,
  historyStart,
  niceMax,
  normalizeUrl,
  nowFromHistory,
  parseHistory,
  parseRelevantPages,
  pickTrafficCompetitors,
  readTrafficReport,
  siteName,
  slugTopic,
  topKeywordForPage,
  trafficCostEstimate,
  trafficDelta,
  trafficSummary,
  trafficTimeline,
  visitsText,
  type TrafficDomain,
  type TrafficMonth,
} from "@/lib/seo/traffic";
import fameseg from "./fixtures/fameseg.json";

// metrics.organic tal como lo devuelve DataForSEO Labs (docs.dataforseo.com/v3/dataforseo_labs/google/historical_rank_overview/live).
const organic = (etv: number, count: number, pos = { p1: 0, p23: 0, p410: 0 }, cost = 0) => ({
  pos_1: pos.p1,
  pos_2_3: pos.p23,
  pos_4_10: pos.p410,
  pos_11_20: 1,
  pos_21_30: 0,
  pos_31_40: 0,
  pos_41_50: 0,
  pos_51_60: 0,
  pos_61_70: 0,
  pos_71_80: 0,
  pos_81_90: 0,
  pos_91_100: 0,
  etv,
  count,
  estimated_paid_traffic_cost: cost,
  is_new: 0,
  is_up: 0,
  is_down: 0,
  is_lost: 0,
});

/** Respuesta de historical_rank_overview: los meses vienen del más nuevo al más viejo. */
const historyResult = (target: string, months: { year: number; month: number; etv: number; count: number; p1?: number; p23?: number; p410?: number; cost?: number }[]) => [
  {
    se_type: "google",
    target,
    location_code: 2558,
    language_code: "es",
    total_count: months.length,
    items_count: months.length,
    items: months.map((m) => ({
      se_type: "google",
      year: m.year,
      month: m.month,
      metrics: { organic: organic(m.etv, m.count, { p1: m.p1 ?? 0, p23: m.p23 ?? 0, p410: m.p410 ?? 0 }, m.cost ?? 0), paid: organic(0, 0) },
    })),
  },
];

/** Respuesta de relevant_pages (docs.dataforseo.com/v3/dataforseo_labs/google/relevant_pages/live). */
const pagesResult = (target: string, pages: { url: string; etv: number; count: number; p1?: number }[]) => [
  {
    se_type: "google",
    target,
    location_code: 2558,
    language_code: "es",
    total_count: pages.length,
    items_count: pages.length,
    items: pages.map((p) => ({ se_type: "google", page_address: p.url, metrics: { organic: organic(p.etv, p.count, { p1: p.p1 ?? 0, p23: 0, p410: 0 }, p.etv * 0.5) } })),
  },
];

const competitorsReport = readCompetitorsReport(fameseg.reports.competitors.data)!;

describe("fechas", () => {
  it("suma y resta meses", () => {
    expect(addMonths("2026-10", -12)).toBe("2025-10");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2025-12", 1)).toBe("2026-01");
  });
  it("pide el historial desde hace 12 meses", () => {
    expect(historyStart(new Date("2026-10-06T12:00:00Z"))).toBe("2025-10-01");
    expect(historyStart(new Date("2026-01-31T12:00:00Z"))).toBe("2025-01-01");
  });
});

describe("costo", () => {
  it("historial para todos y páginas para los competidores", () => {
    // 4 × (0.012 + 13 × 0.00012) + 3 × (0.012 + 10 × 0.00012) = 0.05424 + 0.0396
    expect(trafficCostEstimate(3)).toBe(0.094);
    expect(trafficCostEstimate(0)).toBe(0.014);
    expect(trafficCostEstimate(9)).toBe(trafficCostEstimate(3));
  });
});

describe("competidores", () => {
  it("toma los 3 primeros sin directorios, con sus búsquedas", () => {
    const list = pickTrafficCompetitors(competitorsReport, "fameseg.com");
    expect(list.map((c) => c.domain)).toEqual(["arteytecnica.com", "cormetal.com.ni", "cortinasmetalicasurgentes.com"]);
    expect(list[1].top.length).toBeGreaterThan(0);
    expect(pickTrafficCompetitors(null)).toEqual([]);
  });
  it("deja los directorios que agregó el dueño", () => {
    const list = pickTrafficCompetitors({ domain: "x.com", competitors: [{ ...competitorsReport.competitors[0], source: "owner" }] });
    expect(list.map((c) => c.domain)).toEqual(["paginasamarillas.com.ni"]);
  });
});

describe("parseHistory", () => {
  it("lee los meses en orden y calcula top 3 / top 10", () => {
    const h = parseHistory(
      historyResult("cormetal.com.ni", [
        { year: 2026, month: 9, etv: 45.2, count: 30, p1: 2, p23: 3, p410: 5, cost: 12.5 },
        { year: 2026, month: 8, etv: 40, count: 28 },
        { year: 2025, month: 10, etv: 20, count: 10 },
      ]),
    );
    expect(h.map((m) => m.month)).toEqual(["2025-10", "2026-08", "2026-09"]);
    expect(h[2]).toEqual({ month: "2026-09", etv: 45.2, keywords: 30, top3: 5, top10: 10, value: 12.5 });
    expect(nowFromHistory(h)).toEqual({ etv: 45.2, keywords: 30, top3: 5, top10: 10, value: 12.5, month: "2026-09" });
  });
  it("sin datos: lista vacía", () => {
    expect(parseHistory([])).toEqual([]);
    expect(parseHistory([{ items: null, total_count: 0 }])).toEqual([]);
    expect(nowFromHistory([])).toBeNull();
  });
  it("ignora meses raros", () => {
    expect(parseHistory([{ items: [{ year: 2026, month: 13, metrics: {} }, { year: "x", month: 1 }] }])).toEqual([]);
  });
});

describe("páginas", () => {
  const top = competitorsReport.competitors.find((c) => c.domain === "cormetal.com.ni")!.top;
  it("normaliza direcciones", () => {
    expect(normalizeUrl("https://www.Cormetal.com.ni/ventanas-y-puertas-de-pvc/?utm=1#x")).toBe("cormetal.com.ni/ventanas-y-puertas-de-pvc");
  });
  it("saca el tema de la dirección", () => {
    expect(slugTopic("https://www.cormetal.com.ni/ventanas-y-puertas-de-pvc")).toBe("ventanas y puertas de pvc");
    expect(slugTopic("https://arteytecnica.com/blog/2025/12/07/instalacion-portones-corredizos-automatizados-videportero-con-control/")).toBe("instalacion portones corredizos automatizados videportero con");
    expect(slugTopic("https://cormetal.com.ni/")).toBeNull();
    expect(slugTopic("https://cormetal.com.ni/contacto")).toBeNull();
  });
  it("la búsqueda principal sale del reporte de competencia", () => {
    expect(topKeywordForPage("https://cormetal.com.ni/ventanas-y-puertas-de-pvc/", top)).toBe("puerta de pvc");
    expect(topKeywordForPage("https://cormetal.com.ni/otra", top)).toBeNull();
  });
  it("lee relevant_pages ordenadas por visitas, sin repetir", () => {
    const pages = parseRelevantPages(
      pagesResult("cormetal.com.ni", [
        { url: "https://www.cormetal.com.ni/", etv: 3, count: 12 },
        { url: "https://www.cormetal.com.ni/ventanas-y-puertas-de-pvc", etv: 1.4, count: 2, p1: 1 },
        { url: "https://www.cormetal.com.ni/cortinas-metalicas", etv: 8, count: 5 },
        { url: "https://cormetal.com.ni/", etv: 1, count: 1 },
      ]),
      top,
    );
    expect(pages.map((p) => p.url)).toEqual(["https://www.cormetal.com.ni/cortinas-metalicas", "https://www.cormetal.com.ni/", "https://www.cormetal.com.ni/ventanas-y-puertas-de-pvc"]);
    expect(pages[2]).toMatchObject({ etv: 1.4, keywords: 2, top3: 1, topKeyword: "puerta de pvc", topic: "ventanas y puertas de pvc" });
    expect(pages[0].topKeyword).toBeNull();
    expect(parseRelevantPages([])).toEqual([]);
  });
});

const m = (month: string, etv: number): TrafficMonth => ({ month, etv, keywords: 1, top3: 0, top10: 0, value: null });
const dom = (domain: string, isYou: boolean, history: TrafficMonth[], extra: Partial<TrafficDomain> = {}): TrafficDomain => ({ domain, isYou, now: nowFromHistory(history), pages: [], history, ...extra });

describe("historial y cambios", () => {
  const cormetal = dom("cormetal.com.ni", false, [m("2025-09", 20), m("2026-03", 30), m("2026-09", 45)]);
  const you = dom("fameseg.com", true, [m("2025-09", 1), m("2026-09", 3)]);
  const nuevo = dom("cortinasmetalicasurgentes.com", false, []);

  it("los meses que faltan cuentan como 0; sin historial es null", () => {
    expect(etvAt(cormetal, "2026-01")).toBe(0);
    expect(etvAt(cormetal, "2026-03")).toBe(30);
    expect(etvAt(nuevo, "2026-03")).toBeNull();
  });
  it("hace 6 y 12 meses", () => {
    expect(trafficDelta(cormetal, 12)).toEqual({ from: 20, to: 45 });
    expect(trafficDelta(cormetal, 6)).toEqual({ from: 30, to: 45 });
    expect(trafficDelta(nuevo, 12)).toBeNull();
  });
  it("la gráfica: 13 meses hasta el más nuevo, sin los que no tienen datos", () => {
    const tl = trafficTimeline([you, cormetal, nuevo]);
    expect(tl.months).toHaveLength(13);
    expect(tl.months[0]).toBe("2025-09");
    expect(tl.months[12]).toBe("2026-09");
    expect(tl.series.map((s) => s.domain)).toEqual(["fameseg.com", "cormetal.com.ni"]);
    expect(tl.series[1].values[6]).toBe(30);
    expect(trafficTimeline([nuevo])).toEqual({ months: [], series: [] });
  });
  it("hasData", () => {
    expect(hasData(cormetal)).toBe(true);
    expect(hasData(nuevo)).toBe(false);
  });
  it("tope del eje", () => {
    expect(niceMax(0)).toBe(5);
    expect(niceMax(45)).toBe(50);
    expect(niceMax(120)).toBe(200);
    expect(niceMax(6699)).toBe(10000);
  });
  it("visitas para leer", () => {
    expect(visitsText(0.4, "es")).toBe("menos de 1");
    expect(visitsText(1284.6, "en")).toBe("1,285");
    expect(visitsText(null, "es")).toBe("sin datos");
    expect(siteName("cormetal.com.ni")).toBe("Cormetal");
    expect(siteName("arteytecnica.com")).toBe("Arteytecnica");
  });

  it("el resumen en palabras simples", () => {
    const s = trafficSummary({ domains: [you, cormetal, nuevo] });
    expect(s[0].es).toBe("Hoy Cormetal es quien más visitas recibe desde Google: unas 45 al mes, 15 veces más que tú.");
    expect(s[1].es).toBe("En un año, Cormetal pasó de 20 a 45 visitas al mes; tú de 1 a 3.");
    expect(s[1].en).toBe("Over a year, Cormetal went from 20 to 45 visits a month; you from 1 to 3.");
    expect(s.some((x) => x.es.includes("Cormetal está creciendo rápido"))).toBe(true);
    expect(s[s.length - 1].es).toContain("Sin datos de cortinasmetalicasurgentes.com");
  });
  it("resumen cuando tú vas primero o estás solo", () => {
    const big = dom("fameseg.com", true, [m("2025-09", 50), m("2026-09", 50)]);
    const s = trafficSummary({ domains: [big] });
    expect(s[0].es).toContain("tú eres quien más visitas recibe");
    expect(s[1].es).toBe("En un año, te quedaste en 50 visitas al mes.");
  });
  it("resumen cuando nadie tiene datos", () => {
    const s = trafficSummary({ domains: [dom("fameseg.com", true, []), nuevo] });
    expect(s).toHaveLength(1);
    expect(s[0].es).toContain("Sin datos de fameseg.com (tú), cortinasmetalicasurgentes.com");
  });
});

describe("readTrafficReport", () => {
  it("lee un reporte guardado", () => {
    const saved = JSON.parse(
      JSON.stringify({
        domain: "fameseg.com",
        country: "Nicaragua",
        location: competitorsReport.location,
        domains: [
          dom("fameseg.com", true, [m("2026-09", 1.28)]),
          dom("cormetal.com.ni", false, [m("2026-09", 1.44)], { pages: [{ url: "https://www.cormetal.com.ni/x", etv: 1, keywords: 2, top3: 0, value: null, topKeyword: "puerta de pvc", topic: null }] }),
          dom("cortinasmetalicasurgentes.com", false, [], { failed: true }),
        ],
        notes: [{ es: "a", en: "b" }],
        cost: 0.094,
        createdAt: "2026-10-06T08:00:00.000Z",
      }),
    );
    const r = readTrafficReport(saved)!;
    expect(r.country).toBe("Nicaragua");
    expect(r.domains).toHaveLength(3);
    expect(r.domains[0].now?.etv).toBe(1.28);
    expect(r.domains[1].pages[0].topKeyword).toBe("puerta de pvc");
    expect(r.domains[2].failed).toBe(true);
    expect(r.location?.countryCode).toBe(2558);
  });
  it("tolera reportes incompletos o rotos", () => {
    expect(readTrafficReport(null)).toBeNull();
    expect(readTrafficReport({ domains: "x" })).toBeNull();
    expect(readTrafficReport({ domains: [{ nope: 1 }] })).toBeNull();
    const r = readTrafficReport({ domains: [{ domain: "fameseg.com", isYou: true, history: [{ month: "2026-09", etv: 2 }, { month: "bad" }] }] })!;
    expect(r.domain).toBe("fameseg.com");
    expect(r.domains[0].history).toHaveLength(1);
    expect(r.domains[0].now).toMatchObject({ etv: 2, month: "2026-09" });
    expect(r.domains[0].pages).toEqual([]);
    expect(r.cost).toBe(0);
    expect(r.location).toBeNull();
  });
});
