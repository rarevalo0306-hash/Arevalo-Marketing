import { describe, expect, it } from "vitest";
import { translator } from "@/lib/i18n";
import type { AuditPage } from "@/lib/seo/audit";
import {
  auditCannibals,
  buildCannibal,
  byMain,
  cannibalSummary,
  type CannibalPage,
  chooseFix,
  cleanUrl,
  compareCannibal,
  fixText,
  gscCannibals,
  gscSeverity,
  isArticle,
  issueWhy,
  pageKey,
  placeList,
  placeOf,
  rankCannibals,
  readCannibalReport,
} from "@/lib/seo/cannibal";
import { asGscReport, type GscPageQuery } from "@/lib/seo/gsc";
import { readRankReport, type RankReport } from "@/lib/seo/rank";
import fameseg from "./fixtures/fameseg.json";

const es = translator("es");
const en = translator("en");
const SITE = "https://fameseg.com";
const pq = (page: string, query: string, clicks: number, impressions: number, position: number): GscPageQuery => ({ page: `${SITE}${page}`, query, clicks, impressions, position });

// Forma real de un reporte "gsc" guardado (ver searchConsoleReport en src/lib/seo/gsc.ts), con pares página + búsqueda de Fameseg.
const gscSaved = {
  version: 1,
  siteUrl: "sc-domain:fameseg.com",
  fetchedAt: "2026-10-06T08:00:00.000Z",
  range: { start: "2026-09-06", end: "2026-10-03" },
  previousRange: { start: "2026-08-09", end: "2026-09-05" },
  totals: { clicks: 61, impressions: 2210, ctr: 0.0276, position: 9.8 },
  previous: { clicks: 48, impressions: 1870, ctr: 0.0257, position: 11.2 },
  queries: [],
  pages: [],
  devices: [],
  countries: [],
  opportunities: [],
  lowCtr: [],
  pageQueries: [
    // 1. La página de Managua y el artículo de precios se reparten "cortinas metálicas managua" (+ la misma página con www y barra final).
    pq("/cobertura/managua", "cortinas metalicas managua", 9, 140, 4.2),
    pq("/blog/cuanto-cuesta-una-cortina-metalica-en-nicaragua", "cortinas metalicas managua", 4, 150, 3.1),
    { page: "https://www.fameseg.com/cobertura/managua/?utm_source=x", query: "cortinas metalicas managua", clicks: 1, impressions: 20, position: 5 },
    pq("/", "cortinas metalicas managua", 0, 2, 18), // < 3 impresiones: no cuenta
    // 2. Búsquedas con el nombre del negocio: es normal que salgan varias páginas.
    pq("/", "fameseg", 20, 90, 1),
    pq("/contacto", "fameseg", 3, 40, 2),
    pq("/", "fameseg.com", 2, 10, 1),
    pq("/contacto", "fameseg.com", 1, 8, 2),
    // 3. Dos páginas del mismo tema: hay que unirlas.
    pq("/servicios/cortinas-metalicas", "cortinas metálicas", 3, 80, 8),
    pq("/cortinas-metalicas", "cortinas metálicas", 1, 60, 11),
    // 4. Una página por ciudad: está bien.
    pq("/cobertura/leon", "cortinas metalicas leon", 2, 40, 6),
    pq("/cobertura/managua", "cortinas metalicas leon", 0, 25, 14),
    // 5. La otra casi no sale (5,7 %): basta un enlace.
    pq("/portones-automaticos", "portones automaticos", 5, 200, 6),
    pq("/servicios/portones-electricos", "portones automaticos", 0, 12, 25),
    // 6. Una sola página: no hay competencia.
    pq("/servicios/mantenimiento", "mantenimiento cortinas metalicas", 2, 70, 7),
    // 7. La segunda tiene menos del 5 %: no cuenta.
    pq("/cortinas-tubulares", "cortinas tubulares", 4, 100, 5),
    pq("/blog/tipos-de-cortinas", "cortinas tubulares", 0, 4, 30),
  ],
};

