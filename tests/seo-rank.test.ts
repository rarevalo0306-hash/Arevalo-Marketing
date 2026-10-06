import { describe, expect, it } from "vitest";
import {
  compareRuns,
  ctrFor,
  domainMatches,
  nameMatches,
  normalizeName,
  parseSerp,
  rankSetup,
  readRankReport,
  siteDomain,
  summarize,
  visibilityScore,
  type RankReport,
  type RankRow,
  type SerpResult,
} from "@/lib/seo/rank";

const row = (keyword: string, position: number | null, extra: Partial<RankRow> = {}): RankRow => ({
  keyword,
  position,
  url: position ? `https://techosperez.com/${keyword.replace(/ /g, "-")}` : null,
  localPack: null,
  top: [],
  features: [],
  ...extra,
});

const report = (rows: RankRow[]): RankReport => ({
  location: "Miami,Florida,United States",
  locationCode: 1015116,
  language: "es",
  device: "mobile",
  rows,
  cost: 0.007,
  createdAt: "2026-10-05T13:00:00.000Z",
  ...summarize(rows),
});

describe("siteDomain / domainMatches", () => {
  it("limpia www, protocolo, rutas y mayúsculas", () => {
    expect(siteDomain("https://www.TechosPerez.com/servicios?x=1")).toBe("techosperez.com");
    expect(siteDomain("http://techosperez.com")).toBe("techosperez.com");
    expect(siteDomain("techosperez.com/contacto")).toBe("techosperez.com");
    expect(siteDomain("www.techosperez.com.")).toBe("techosperez.com");
    expect(siteDomain("")).toBe("");
    expect(siteDomain("   ")).toBe("");
  });
  it("acepta el mismo dominio y subdominios, no dominios parecidos", () => {
    expect(domainMatches("www.techosperez.com", "https://techosperez.com/")).toBe(true);
    expect(domainMatches("tienda.techosperez.com", "techosperez.com")).toBe(true);
    expect(domainMatches("https://techosperez.com/blog/x", "www.techosperez.com")).toBe(true);
    expect(domainMatches("mitechosperez.com", "techosperez.com")).toBe(false);
    expect(domainMatches("techosperez.com.evil.net", "techosperez.com")).toBe(false);
    expect(domainMatches("techosperez.co", "techosperez.com")).toBe(false);
    expect(domainMatches("", "techosperez.com")).toBe(false);
    expect(domainMatches("techosperez.com", "")).toBe(false);
  });
});

describe("nombres del mapa", () => {
  it("normaliza acentos, mayúsculas, signos y LLC/Inc", () => {
    expect(normalizeName("Techos Pérez, LLC")).toBe("techos perez");
    expect(normalizeName("TECHOS PEREZ L.L.C.")).toBe("techos perez");
    expect(normalizeName("Smith & Sons Inc.")).toBe("smith and sons");
    expect(normalizeName("Panadería Ñandú S.A.")).toBe("panaderia nandu");
  });
  it("encuentra el negocio aunque el título tenga más palabras", () => {
    expect(nameMatches("Techos Perez - Roofing Contractor Miami", "Techos Pérez LLC")).toBe(true);
    expect(nameMatches("TECHOS PÉREZ", "techos perez")).toBe(true);
    expect(nameMatches("Techos Pereza Roofing", "Techos Pérez")).toBe(false);
    expect(nameMatches("ABC Roofing", "ABC")).toBe(false); // demasiado corto para comparar por partes
    expect(nameMatches("Otro negocio", "Techos Pérez")).toBe(false);
  });
});

