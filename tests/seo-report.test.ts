import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { attachmentPayload } from "@/lib/seo/alerts";
import {
  buildReport,
  buildReportEmail,
  compare,
  gatherReport,
  isEmptyReport,
  isMonthlyDue,
  numbersGrounded,
  pctChange,
  periodFor,
  periodLabel,
  reportFileName,
  reportKpis,
  reportSummary,
  ruleSummary,
  setupHints,
  summaryFacts,
  whatChanged,
  type RawRow,
  type ReportInputs,
} from "@/lib/seo/report";
import { loadLogo, mix, normalizeLogo, palette, renderReportPdf, trunc } from "@/lib/seo/report-pdf";

const TZ = "America/New_York";
const NOW = new Date("2026-10-06T15:00:00.000Z");
const at = (s: string) => new Date(s);
const MIAMI = 1015116;
const DORAL = 1015117;

// ---------- Fixtures ----------

const KEYWORDS = ["techos miami", "reparación de techos", "roofing company", "goteras en el techo", "techos de tejas", "instalación de techos", "roof repair near me", "techos planos"];

const RIVALS = ["perezroofing.com", "yelp.com", "techosya.com", "angi.com", "roofpros.com"];
/** Los 5 primeros de Google: tu página en su lugar (si está entre los 5) y la competencia en los demás. */
const topFor = (position: number | null) => {
  let k = 0;
  return [1, 2, 3, 4, 5].map((p) =>
    p === position
      ? { position: p, domain: "arevalo-roofing.com", url: "https://arevalo-roofing.com/techos", title: "Techos en Miami" }
      : { position: p, domain: RIVALS[k], url: `https://${RIVALS[k++]}/`, title: "" },
  );
};
const rankRow = (keyword: string, position: number | null) => ({ keyword, position, url: position ? "https://arevalo-roofing.com/techos" : null, localPack: null, top: topFor(position), features: [] });
const rankRep = (code: number, location: string, positions: (number | null)[], createdAt: string) => ({
  location,
  locationCode: code,
  language: "es",
  device: "mobile",
  rows: KEYWORDS.map((k, i) => rankRow(k, positions[i] ?? null)),
  cost: 0.03,
  createdAt,
});

/** Enlaces guardados (backlinks.ts): `referring` sitios te enlazan; con o sin la lista de dónde conseguir enlaces. */
function backlinksRep(referring: number, rank: number, gap: boolean) {
  const g = (domain: string, hint: string, linksTo: string[], r: number) => ({ domain, rank: r, linksTo, backlinks: 2, spamScore: 3, hint });
  return {
    domain: "arevalo-roofing.com",
    summary: { domain: "arevalo-roofing.com", rank, backlinks: referring * 6, referringDomains: referring, newDomains1m: 4, lostDomains1m: 1, trend: [] },
    referring: [],
    referringTotal: referring,
    competitors: [
      { domain: "perezroofing.com", rank: 320, backlinks: 900, referringDomains: 120, ok: true },
      { domain: "techosya.com", rank: 150, backlinks: 120, referringDomains: 25, ok: true },
    ],
    gap: gap
      ? [
          g("miamichamber.com", "association", ["perezroofing.com", "techosya.com"], 420),
          g("yelp.com", "directory", ["perezroofing.com", "techosya.com"], 900),
          g("miaminewtimes.com", "news", ["perezroofing.com"], 610),
          g("abcsupply.com", "supplier", ["perezroofing.com"], 480),
          g("houzz.com", "directory", ["techosya.com"], 700),
          g("floridaroof.com", "association", ["perezroofing.com"], 300),
          g("roofingtalk.com", "forum", ["perezroofing.com"], 120),
        ]
      : [],
    gapSpamHidden: 0,
    notes: [],
    cost: 0.2,
    createdAt: "2026-09-21T12:00:00Z",
  };
}

/** Visitas de la competencia guardadas (traffic.ts): Pérez Roofing crece; tú también, más despacio. */
function trafficRep() {
  const h = (values: [string, number][]) => values.map(([month, etv]) => ({ month, etv, keywords: Math.round(etv / 3), top3: Math.round(etv / 40), top10: Math.round(etv / 15), value: etv * 2 }));
  return {
    domain: "arevalo-roofing.com",
    country: "United States",
    location: null,
    domains: [
      { domain: "arevalo-roofing.com", isYou: true, history: h([["2025-09", 140], ["2026-03", 210], ["2026-09", 260]]), pages: [] },
      { domain: "perezroofing.com", isYou: false, history: h([["2025-09", 900], ["2026-03", 1300], ["2026-09", 1850]]), pages: [] },
      { domain: "techosya.com", isYou: false, history: h([["2025-09", 300], ["2026-03", 280], ["2026-09", 240]]), pages: [] },
      { domain: "roofpros.com", isYou: false, history: [], pages: [] },
    ],
    notes: [],
    cost: 0.06,
    createdAt: "2026-09-24T12:00:00Z",
  };
}