const auditPage = (path: string, title: string, h1: string, extra: Partial<AuditPage> = {}): AuditPage => ({
  url: `${SITE}${path}`,
  finalUrl: `${SITE}${path}`,
  status: 200,
  ms: 300,
  bytes: 40_000,
  title,
  description: "",
  h1Count: 1,
  h1,
  canonical: "",
  noindex: false,
  lang: "es",
  images: 3,
  imagesNoAlt: 0,
  words: 600,
  internalLinks: 12,
  viewport: true,
  ogImage: true,
  jsonLd: true,
  schema: [],
  https: true,
  ...extra,
});

const audit = {
  site: { home: `${SITE}/` } as never,
  pages: [
    auditPage("/", "FAMESEG | Cortinas metálicas y portones en Nicaragua", "Cortinas metálicas y portones automáticos"),
    auditPage("/cobertura/managua", "Cortinas metálicas en Managua: fabricación e instalación | FAMESEG", "Cortinas metálicas en Managua"),
    auditPage("/blog/cuanto-cuesta-una-cortina-metalica-en-nicaragua", "¿Cuánto cuesta una cortina metálica en Nicaragua? Lo que define el precio", "¿Cuánto cuesta una cortina metálica?"),
    auditPage("/servicios/cortinas-metalicas", "Cortinas metálicas | FAMESEG", "Cortinas metálicas"),
    auditPage("/cortinas-metalicas", "Cortinas metálicas enrollables | FAMESEG", "Cortinas metálicas enrollables"),
    auditPage("/cobertura/leon", "Cortinas metálicas en León | FAMESEG", "Cortinas metálicas en León"),
    // Mismo título y H1 que otra (posible competencia), y una con noindex que no cuenta.
    auditPage("/portones-electricos", "Portones eléctricos para cochera | FAMESEG", "Portones eléctricos para cochera"),
    auditPage("/servicios/portones-electricos", "Portones eléctricos para cochera - Fameseg", "Portones eléctricos para cochera"),
    auditPage("/borrador-portones", "Portones eléctricos para cochera | FAMESEG", "Portones eléctricos para cochera", { noindex: true }),
  ],
};

const ctx = { brand: ["Fameseg", "fameseg"], places: placeList([{ name: "Nicaragua", type: "Country" }]) };

describe("direcciones", () => {
  it("normaliza http/https, www, barra final, parámetros y #", () => {
    expect(pageKey("https://www.Fameseg.com/cobertura/managua/?utm_source=x#top")).toBe("fameseg.com/cobertura/managua");
    expect(pageKey("http://fameseg.com/cobertura/managua")).toBe("fameseg.com/cobertura/managua");
    expect(pageKey("https://fameseg.com/")).toBe("fameseg.com");
    expect(pageKey("https://fameseg.com/le%C3%B3n")).toBe("fameseg.com/león");
    expect(cleanUrl("https://fameseg.com/a?b=1#c")).toBe("https://fameseg.com/a");
  });

  it("reconoce artículos y ciudades (no países)", () => {
    expect(isArticle("https://fameseg.com/blog/cuanto-cuesta")).toBe(true);
    expect(isArticle("https://fameseg.com/2025/03/portones")).toBe(true);
    expect(isArticle("https://fameseg.com/cobertura/managua")).toBe(false);
    const places = placeList([{ name: "Masaya,Masaya,Nicaragua", type: "City" }, { name: "Nicaragua", type: "Country" }]);
    expect(places).toContain("masaya");
    expect(places).not.toContain("nicaragua");
    expect(placeOf({ url: `${SITE}/cobertura/leon` }, places)).toBe("leon");
    expect(placeOf({ url: `${SITE}/portones`, title: "Portones en Estelí" }, places)).toBe("esteli");
    expect(placeOf({ url: `${SITE}/blog/precio`, title: "¿Cuánto cuesta una cortina metálica en Nicaragua?" }, places)).toBeNull();
    // "/en/" es el idioma, no una ciudad.
    expect(placeOf({ url: `${SITE}/en/about` }, places)).toBeNull();
  });
});