const SERP: SerpResult = {
  keyword: "techos miami",
  item_types: ["paid", "local_pack", "organic", "people_also_ask"],
  items: [
    { type: "paid", rank_group: 1, rank_absolute: 1, domain: "ads.com", url: "https://ads.com", title: "Anuncio" },
    { type: "local_pack", rank_group: 1, rank_absolute: 2, title: "Miami Roof Pros", domain: "miamiroofpros.com" },
    { type: "local_pack", rank_group: 2, rank_absolute: 3, title: "Techos Pérez LLC" },
    { type: "local_pack", rank_group: 3, rank_absolute: 4, title: "Roof Kings" },
    { type: "organic", rank_group: 2, rank_absolute: 6, domain: "yelp.com", url: "https://www.yelp.com/x", title: "Los 10 mejores" },
    { type: "organic", rank_group: 1, rank_absolute: 5, domain: "www.miamiroofpros.com", url: "https://www.miamiroofpros.com/", title: "Miami Roof Pros" },
    { type: "people_also_ask", rank_group: 1, rank_absolute: 7, title: "¿Cuánto cuesta un techo?" },
    { type: "organic", rank_group: 3, rank_absolute: 8, domain: "angi.com", url: "https://angi.com/a", title: "Angi" },
    { type: "organic", rank_group: 4, rank_absolute: 9, domain: "homeadvisor.com", url: "https://homeadvisor.com/a", title: "HomeAdvisor" },
    { type: "organic", rank_group: 5, rank_absolute: 10, domain: "bbb.org", url: "https://bbb.org/a", title: "BBB" },
    { type: "organic", rank_group: 6, rank_absolute: 11, domain: "blog.techosperez.com", url: "https://blog.techosperez.com/techos", title: "Techos en Miami" },
    { type: "organic", rank_group: 7, rank_absolute: 12, domain: "techosperez.com", url: "https://techosperez.com/", title: "Inicio" },
  ],
};

describe("parseSerp", () => {
  it("toma la primera posición orgánica del negocio, el mapa, el top 5 y lo que muestra Google", () => {
    const r = parseSerp("techos miami", SERP, "https://www.techosperez.com", "Techos Pérez");
    expect(r.position).toBe(6);
    expect(r.url).toBe("https://blog.techosperez.com/techos");
    expect(r.localPack).toEqual({ position: 2, names: ["Miami Roof Pros", "Techos Pérez LLC", "Roof Kings"] });
    expect(r.top.map((x) => x.position)).toEqual([1, 2, 3, 4, 5]);
    expect(r.top[0]).toEqual({ position: 1, domain: "miamiroofpros.com", title: "Miami Roof Pros", url: "https://www.miamiroofpros.com/" });
    expect(r.features).toEqual(["ads", "local_pack", "people_also_ask"]);
    expect(r.error).toBeUndefined();
  });
  it("encuentra el mapa por dominio aunque el nombre no coincida", () => {
    const r = parseSerp("techos miami", SERP, "miamiroofpros.com", "Otro nombre");
    expect(r.position).toBe(1);
    expect(r.localPack?.position).toBe(1);
  });
  it("sin coincidencias: posición null y mapa sin el negocio", () => {
    const r = parseSerp("techos miami", SERP, "nadie.com", "Nadie");
    expect(r.position).toBeNull();
    expect(r.url).toBeNull();
    expect(r.localPack).toEqual({ position: null, names: ["Miami Roof Pros", "Techos Pérez LLC", "Roof Kings"] });
  });
  it("sin mapa → localPack null; acepta negocios del mapa anidados y respuestas vacías", () => {
    expect(parseSerp("x", { items: [{ type: "organic", rank_group: 1, domain: "a.com", url: "https://a.com", title: "A" }] }, "a.com", "A").localPack).toBeNull();
    const nested = parseSerp("x", { items: [{ type: "local_pack", items: [{ title: "Uno", rank_group: 1 }, { title: "Techos Perez", rank_group: 2 }] }] }, "z.com", "Techos Pérez");
    expect(nested.localPack).toEqual({ position: 2, names: ["Uno", "Techos Perez"] });
    const empty = parseSerp("x", null, "a.com", "A");
    expect(empty).toMatchObject({ position: null, url: null, localPack: null, top: [], features: [] });
  });
});