function richInputs(): ReportInputs {
  const row = (data: unknown, createdAt: string): RawRow => ({ data, createdAt: at(createdAt) });
  const grid = (ranks: (number | null)[]) => ranks.map((rank, i) => ({ lat: 25.77 + Math.floor(i / 5) * 0.01, lng: -80.19 + (i % 5) * 0.01, rank, top3: [{ title: "Techos Pérez", rank: 1, cid: "9" }] }));
  const review = (id: string, rating: number, timestamp: string, answered: boolean) => ({ id, name: `Cliente ${id}`, rating, text: "Muy buen trabajo", timestamp, ownerAnswer: answered ? "¡Gracias!" : "" });
  const page = (url: string, title: string, score: number, idea: string) => ({
    url,
    title,
    keyword: "techos miami",
    score,
    ideas: [{ id: "length", category: "contenido", priority: "alta", es: idea, en: `EN: ${idea}`, impact: 8 }],
  });
  return {
    business: {
      id: "biz1",
      name: "Arévalo Roofing & Co.",
      website: "https://arevalo-roofing.com",
      color: "#0E5A8A",
      color2: "#F2A900",
      color3: "#E8F1F8",
      logoUrl: "",
      fontHeading: "montserrat",
      aiText: "",
      seoKeywords: KEYWORDS,
      seoLocations: [
        { code: MIAMI, name: "Miami,Florida,United States" },
        { code: DORAL, name: "Doral,Florida,United States" },
      ],
      seoLocationCode: MIAMI,
      seoLocationName: "Miami,Florida,United States",
    },
    rows: {
      rank: [
        row(rankRep(MIAMI, "Miami,Florida,United States", [2, 6, 9, 14, null, 4, 18, 11], "2026-09-29T12:00:00Z"), "2026-09-29T12:00:00Z"),
        row(rankRep(DORAL, "Doral,Florida,United States", [5, 8, 12, null, null, 7, 20, 15], "2026-09-29T12:05:00Z"), "2026-09-29T12:05:00Z"),
        row(rankRep(MIAMI, "Miami,Florida,United States", [3, 9, 9, 12, null, 6, 17, 13], "2026-09-15T12:00:00Z"), "2026-09-15T12:00:00Z"),
        row(rankRep(MIAMI, "Miami,Florida,United States", [4, 12, 8, 10, null, 9, null, 13], "2026-08-30T12:00:00Z"), "2026-08-30T12:00:00Z"),
        row(rankRep(DORAL, "Doral,Florida,United States", [6, 8, 15, null, null, 9, null, 14], "2026-08-30T12:05:00Z"), "2026-08-30T12:05:00Z"),
      ],
      keywords: [
        row(
          {
            location: "Miami,Florida,United States",
            locationCode: MIAMI,
            language: "es",
            keywords: KEYWORDS.map((keyword, i) => ({ keyword, volume: [1900, 880, 2400, 320, 140, 590, 4400, 210][i] })),
            ideas: [],
            createdAt: "2026-09-10T12:00:00Z",
          },
          "2026-09-10T12:00:00Z",
        ),
      ],
      maprank: [
        row({ keyword: "roofing company", place: { title: "Arévalo Roofing", cid: "1" }, size: 5, spacingKm: 1, points: grid([1, 2, 2, 4, 6, 2, 1, 1, 3, 8, 3, 2, 1, 2, 9, 5, 3, 2, 4, 12, 11, 7, 6, 13, null]) }, "2026-09-20T12:00:00Z"),
        row({ keyword: "roofing company", place: { title: "Arévalo Roofing", cid: "1" }, size: 5, spacingKm: 1, points: grid([3, 4, 5, 6, 9, 4, 2, 3, 5, 11, 6, 4, 3, 5, 12, 9, 6, 5, 8, 15, 14, 10, 9, null, null]) }, "2026-08-20T12:00:00Z"),
      ],
      gbp: [row({ profile: { title: "Arévalo Roofing", category: "Roofing contractor", rating: 4.8, reviews: 126, hasHours: true, hoursDays: 6, description: "Techos en Miami desde 2010.", totalPhotos: 40 }, competitors: [], createdAt: "2026-09-25T12:00:00Z" }, "2026-09-25T12:00:00Z")],
      reviews: [
        row(
          {
            total: 128,
            rating: 4.8,
            reviews: [
              review("a", 5, "2026-09-28T12:00:00Z", true),
              review("b", 5, "2026-09-21T12:00:00Z", true),
              review("c", 4, "2026-09-12T12:00:00Z", false),
              review("d", 5, "2026-09-03T12:00:00Z", true),
              review("e", 5, "2026-08-14T12:00:00Z", true),
              review("f", 3, "2026-08-02T12:00:00Z", true),
            ],
            createdAt: "2026-09-30T12:00:00Z",
          },
          "2026-09-30T12:00:00Z",
        ),
      ],
      ai: [
        row(
          {
            questions: ["¿Quién arregla techos en Miami?"],
            results: [
              { question: "q1", provider: "gemini", mentioned: true, competitors: ["Techos Pérez", "Roof Pros"], sentiment: { sentiment: "positiva", reason: "Lo recomienda por su garantía", quote: "Arévalo Roofing da 10 años de garantía", attributes: ["garantía", "precio justo"] } },
              { question: "q2", provider: "gemini", mentioned: true, competitors: ["Techos Pérez"], sentiment: { sentiment: "positiva", reason: "Destaca la rapidez", quote: "Arévalo Roofing responde rápido", attributes: ["rapidez", "garantía"] } },
              { question: "q1", provider: "openai", mentioned: false, competitors: ["Techos Pérez", "Roof Pros", "Miami Roofing Co"] },
              { question: "q2", provider: "openai", mentioned: true, competitors: ["Techos Pérez"], sentiment: { sentiment: "negativa", reason: "Menciona quejas por demoras en los presupuestos", quote: "algunos clientes de Arévalo Roofing se quejan de demoras", attributes: ["demoras"] } },
            ],
            score: 75,
            sentiment: { status: "ok" },
          },
          "2026-09-28T12:00:00Z",
        ),
        row(
          {
            questions: ["¿Quién arregla techos en Miami?"],
            results: [
              { question: "q1", provider: "gemini", mentioned: true, competitors: ["Techos Pérez", "Roof Pros"] },
              { question: "q2", provider: "gemini", mentioned: false, competitors: ["Techos Pérez", "Roof Pros"] },
              { question: "q1", provider: "openai", mentioned: false, competitors: ["Techos Pérez", "Miami Roofing Co"] },
              { question: "q2", provider: "openai", mentioned: false, competitors: ["Techos Pérez"] },
            ],
            score: 25,
          },
          "2026-08-28T12:00:00Z",
        ),
      ],
      audit: [
        row({ pages: [{ url: "https://arevalo-roofing.com/" }, { url: "https://arevalo-roofing.com/techos" }], issues: [{ id: "missing-description", pages: ["https://arevalo-roofing.com/techos"], count: 1 }, { id: "images-no-alt", pages: ["a", "b"], count: 2 }, { id: "no-sitemap", pages: [], count: 1 }, { id: "thin-content", pages: ["a"], count: 1 }], site: {}, pagespeed: {}, score: 74 }, "2026-09-22T12:00:00Z"),
        row({ pages: [{ url: "https://arevalo-roofing.com/" }], issues: [], site: {}, pagespeed: {}, score: 66 }, "2026-08-15T12:00:00Z"),
      ],
      onpage: [
        row(
          {
            pages: [
              page("https://arevalo-roofing.com/techos", "Techos en Miami", 62, "Agrega 400 palabras más: los que ganan explican materiales, precios y garantías."),
              page("https://arevalo-roofing.com/goteras", "Reparación de goteras", 71, "Pon «goteras en el techo» en el título de la página."),
            ],
            createdAt: "2026-09-24T12:00:00Z",
          },
          "2026-09-24T12:00:00Z",
        ),
      ],
      gsc: [
        row(
          {
            totals: { clicks: 342, impressions: 12850, ctr: 0.0266, position: 14.2 },
            previous: { clicks: 301, impressions: 13400, ctr: 0.0225, position: 15.8 },
            range: { start: "2026-09-01", end: "2026-09-28" },
            previousRange: { start: "2026-08-04", end: "2026-08-31" },
            queries: [
              { key: "arevalo roofing", clicks: 120, impressions: 800, ctr: 0.15, position: 1.2 },
              { key: "techos miami", clicks: 41, impressions: 2100, ctr: 0.02, position: 8.4 },
            ],
            // Dos páginas se reparten «techos miami» (urgente) y otras dos «reparación de goteras» (leve).
            pageQueries: [
              { page: "https://arevalo-roofing.com/techos", query: "techos miami", clicks: 25, impressions: 1200, position: 8.1 },
              { page: "https://arevalo-roofing.com/blog/cuanto-cuesta-un-techo-en-miami", query: "techos miami", clicks: 16, impressions: 900, position: 9.2 },
              { page: "https://arevalo-roofing.com/goteras", query: "reparación de goteras", clicks: 8, impressions: 300, position: 6 },
              { page: "https://arevalo-roofing.com/blog/goteras-en-el-techo", query: "reparación de goteras", clicks: 0, impressions: 20, position: 28 },
            ],
          },
          "2026-09-29T12:00:00Z",
        ),
      ],
      gap: [
        row(
          {
            domain: "arevalo-roofing.com",
            location: {},
            rows: [
              { keyword: "roof replacement cost miami", volume: 1300, difficulty: 34, type: "missing", competitors: [{ domain: "perezroofing.com", position: 3 }], opportunity: 80 },
              { keyword: "techos de metal", volume: 480, difficulty: 21, type: "weak", yourPosition: 14, competitors: [{ domain: "techosya.com", position: 2 }], opportunity: 65 },
            ],
            createdAt: "2026-09-18T12:00:00Z",
          },
          "2026-09-18T12:00:00Z",
        ),
      ],
      article: [
        row({ keyword: "cuánto cuesta un techo nuevo en miami", draft: { markdown: "# Hola\n\nTexto" }, score: 86 }, "2026-09-26T12:00:00Z"),
        row({ keyword: "señales de que tu techo necesita reparación", draft: { markdown: "Texto" }, score: 74 }, "2026-09-12T12:00:00Z"),
      ],
      backlinks: [row(backlinksRep(34, 186, true), "2026-09-21T12:00:00Z"), row(backlinksRep(29, 171, false), "2026-08-21T12:00:00Z")],
      traffic: [row(trafficRep(), "2026-09-24T12:00:00Z")],
    },
    posts: [
      ...["facebook", "facebook", "facebook", "instagram", "instagram", "instagram", "instagram", "google", "google", "email"].map((channel, i) => ({ channel, at: at(`2026-09-${String(2 + i * 2).padStart(2, "0")}T15:00:00Z`) })),
      ...["facebook", "instagram", "google", "facebook", "instagram", "google"].map((channel, i) => ({ channel, at: at(`2026-08-${String(5 + i * 3).padStart(2, "0")}T15:00:00Z`) })),
    ],
  };
}