describe("Search Console", () => {
  const gsc = asGscReport(gscSaved)!;
  const titles = new Map(audit.pages.map((p) => [pageKey(p.url), p.title]));
  const issues = gscCannibals(gsc.pageQueries, { ...ctx, titles });
  const find = (q: string) => issues.find((i) => i.query === q);

  it("solo marca búsquedas con 2+ páginas que cuentan, sin las del nombre del negocio", () => {
    expect(issues.map((i) => i.query).sort()).toEqual(["cortinas metalicas leon", "cortinas metalicas managua", "cortinas metálicas", "portones automaticos"]);
  });

  it("une las variantes de la misma página y elige la principal por clics", () => {
    const i = find("cortinas metalicas managua")!;
    expect(i.pages).toHaveLength(2);
    expect(i.pages[0]).toMatchObject({
      url: "https://fameseg.com/cobertura/managua",
      clicks: 10,
      impressions: 160,
      main: true,
      title: "Cortinas metálicas en Managua: fabricación e instalación | FAMESEG",
    });
    expect(i.pages[0].position).toBeCloseTo(4.3, 1);
    expect(i.pages[1]).toMatchObject({ url: `${SITE}/blog/cuanto-cuesta-una-cortina-metalica-en-nicaragua`, clicks: 4, impressions: 150, main: false });
    expect(i.totalImpressions).toBe(312);
    expect(i.totalClicks).toBe(14);
    expect(i.pages[0].share! + i.pages[1].share!).toBeCloseTo(310 / 312, 5);
    expect(i.severity).toBe("alta");
    expect(i.fix).toBe("link");
    expect(i.anchor).toBe("cortinas metalicas managua");
    expect(fixText(i, es)).toBe(
      "Enlaza desde la página secundaria a la principal con el texto «cortinas metalicas managua»: en fameseg.com/blog/cuanto-cuesta-una-cortina-metalica-en-nicaragua, agrega un enlace a fameseg.com/cobertura/managua.",
    );
    expect(issueWhy(i, es)).toContain("2 de tus páginas");
  });

  it("dos páginas del mismo tema → unirlas (301)", () => {
    const i = find("cortinas metálicas")!;
    expect(i.fix).toBe("merge");
    expect(i.severity).toBe("alta");
    expect(i.pages[0].url).toBe(`${SITE}/servicios/cortinas-metalicas`);
    expect(fixText(i, es)).toMatch(/^Une las dos páginas en una y redirige la otra \(301\)/);
    expect(fixText(i, en)).toMatch(/^Merge both pages into one and redirect the other \(301\)/);
  });

  it("páginas de ciudades distintas → está bien, que cada título diga su ciudad (leve)", () => {
    const i = find("cortinas metalicas leon")!;
    expect(i.fix).toBe("zones");
    expect(i.places).toEqual(["leon", "managua"]);
    expect(i.severity).toBe("baja");
    expect(fixText(i, es)).toBe("Si son para zonas distintas (Leon y Managua), está bien: haz que cada título diga su ciudad para que Google muestre la correcta.");
  });

  it("la otra casi no sale → un enlace basta y es leve", () => {
    const i = find("portones automaticos")!;
    expect(i.fix).toBe("link");
    expect(i.severity).toBe("baja");
  });
});

describe("severidad y principal", () => {
  const p = (impressions: number, position: number, share: number) => ({ impressions, position, share });
  it("alta solo si están parejas y las dos en página 1–2", () => {
    expect(gscSeverity([p(100, 5, 0.5), p(90, 12, 0.45)], 190)).toBe("alta");
    expect(gscSeverity([p(100, 5, 0.5), p(90, 25, 0.45)], 190)).toBe("media");
    expect(gscSeverity([p(100, 5, 0.5), p(90, 35, 0.45)], 190)).toBe("baja");
    expect(gscSeverity([p(100, 5, 0.75), p(30, 9, 0.25)], 130)).toBe("media");
    expect(gscSeverity([p(100, 5, 0.9), p(10, 40, 0.09)], 110)).toBe("baja");
    // Muy pocas impresiones: no es urgente.
    expect(gscSeverity([p(4, 5, 0.5), p(4, 6, 0.5)], 8)).toBe("media");
  });

  it("principal = más clics, después mejor posición, después más impresiones", () => {
    const page = (clicks: number, position: number, impressions: number): CannibalPage => ({
      url: `${SITE}/${clicks}-${position}-${impressions}`,
      title: null,
      clicks,
      impressions,
      position,
      share: null,
      seen: null,
      zones: [],
      main: false,
    });
    expect([page(1, 2, 500), page(3, 9, 10)].sort(byMain)[0].clicks).toBe(3);
    expect([page(2, 9, 500), page(2, 4, 10)].sort(byMain)[0].position).toBe(4);
    expect([page(0, 6, 50), page(0, 6, 80)].sort(byMain)[0].impressions).toBe(80);
  });

  it("con la página de inicio, la recomendación es un enlace", () => {
    const page = (path: string, share: number): CannibalPage => ({ url: `${SITE}${path}`, title: null, clicks: 1, impressions: 50, position: 5, share, seen: null, zones: [], main: false });
    expect(chooseFix("portones", page("/", 0.5), page("/portones", 0.5), ctx).fix).toBe("link");
    expect(chooseFix("portones", page("/portones-de-garaje", 0.5), page("/rejas", 0.5), ctx).fix).toBe("retarget");
    expect(fixText({ ...chooseFix("portones", page("/portones-de-garaje", 0.5), page("/rejas", 0.5), ctx), query: "portones", source: "gsc", severity: "media", totalImpressions: 100, totalClicks: 2, checks: null, pages: [{ ...page("/portones-de-garaje", 0.5), main: true }, page("/rejas", 0.5)] }, es)).toBe(
      "Deja fameseg.com/portones-de-garaje como la página principal para «portones» y cambia el título y el tema de fameseg.com/rejas hacia otra búsqueda.",
    );
  });
});