describe("resumen y visibilidad", () => {
  it("CTR por posición", () => {
    expect(ctrFor(1)).toBe(0.3);
    expect(ctrFor(10)).toBe(0.02);
    expect(ctrFor(15)).toBe(0.01);
    expect(ctrFor(21)).toBe(0);
    expect(ctrFor(null)).toBe(0);
  });
  it("visibilidad: 100 si sale primero en todo, 0 si en nada", () => {
    expect(visibilityScore([1, 1])).toBe(100);
    expect(visibilityScore([null, null])).toBe(0);
    expect(visibilityScore([1, null])).toBe(50);
    expect(visibilityScore([3, 12])).toBe(Math.round(((0.1 + 0.01) / 0.6) * 100));
    expect(visibilityScore([])).toBe(0);
  });
  it("promedio, top 3 y top 10 sin contar los errores", () => {
    const s = summarize([row("a", 1), row("b", 4), row("c", 15), row("d", null), row("e", null, { error: { es: "x", en: "x" } })]);
    expect(s.avgPosition).toBe(6.7);
    expect(s.inTop3).toBe(1);
    expect(s.inTop10).toBe(2);
    expect(s.visibility).toBe(Math.round(((0.3 + 0.07 + 0.01) / (4 * 0.3)) * 100));
    expect(summarize([row("a", null)]).avgPosition).toBeNull();
  });
});

describe("compareRuns", () => {
  it("sube, baja, igual, nueva, perdida y sin comparación", () => {
    const prev = report([row("sube", 8), row("baja", 2), row("igual", 5), row("nueva", null), row("perdida", 4), row("nada", null)]);
    const cur = report([row("sube", 3), row("baja", 6), row("igual", 5), row("nueva", 12), row("perdida", null), row("nada", null), row("recién agregada", 9)]);
    const c = compareRuns(cur, prev);
    expect(c["sube"]).toEqual({ kind: "up", delta: 5, previous: 8 });
    expect(c["baja"]).toEqual({ kind: "down", delta: -4, previous: 2 });
    expect(c["igual"]).toEqual({ kind: "same", delta: 0, previous: 5 });
    expect(c["nueva"]).toEqual({ kind: "new", delta: null, previous: null });
    expect(c["perdida"]).toEqual({ kind: "lost", delta: null, previous: 4 });
    expect(c["nada"].kind).toBe("none");
    expect(c["recién agregada"].kind).toBe("none");
  });
  it("sin revisión anterior o con error: none", () => {
    const cur = report([row("a", 3)]);
    expect(compareRuns(cur, null)["a"].kind).toBe("none");
    const prev = report([row("a", null, { error: { es: "x", en: "x" } })]);
    expect(compareRuns(cur, prev)["a"].kind).toBe("none");
  });
});

describe("readRankReport", () => {
  it("lee un reporte guardado (ida y vuelta por JSON)", () => {
    const r = report([row("a", 3, { localPack: { position: 1, names: ["X", "Y"] }, top: [{ position: 1, domain: "a.com", title: "A", url: "https://a.com" }], features: ["local_pack"] })]);
    expect(readRankReport(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });
  it("rechaza basura y tolera campos rotos", () => {
    expect(readRankReport(null)).toBeNull();
    expect(readRankReport("x")).toBeNull();
    expect(readRankReport([])).toBeNull();
    expect(readRankReport({ rows: "no" })).toBeNull();
    const r = readRankReport({ rows: [null, { keyword: "" }, { keyword: " techos ", position: "3", top: [{ position: 2, domain: "a.com" }, "x"], error: "falló" }], cost: "caro" });
    expect(r).not.toBeNull();
    expect(r!.rows).toHaveLength(1);
    expect(r!.rows[0]).toMatchObject({ keyword: "techos", position: null, localPack: null, features: [], error: { es: "falló", en: "falló" } });
    expect(r!.rows[0].top).toEqual([{ position: 2, domain: "a.com", title: "", url: "" }]);
    expect(r!.cost).toBe(0);
    expect(r!.device).toBe("mobile");
    expect(r!.avgPosition).toBeNull();
    expect(r!.visibility).toBe(0);
  });
});

describe("rankSetup", () => {
  it("dice qué falta", () => {
    expect(rankSetup({ website: "", seoLocationCode: 1, seoKeywords: ["a"] })).toEqual({ ok: false, missing: "website" });
    expect(rankSetup({ website: "a.com", seoLocationCode: null, seoKeywords: ["a"] })).toEqual({ ok: false, missing: "location" });
    expect(rankSetup({ website: "a.com", seoLocationCode: 1, seoKeywords: [] })).toEqual({ ok: false, missing: "keywords" });
    expect(rankSetup({ website: "https://www.a.com/", seoLocationCode: 1, seoKeywords: ["techos", 3] })).toEqual({ ok: true, domain: "a.com", locationCode: 1, keywords: ["techos"] });
  });
});