function emptyInputs(): ReportInputs {
  const r = richInputs();
  return { business: { ...r.business, name: "Negocio Nuevo", seoKeywords: null, seoLocations: null, seoLocationCode: null, seoLocationName: "", color: "not-a-color", color2: "", color3: "" }, rows: {}, posts: [] };
}

const monthPeriod = () => periodFor("mes-pasado", NOW, TZ);

// ---------- Periodos ----------

describe("periodFor", () => {
  it("last month = the previous calendar month in the business time zone, compared with the month before", () => {
    const p = periodFor("mes-pasado", NOW, TZ);
    expect(p.from.toISOString()).toBe("2026-09-01T04:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(p.prevFrom.toISOString()).toBe("2026-08-01T04:00:00.000Z");
    expect(p.prevTo.toISOString()).toBe("2026-09-01T04:00:00.000Z");
  });

  it("crosses the year and the daylight-saving change", () => {
    const p = periodFor("mes-pasado", new Date("2026-01-15T12:00:00Z"), TZ);
    expect(p.from.toISOString()).toBe("2025-12-01T05:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-01-01T05:00:00.000Z");
    expect(p.prevFrom.toISOString()).toBe("2025-11-01T04:00:00.000Z");
  });

  it("uses the local month, not the UTC one, near midnight", () => {
    // 22:00 del 30 de septiembre en Miami = 02:00 del 1 de octubre en UTC.
    const p = periodFor("este-mes", new Date("2026-10-01T02:00:00Z"), TZ);
    expect(p.from.toISOString()).toBe("2026-09-01T04:00:00.000Z");
    expect(p.prevFrom.toISOString()).toBe("2026-08-01T04:00:00.000Z");
  });

  it("this month compares with the same number of days of last month", () => {
    const p = periodFor("este-mes", NOW, TZ);
    expect(p.from.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(p.to).toEqual(NOW);
    expect(p.prevFrom.toISOString()).toBe("2026-09-01T04:00:00.000Z");
    expect(p.prevTo.toISOString()).toBe("2026-09-06T15:00:00.000Z");
  });

  it("last 30 days compares with the 30 days before", () => {
    const p = periodFor("30-dias", NOW, TZ);
    expect(NOW.getTime() - p.from.getTime()).toBe(30 * 86400_000);
    expect(p.prevTo).toEqual(p.from);
    expect(p.from.getTime() - p.prevFrom.getTime()).toBe(30 * 86400_000);
  });

  it("labels and file names", () => {
    expect(periodLabel(monthPeriod(), "es", TZ)).toBe("septiembre de 2026");
    expect(periodLabel(monthPeriod(), "en", TZ)).toBe("September 2026");
    expect(periodLabel(periodFor("este-mes", NOW, TZ), "es", TZ)).toMatch(/^1.6 de octubre de 2026$/);
    expect(reportFileName("Arévalo Roofing & Co.", monthPeriod(), "es", TZ)).toBe("reporte-seo-arevalo-roofing-co-2026-09.pdf");
    expect(reportFileName("¡¡!!", monthPeriod(), "en", TZ)).toBe("seo-report-business-2026-09.pdf");
  });
});

describe("isMonthlyDue", () => {
  it("is due on day 1 from 8:00 local time, once a month", () => {
    expect(isMonthlyDue(new Date("2026-10-01T12:00:00Z"), null, TZ)).toBe(true); // 8:00 EDT
    expect(isMonthlyDue(new Date("2026-10-01T11:59:00Z"), null, TZ)).toBe(false); // 7:59
    expect(isMonthlyDue(new Date("2026-10-02T13:00:00Z"), null, TZ)).toBe(false);
    expect(isMonthlyDue(new Date("2026-10-01T13:00:00Z"), new Date("2026-09-01T12:01:00Z"), TZ)).toBe(true);
    expect(isMonthlyDue(new Date("2026-10-01T13:00:00Z"), new Date("2026-10-01T12:01:00Z"), TZ)).toBe(false);
  });

  it("uses winter time in January and the local day near midnight", () => {
    expect(isMonthlyDue(new Date("2027-01-01T13:00:00Z"), null, TZ)).toBe(true); // 8:00 EST
    expect(isMonthlyDue(new Date("2027-01-01T12:30:00Z"), null, TZ)).toBe(false); // 7:30 EST
    expect(isMonthlyDue(new Date("2026-11-01T02:00:00Z"), null, TZ)).toBe(false); // 22:00 del 31 de octubre
  });
});

// ---------- Comparaciones ----------

describe("compare and pctChange", () => {
  it("knows that a lower position is better", () => {
    expect(compare(6.2, 8.5, { lowerIsBetter: true })).toEqual({ now: 6.2, before: 8.5, diff: -2.3, tone: "good" });
    expect(compare(9, 8, { lowerIsBetter: true }).tone).toBe("bad");
    expect(compare(40, 25).tone).toBe("good");
    expect(compare(40, 40).tone).toBe("neutral");
    expect(compare(40, null)).toEqual({ now: 40, before: null, diff: null, tone: "neutral" });
    expect(compare(null, 3).diff).toBeNull();
  });

  it("percent change", () => {
    expect(pctChange(120, 100)).toBe(20);
    expect(pctChange(90, 120)).toBe(-25);
    expect(pctChange(5, 0)).toBeNull();
  });
});

// ---------- Datos del reporte ----------

describe("buildReport", () => {
  const d = buildReport(richInputs(), monthPeriod(), NOW);

  it("compares rankings per zone with where they stood at the start of the period", () => {
    expect(d.rank?.zones.map((z) => z.label)).toEqual(["Miami, United States", "Doral, United States"]);
    const miami = d.rank!.zones[0];
    expect(miami.date).toBe("2026-09-29T12:00:00.000Z");
    expect(miami.baseDate).toBe("2026-08-30T12:00:00.000Z");
    expect(miami.avgPosition.tone).toBe("good");
    expect(miami.inTop10.now).toBe(4);
    expect(miami.inTop10.before).toBe(4);
    expect(d.rank!.climbs[0]).toMatchObject({ keyword: "reparación de techos", from: 12, to: 6 });
    expect(d.rank!.climbs.find((m) => m.keyword === "roof repair near me")).toMatchObject({ from: null, to: 18 });
    expect(d.rank!.drops.map((m) => m.keyword)).toContain("goteras en el techo");
    expect(d.rank!.distribution).toEqual({ top3: 1, top10: 3, top20: 3, out: 1 });
  });

  it("builds the keyword table with volumes and a cell per zone", () => {
    const line = d.rank!.keywords.find((k) => k.keyword === "techos miami")!;
    expect(line.volume).toBe(1900);
    expect(line.cells).toEqual([
      { now: 2, before: 4 },
      { now: 5, before: 6 },
    ]);
    expect(d.rank!.keywords).toHaveLength(KEYWORDS.length);
  });

  it("reads the heatmap, Google profile, AI, site, opportunities, articles and posts", () => {
    expect(d.maps).toMatchObject({ keyword: "roofing company", inPeriod: true, size: 5, points: 25, prev: { date: "2026-08-20T12:00:00.000Z" } });
    expect(d.maps!.grid).toHaveLength(5);
    expect(d.maps!.grid[0].map((c) => c.rank)).toEqual([1, 2, 2, 4, 6]);
    expect(d.maps!.top3Share).toBeGreaterThan(d.maps!.prev!.top3Share);
    expect(d.gbp).toMatchObject({ rating: 4.8, totalReviews: 128, newReviews: 4, prevNewReviews: 2, unanswered: 1 });
    expect(d.ai!.score).toMatchObject({ now: 75, before: 25, tone: "good" });
    expect(d.ai!.providers.map((p) => p.name)).toEqual(["Gemini", "ChatGPT"]);
    expect(d.audit!.score).toMatchObject({ now: 74, before: 66 });
    expect(d.audit!.issues).toHaveLength(3);
    expect(d.onpage).toMatchObject({ avgScore: 67, pages: 2 });
    expect(d.gsc).toMatchObject({ clicks: 342, prev: { clicks: 301 } });
    expect(d.gap!.rows[0]).toMatchObject({ keyword: "roof replacement cost miami", competitor: "perezroofing.com" });
    expect(d.articles.map((a) => a.score)).toEqual([86, 74]);
    expect(d.posts.total).toBe(10);
    expect(d.posts.prevTotal).toBe(6);
    expect(d.posts.byChannel[0]).toEqual({ channel: "instagram", count: 4 });
    expect(isEmptyReport(d)).toBe(false);
  });

  it("an old ranking from before the period shows no change", () => {
    const inputs = richInputs();
    inputs.rows.rank = inputs.rows.rank!.filter((r) => r.createdAt < monthPeriod().from);
    const old = buildReport(inputs, monthPeriod(), NOW);
    expect(old.rank!.zones[0].stale).toBe(true);
    expect(old.rank!.zones[0].avgPosition.diff).toBeNull();
    expect(old.rank!.climbs).toEqual([]);
  });

  it("empty business → empty report with setup hints", () => {
    const e = buildReport(emptyInputs(), monthPeriod(), NOW);
    expect(isEmptyReport(e)).toBe(true);
    expect(reportKpis(e)).toEqual([]);
    expect(setupHints(e, "es").length).toBeGreaterThanOrEqual(5);
  });

  it("gatherReport uses the loader it's given", async () => {
    const seen: string[] = [];
    const r = await gatherReport("biz1", monthPeriod(), {
      now: NOW,
      load: async (id) => {
        seen.push(id);
        return richInputs();
      },
    });
    expect(seen).toEqual(["biz1"]);
    expect(r.business.name).toBe("Arévalo Roofing & Co.");
    expect(r.rank?.zones).toHaveLength(2);
  });
});

describe("KPIs, facts and summaries", () => {
  const d = buildReport(richInputs(), monthPeriod(), NOW);

  it("has the 8 KPI tiles", () => {
    const k = reportKpis(d);
    expect(k.map((x) => x.id)).toEqual(["avgPosition", "top10", "mapTop3", "rating", "ai", "share", "links", "posts"]);
    expect(k.find((x) => x.id === "links")!.delta).toMatchObject({ now: 34, before: 29, tone: "good" });
    expect(k.find((x) => x.id === "share")!.delta.tone).toBe("good");
    expect(k.find((x) => x.id === "posts")!.delta).toMatchObject({ now: 10, before: 6, tone: "good" });
  });

  it("writes facts in both languages", () => {
    const es = summaryFacts(d, "es", TZ).map((f) => f.text);
    expect(es[0]).toBe("Periodo del reporte: septiembre de 2026.");
    expect(es.some((f) => f.includes("Google (Miami, United States): posición promedio"))).toBe(true);
    expect(es.some((f) => f.startsWith("Perfil de Google: 4,8 estrellas con 128 reseñas; 4 reseñas nuevas en el periodo (antes 2)"))).toBe(true);
    expect(es.some((f) => f.includes("75 % de las respuestas"))).toBe(true);
    expect(es.some((f) => f.includes("Publicaciones en redes y canales: 10 en el periodo (antes 6)"))).toBe(true);
    const en = summaryFacts(d, "en", TZ).map((f) => f.text);
    expect(en[0]).toBe("Report period: September 2026.");
    expect(en.some((f) => f.includes("342 clicks (+14%"))).toBe(true);
  });

  it("lists what changed, the most important first", () => {
    const c = whatChanged(d, "es");
    expect(c[0].text).toMatch(/^Tu posición promedio en Google mejoró/);
    expect(c.some((x) => x.tone === "bad")).toBe(true);
  });

  it("rule-based summary: a few sentences and 3 steps", () => {
    const s = ruleSummary(d, "es", TZ);
    expect(s.source).toBe("rules");
    expect(s.summary).toContain("Arévalo Roofing & Co.");
    expect(s.summary.split(/(?<=\.)\s/).length).toBeGreaterThanOrEqual(3);
    expect(s.steps).toHaveLength(3);
    expect(s.steps[0]).toContain("Contesta la reseña que está sin respuesta");
    expect(s.steps.join(" ")).not.toContain("undefined");
    const e = ruleSummary(buildReport(emptyInputs(), monthPeriod(), NOW), "en", TZ);
    expect(e.summary).toContain("no saved data");
    expect(e.steps[0]).toContain("Pick your areas and keywords");
  });

  it("numbersGrounded catches invented numbers", () => {
    const facts = ["342 clics (+14 %)", "posición promedio 8,2", "1.300 búsquedas al mes"];
    expect(numbersGrounded("Tuviste 342 clics, un 14 % más, y tu posición es 8.2. Hay 1,300 búsquedas. Haz 3 cosas.", facts)).toBe(true);
    expect(numbersGrounded("Tuviste 500 clics.", facts)).toBe(false);
    expect(numbersGrounded("Subiste 25 lugares.", facts)).toBe(false);
  });

  it("uses the AI summary only when it's grounded in the facts", async () => {
    const good = await reportSummary(d, "es", {
      ai: true,
      enabled: () => true,
      write: async ({ facts }) => {
        expect(facts[0]).toContain("septiembre de 2026");
        return { summary: "Fue un buen mes: las IAs te mencionan en el 75 % de las respuestas y tuviste 342 clics.", steps: ["Contesta las reseñas.", "Escribe un artículo.", "Publica más."] };
      },
    });
    expect(good.source).toBe("ai");
    const invented = await reportSummary(d, "es", { ai: true, enabled: () => true, write: async () => ({ summary: "Tuviste 9999 clics este mes, mucho más que antes.", steps: ["a", "b", "c"] }) });
    expect(invented.source).toBe("rules");
    const failing = await reportSummary(d, "es", { ai: true, enabled: () => true, write: async () => Promise.reject(new Error("sin saldo")) });
    expect(failing.source).toBe("rules");
    const off = await reportSummary(d, "es", { ai: false, enabled: () => true, write: async () => Promise.reject(new Error("no debería llamarse")) });
    expect(off.source).toBe("rules");
  });

  it("builds the email that carries the PDF", () => {
    const e = buildReportEmail(d, "es", ruleSummary(d, "es", TZ), { baseUrl: "https://app.test", tz: TZ });
    expect(e.subject).toBe("Reporte de SEO de Arévalo Roofing & Co. — septiembre de 2026");
    expect(e.html).toContain("https://app.test/b/biz1/seo#reporte");
    expect(e.html).toContain("Visibilidad en las IAs: 75 % (+50 pts vs. antes)");
    expect(e.html).toContain("Posición promedio en Google: 9,1 (+0,2 vs. antes)");
    expect(e.text).toContain("Reporte en PDF");
    expect(buildReportEmail(d, "en", null, { tz: TZ }).subject).toBe("SEO report for Arévalo Roofing & Co. — September 2026");
  });
});

describe("new tools in the report", () => {
  const d = buildReport(richInputs(), monthPeriod(), NOW);

  it("share of the market: Google, map and AIs at the end of the period vs. the start", () => {
    const m = d.market!;
    expect(m.organic!.you).toMatchObject({ now: 3.4, before: 2, diff: 1.4, tone: "good" });
    expect(m.organic!.share.leader?.label).toBe("perezroofing.com");
    expect(m.map!.you).toMatchObject({ now: 52, before: 16, tone: "good" });
    expect(m.ai!.you).toMatchObject({ now: 30, before: 12.5, tone: "good" });
    expect(m.date).toBe("2026-09-29T12:05:00.000Z");
  });

  it("how the AIs talk about you, links, competitors' visits and pages competing with each other", () => {
    expect(d.sentiment).toMatchObject({ positiva: 2, neutral: 0, negativa: 1, total: 3, before: null, attributes: ["garantía", "demoras", "precio justo", "rapidez"] });
    expect(d.sentiment!.negatives).toEqual([{ provider: "ChatGPT", reason: "Menciona quejas por demoras en los presupuestos", quote: "algunos clientes de Arévalo Roofing se quejan de demoras" }]);
    expect(d.links).toMatchObject({ referringDomains: { now: 34, before: 29, tone: "good" }, rank: { now: 186, before: 171 }, newDomains: 4, lostDomains: 1, gapTotal: 7, stale: false });
    expect(d.links!.gap.map((g) => g.domain)).toEqual(["miamichamber.com", "yelp.com", "miaminewtimes.com", "abcsupply.com", "houzz.com"]);
    expect(d.traffic!.rows.map((r) => [r.domain, r.etv, r.year])).toEqual([
      ["arevalo-roofing.com", 260, { from: 140, to: 260 }],
      ["perezroofing.com", 1850, { from: 900, to: 1850 }],
      ["techosya.com", 240, { from: 300, to: 240 }],
      ["roofpros.com", null, null],
    ]);
    expect(d.traffic!.rows[3].noData).toBe(true);
    expect(d.traffic!.lines[0].es).toBe("Hoy Perezroofing es quien más visitas recibe desde Google: unas 1850 al mes, 7 veces más que tú.");
    expect(d.cannibal).toMatchObject({ source: "gsc", total: 2, urgent: 1 });
    expect(d.cannibal!.issues[0]).toMatchObject({ query: "techos miami", severity: "alta", pages: ["arevalo-roofing.com/techos", "arevalo-roofing.com/blog/cuanto-cuesta-un-techo-en-miami"] });
    expect(d.cannibal!.issues[0].fix.es).toContain("Enlaza desde la página secundaria a la principal con el texto «techos miami»");
    expect(d.cannibal!.issues[0].fix.en).toContain("Link from the secondary page to the main one");
  });

  it("each part is missing without its data (old businesses keep working)", () => {
    const inputs = richInputs();
    delete inputs.rows.backlinks;
    delete inputs.rows.traffic;
    inputs.rows.gsc = inputs.rows.gsc!.map((r) => ({ ...r, data: { ...(r.data as object), pageQueries: undefined } }));
    inputs.rows.ai = inputs.rows.ai!.map((r) => ({ ...r, data: { ...(r.data as object), sentiment: undefined } }));
    const old = buildReport(inputs, monthPeriod(), NOW);
    expect(old.links).toBeNull();
    expect(old.traffic).toBeNull();
    expect(old.sentiment).toBeNull();
    // Sin Search Console por página, las posiciones de 30 días no tienen dos páginas tuyas para la misma palabra.
    expect(old.cannibal).toBeNull();
    expect(reportKpis(old).map((k) => k.id)).not.toContain("links");
    const e = buildReport(emptyInputs(), monthPeriod(), NOW);
    expect([e.market, e.sentiment, e.links, e.traffic, e.cannibal]).toEqual([null, null, null, null, null]);
    const onlyLinks = emptyInputs();
    onlyLinks.rows.backlinks = richInputs().rows.backlinks;
    expect(isEmptyReport(buildReport(onlyLinks, monthPeriod(), NOW))).toBe(false);
  });

  it("adds the facts (both languages) so the summary can mention them without inventing numbers", () => {
    const es = summaryFacts(d, "es", TZ);
    const fact = (area: string) => es.find((f) => f.area === area)!.text;
    expect(fact("market")).toBe(
      "Parte del mercado: Google: el negocio se lleva el 3,4 % de los clics posibles de sus búsquedas (antes 2 %); los directorios y redes, el 24 %; el competidor que más se lleva es perezroofing.com (30 %). Mapa de Google: sale entre los 3 primeros en el 52 % de los puntos (antes 16 %); Techos Pérez, en el 84 %. IAs: 30 % de las veces que nombran un negocio (antes 12,5 %); Techos Pérez, 40 %.",
    );
    expect(fact("sentiment")).toBe(
      "Cómo hablan las IAs del negocio: 3 menciones: 2 positivas, 1 negativa; lo asocian con garantía, demoras, precio justo. Mención negativa de ChatGPT: Menciona quejas por demoras en los presupuestos.",
    );
    expect(fact("links")).toContain("Enlaces: 34 sitios enlazan al sitio (antes 29; mejoró 5); fuerza 186 de 1000; en el último mes 4 nuevos y 1 perdido");
    expect(fact("traffic")).toContain("Visitas al mes desde Google (estimadas, United States): el negocio unas 260; Perezroofing unas 1850; Techosya unas 240.");
    expect(fact("cannibal")).toMatch(/^Páginas que compiten entre sí: 2 búsquedas \(1 urgente\); la primera, «techos miami»: Enlaza/);
    const en = summaryFacts(d, "en", TZ).map((f) => f.text);
    expect(en.some((f) => f.startsWith("Share of the market: Google: the business gets 3.4% of the possible clicks"))).toBe(true);
    expect(en.some((f) => f.startsWith("Links: 34 sites link to the website"))).toBe(true);
    // Lo que diga la IA con estos números pasa el control de números inventados.
    expect(numbersGrounded("Te llevas el 3,4 % de los clics, 34 sitios te enlazan y Perezroofing recibe 1850 visitas.", es.map((f) => f.text))).toBe(true);
  });

  it("what changed and the next steps use them too", () => {
    const c = whatChanged(d, "es").map((x) => x.text);
    expect(c).toContain("Tu parte de los clics de Google pasó del 2 % al 3,4 %.");
    expect(c).toContain("Sitios que te enlazan: de 29 a 34.");
    expect(c).toContain("Una IA habló mal de ti en 1 respuesta.");
    const s = ruleSummary(d, "es", TZ);
    expect(s.steps[1]).toMatch(/^Para «techos miami» tienes páginas que compiten entre sí: enlaza desde la página secundaria/);
    expect(s.steps[2]).toBe("Mira qué dice ChatGPT de ti en «Visibilidad en las IAs» y responde a eso en tu página y en tus reseñas.");
  });
});

describe("email attachments", () => {
  it("formats attachments for Brevo and Resend", () => {
    const files = [{ name: "r.pdf", content: Buffer.from("%PDF-1.4") }];
    expect(attachmentPayload(files, true)).toEqual({ attachment: [{ name: "r.pdf", content: "JVBERi0xLjQ=" }] });
    expect(attachmentPayload(files, false)).toEqual({ attachments: [{ filename: "r.pdf", content: "JVBERi0xLjQ=" }] });
    expect(attachmentPayload(undefined, true)).toEqual({});
  });
});

// ---------- PDF ----------

describe("PDF helpers", () => {
  it("brand palette with fallbacks", () => {
    expect(palette("#0E5A8A", "", "").primary).toBe("#0e5a8a");
    expect(palette("nope", "", "").primary).toBe("#126bbc");
    expect(palette("#fff", "", "").onPrimary).toBe("#111827");
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(trunc("a".repeat(20), 10)).toBe(`${"a".repeat(9)}…`);
  });

  it("normalizes a logo to PNG and rejects what isn't an image", async () => {
    const jpg = await sharp({ create: { width: 900, height: 300, channels: 3, background: "#0e5a8a" } }).jpeg().toBuffer();
    const logo = await normalizeLogo(jpg);
    expect(logo?.format).toBe("png");
    expect((await sharp(logo!.data).metadata()).width).toBe(480);
    expect(await normalizeLogo(Buffer.from("<html>not an image</html>"))).toBeNull();
  });

  it("loads the logo with a short fetch and skips what fails", async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#ff000080" } }).png().toBuffer();
    const calls: string[] = [];
    const fake = (body: Buffer | string, status = 200) =>
      (async (url: string | URL | Request) => {
        calls.push(String(url));
        return new Response(typeof body === "string" ? body : new Uint8Array(body), { status });
      }) as typeof fetch;
    expect((await loadLogo("https://cdn.example.com/logo.png", { fetchImpl: fake(png) }))?.format).toBe("png");
    expect(await loadLogo("https://cdn.example.com/logo.png", { fetchImpl: fake(png, 404) })).toBeNull();
    expect(await loadLogo("https://cdn.example.com/logo.png", { fetchImpl: fake("<html></html>") })).toBeNull();
    expect(await loadLogo("https://cdn.example.com/logo.png", { fetchImpl: (async () => Promise.reject(new Error("timeout"))) as typeof fetch })).toBeNull();
    const before = calls.length;
    expect(await loadLogo("http://127.0.0.1/logo.png", { fetchImpl: fake(png) })).toBeNull();
    expect(await loadLogo("not a url", { fetchImpl: fake(png) })).toBeNull();
    expect(calls.length).toBe(before);
  });
});

describe("renderReportPdf (smoke)", () => {
  const out = process.env.REPORT_PDF_DIR;

  it("renders a rich report", async () => {
    const d = buildReport(richInputs(), monthPeriod(), NOW);
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" rx="40" fill="#0E5A8A"/><path d="M30 120 L100 50 L170 120" stroke="#F2A900" stroke-width="18" fill="none"/><text x="100" y="170" font-size="34" text-anchor="middle" fill="#fff" font-family="Arial" font-weight="bold">AR</text></svg>`,
    );
    const logo = await normalizeLogo(svg);
    const started = Date.now();
    const pdf = await renderReportPdf(d, { lang: "es", summary: ruleSummary(d, "es", TZ), whiteLabel: false, logo, tz: TZ });
    const ms = Date.now() - started;
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(10_000);
    // Con todas las secciones (también las nuevas) el reporte sigue siendo corto.
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeLessThanOrEqual(7);
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(path.join(out, "report-rich.pdf"), pdf);
      const en = await renderReportPdf(d, { lang: "en", summary: ruleSummary(d, "en", TZ), whiteLabel: true, logo, tz: TZ });
      writeFileSync(path.join(out, "report-rich-en.pdf"), en);
      console.log(`report-rich.pdf: ${pdf.length} bytes in ${ms} ms`);
    }
  }, 30_000);

  it("renders an empty business as a short PDF", async () => {
    const d = buildReport(emptyInputs(), monthPeriod(), NOW);
    const pdf = await renderReportPdf(d, { lang: "es", summary: ruleSummary(d, "es", TZ), whiteLabel: false, logo: null, tz: TZ });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBe(1);
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(path.join(out, "report-empty.pdf"), pdf);
      console.log(`report-empty.pdf: ${pdf.length} bytes`);
    }
  }, 30_000);
});