describe("posiciones (cuando no hay Search Console)", () => {
  const real = readRankReport(fameseg.reports.rank.data)!;
  const now = new Date("2026-10-12T12:00:00Z");
  const later: RankReport = {
    ...real,
    createdAt: "2026-10-11T07:00:00.000Z",
    rows: real.rows.map((r) =>
      r.keyword === "cortinas metálicas managua"
        ? { ...r, position: 5, url: "https://fameseg.com/cobertura/managua", top: [] }
        : r.keyword === "portones tipo americano nicaragua"
          ? // Dos páginas tuyas a la vez en la misma búsqueda.
            { ...r, top: [{ position: 9, domain: "fameseg.com", title: "Portones", url: "https://fameseg.com/portones-tipo-americano" }] }
          : r,
    ),
  };
  const old: RankReport = { ...later, createdAt: "2026-08-01T07:00:00.000Z", rows: later.rows.map((r) => ({ ...r, url: r.url ? `${r.url}-viejo` : null, top: [] })) };

  it("marca las palabras donde la página que sale cambia (últimos 30 días)", () => {
    const issues = rankCannibals([real, later, old], { ...ctx, domain: "fameseg.com", now });
    expect(issues.map((i) => i.query).sort()).toEqual(["cortinas metálicas managua", "portones tipo americano nicaragua"]);
    const i = issues.find((x) => x.query === "cortinas metálicas managua")!;
    expect(i.source).toBe("rank");
    expect(i.checks).toBe(2);
    // Sin clics: la principal es la que salió más arriba.
    expect(i.pages[0]).toMatchObject({ url: `${SITE}/blog/cuanto-cuesta-una-cortina-metalica-en-nicaragua`, position: 2, seen: 1, main: true });
    expect(i.pages[1]).toMatchObject({ url: `${SITE}/cobertura/managua`, position: 5, seen: 1 });
    expect(i.severity).toBe("baja");
    expect(i.fix).toBe("link");
    expect(issueWhy(i, es)).toMatch(/^Google no se decide entre dos de tus páginas/);
  });

  it("no cuenta el nombre del negocio ni revisiones viejas", () => {
    const brand: RankReport = { ...later, rows: [{ ...later.rows[0], keyword: "fameseg cortinas", url: `${SITE}/a` }, { ...later.rows[0], keyword: "fameseg cortinas", url: `${SITE}/b` }] };
    expect(rankCannibals([brand], { ...ctx, domain: "fameseg.com", now })).toEqual([]);
    expect(rankCannibals([old], { ...ctx, domain: "fameseg.com", now })).toEqual([]);
  });
});

describe("revisión de la página", () => {
  it("marca páginas con el mismo título o H1 (sin noindex)", () => {
    const issues = auditCannibals(audit, ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ source: "audit", severity: "baja", fix: "retarget", query: "Portones eléctricos para cochera" });
    expect(issues[0].pages.map((p) => p.url)).toEqual([`${SITE}/portones-electricos`, `${SITE}/servicios/portones-electricos`]);
    expect(issueWhy(issues[0], es)).toMatch(/^Posible competencia entre páginas/);
  });

  it("no repite lo que ya marcó Search Console", () => {
    const skip = [
      {
        query: "portones",
        source: "gsc" as const,
        severity: "media" as const,
        totalImpressions: 10,
        totalClicks: 0,
        checks: null,
        fix: "link" as const,
        anchor: null,
        places: [],
        pages: [`${SITE}/portones-electricos`, `${SITE}/servicios/portones-electricos/`].map((url) => ({ url, title: null, clicks: 0, impressions: 5, position: 9, share: 0.5, seen: null, zones: [], main: false })),
      },
    ];
    expect(auditCannibals(audit, { ...ctx, skip })).toEqual([]);
  });
});

describe("todo junto y guardado", () => {
  const gsc = asGscReport(gscSaved)!;
  const base = { businessName: "Fameseg", website: "https://fameseg.com", zones: [{ name: "Nicaragua", type: "Country" }], now: new Date("2026-10-06T12:00:00Z") };

  it("usa Search Console cuando hay; ordena por severidad", () => {
    const r = buildCannibal({ ...base, gsc: { pageQueries: gsc.pageQueries, range: gsc.range }, ranks: [readRankReport(fameseg.reports.rank.data)!], audit });
    expect(r.source).toBe("gsc");
    expect(r.gscRange).toEqual({ start: "2026-09-06", end: "2026-10-03" });
    expect(r.issues.map((i) => i.severity)).toEqual(["alta", "alta", "baja", "baja", "baja"]);
    expect(r.issues[0].query).toBe("cortinas metalicas managua");
    expect(r.issues.some((i) => i.source === "rank")).toBe(false);
    expect(r.issues.filter((i) => i.source === "audit")).toHaveLength(1);
    expect(cannibalSummary(r, es)).toBe("5 búsquedas tienen varias páginas tuyas compitiendo (2 urgentes). La primera: «cortinas metalicas managua».");
  });

  it("sin pares de Search Console (reporte viejo) usa las posiciones; sin nada, no hay fuente", () => {
    const r = buildCannibal({ ...base, gsc: { pageQueries: [], range: gsc.range }, ranks: [], audit: null });
    expect(r.source).toBeNull();
    expect(cannibalSummary(r, es)).toBeNull();
    const onlyAudit = buildCannibal({ ...base, gsc: null, ranks: [], audit });
    expect(onlyAudit.source).toBe("audit");
    expect(onlyAudit.gscRange).toBeNull();
  });

  it("sin problemas: mensaje positivo", () => {
    const r = buildCannibal({ ...base, gsc: { pageQueries: gscSaved.pageQueries.slice(4, 8), range: gsc.range }, ranks: [], audit: null });
    expect(r.issues).toEqual([]);
    expect(cannibalSummary(r, en)).toBe("None of your pages compete with each other for the same search. Nice!");
  });

  it("se lee lo guardado (y lo dañado no rompe nada)", () => {
    const r = buildCannibal({ ...base, gsc: { pageQueries: gsc.pageQueries, range: gsc.range }, ranks: [], audit });
    const back = readCannibalReport(JSON.parse(JSON.stringify(r)));
    expect(back).toEqual(r);
    expect(readCannibalReport(null)).toBeNull();
    expect(readCannibalReport({ issues: [{ query: "x", pages: [{ url: "a" }] }, { query: "y", pages: [{ url: "a" }, { url: "b" }], severity: "rara" }] })).toMatchObject({
      source: null,
      issues: [{ query: "y", severity: "baja", fix: "retarget", pages: [{ url: "a", main: true }, { url: "b", main: false }] }],
    });
  });

  it("compara con la revisión anterior", () => {
    const now = buildCannibal({ ...base, gsc: { pageQueries: gsc.pageQueries, range: gsc.range }, ranks: [], audit: null });
    const before = { ...now, issues: [...now.issues.slice(1), { ...now.issues[0], query: "otra búsqueda" }] };
    expect(compareCannibal(now, before)).toEqual({ added: 1, solved: 1 });
    expect(compareCannibal(now, null)).toEqual({ added: now.issues.length, solved: 0 });
  });
});
