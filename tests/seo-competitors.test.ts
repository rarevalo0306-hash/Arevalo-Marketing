import { describe, expect, it } from "vitest";
import {
  brandToken,
  computeGap,
  DIRECTORY_SITES,
  distinctCountries,
  distinctKeywords,
  isBranded,
  isDirectory,
  mergeCandidates,
  normalizeDomain,
  parseLabsCompetitors,
  parseOwnerDomains,
  parseRankedKeywords,
  pickCountry,
  pickLanguage,
  readCompetitorsReport,
  readRankRows,
  readRankRowsMany,
  sameSite,
  serpCandidates,
  type LabsCountry,
  type RankedKeyword,
  withoutDirectories,
  zoneCountry,
} from "@/lib/seo/competitors";
import fameseg from "./fixtures/fameseg.json";

const kw = (keyword: string, position: number, volume: number | null = 100): RankedKeyword => ({ keyword, position, volume, url: `https://x.com/${keyword}` });

describe("normalizeDomain", () => {
  it("limpia protocolo, www, ruta, puerto y mayúsculas", () => {
    expect(normalizeDomain("https://www.Ejemplo.com/contacto?x=1")).toBe("ejemplo.com");
    expect(normalizeDomain("ejemplo.com:8080/a")).toBe("ejemplo.com");
    expect(normalizeDomain("  http://tienda.ejemplo.co.uk ")).toBe("tienda.ejemplo.co.uk");
    expect(normalizeDomain("www2.ejemplo.com")).toBe("ejemplo.com");
  });
  it("rechaza lo que no es dominio", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("hola")).toBeNull();
    expect(normalizeDomain("http://")).toBeNull();
    expect(normalizeDomain("foo bar.com")).toBeNull();
  });
  it("convierte dominios con acentos", () => {
    expect(normalizeDomain("plomería.com")).toMatch(/^xn--/);
  });
});

describe("sameSite / isDirectory", () => {
  it("subdominios cuentan como el mismo sitio", () => {
    expect(sameSite("blog.a.com", "a.com")).toBe(true);
    expect(sameSite("a.com", "ba.com")).toBe(false);
  });
  it("filtra directorios y redes en cualquier país o subdominio", () => {
    for (const d of ["yelp.com", "m.facebook.com", "google.com.mx", "es.wikipedia.org", "angi.com", "bbb.org", "yellowpages.com", "nextdoor.com"]) expect(isDirectory(d)).toBe(true);
    for (const d of ["joesplumbing.com", "angiehomes.com", "googleplumbing.net"]) expect(isDirectory(d)).toBe(false);
    expect(DIRECTORY_SITES).toContain("thumbtack");
  });
});

describe("brand", () => {
  it("saca el nombre del sitio", () => {
    expect(brandToken("joes-plumbing.com")).toBe("joesplumbing");
    expect(brandToken("acme.co.uk")).toBe("acme");
  });
  it("reconoce búsquedas con el nombre", () => {
    expect(isBranded("joes plumbing miami", "joesplumbing.com")).toBe(true);
    expect(isBranded("plumbing miami", "joesplumbing.com")).toBe(false);
  });
});

describe("parseOwnerDomains", () => {
  it("separa, normaliza, quita el propio sitio y repetidos, máximo 3", () => {
    expect(parseOwnerDomains("https://www.a.com, b.com\nA.com mio.com c.com d.com", "mio.com")).toEqual(["a.com", "b.com", "c.com"]);
    expect(parseOwnerDomains("nada", null)).toEqual([]);
  });
});

describe("readRankRows / serpCandidates", () => {
  const rankReport = {
    rows: [
      { keyword: "plomero miami", position: 7, top: [
        { position: 2, domain: "yelp.com" },
        { position: 1, domain: "rival.com", url: "https://rival.com/x" },
        { position: 3, domain: "mio.com" },
        { position: 4, domain: "otro.com" },
        { position: 5, domain: "www.rival.com" },
      ] },
      { keyword: "destapar caño", position: null, top: [{ position: 1, domain: "rival.com" }, { position: 2, domain: "tercero.com" }] },
      { keyword: "error", position: null, top: [], error: { es: "x", en: "x" } },
      { nope: true },
    ],
  };
  it("lee el reporte de posiciones (rank) en orden de posición", () => {
    const rows = readRankRows(rankReport);
    expect(rows).toHaveLength(3);
    expect(rows[0].domains).toEqual(["rival.com", "yelp.com", "mio.com", "otro.com", "rival.com"]);
  });
  it("tolera basura", () => {
    expect(readRankRows(null)).toEqual([]);
    expect(readRankRows({ rows: "x" })).toEqual([]);
  });
  it("cuenta dominios en el top 5 sin el negocio ni directorios, una vez por búsqueda", () => {
    expect(serpCandidates(readRankRows(rankReport), "mio.com")).toEqual([
      { domain: "rival.com", hits: 2 },
      { domain: "otro.com", hits: 1 },
      { domain: "tercero.com", hits: 1 },
    ]);
  });
});

describe("mergeCandidates", () => {
  it("junta fuentes, quita el propio sitio y directorios, pone primero al dueño y deja 5", () => {
    const out = mergeCandidates({
      self: "mio.com",
      labs: [
        { domain: "mio.com", overlap: 99, keywords: 10, traffic: 10 },
        { domain: "grande.com", overlap: 40, keywords: 5000, traffic: 90000 },
        { domain: "rival.com", overlap: 10, keywords: 50, traffic: 300 },
        { domain: "yelp.com", overlap: 80, keywords: 1, traffic: 1 },
        { domain: "a.com", overlap: 1, keywords: 1, traffic: 1 },
        { domain: "b.com", overlap: 1, keywords: 1, traffic: 0 },
      ],
      serp: [{ domain: "rival.com", hits: 3 }, { domain: "local.com", hits: 2 }],
      owner: ["https://amigo.com"],
    });
    expect(out.map((c) => c.domain)).toEqual(["amigo.com", "rival.com", "grande.com", "local.com", "a.com"]);
    const rival = out.find((c) => c.domain === "rival.com")!;
    expect(rival.source).toBe("serp");
    expect(rival.serpHits).toBe(3);
    expect(rival.overlap).toBe(10);
    expect(out[0].source).toBe("owner");
    expect(out.find((c) => c.domain === "grande.com")?.source).toBe("labs");
  });
});

describe("computeGap", () => {
  it("búsquedas donde ellos están en el top 10 y tú no (o después del 20), por volumen", () => {
    const you = [kw("plomero", 3, 1000), kw("fuga de agua", 25, 500)];
    const gap = computeGap(you, [
      { domain: "rival.com", top: [kw("plomero", 1, 1000), kw("fuga de agua", 4, 500), kw("calentador", 8, 300), kw("rival opiniones", 1, 900), kw("lejos", 15, 5000)] },
      { domain: "otro.com", top: [kw("calentador", 2, 300), kw("sin volumen", 5, null)] },
    ]);
    expect(gap).toEqual([
      { keyword: "fuga de agua", volume: 500, bestCompetitor: "rival.com", competitorPosition: 4, yourPosition: 25 },
      { keyword: "calentador", volume: 300, bestCompetitor: "otro.com", competitorPosition: 2, yourPosition: null },
      { keyword: "sin volumen", volume: null, bestCompetitor: "otro.com", competitorPosition: 5, yourPosition: null },
    ]);
  });
  it("respeta el límite", () => {
    const top = Array.from({ length: 40 }, (_, i) => kw(`k${i}`, 1, i));
    expect(computeGap([], [{ domain: "r.com", top }], 30)).toHaveLength(30);
  });
});

describe("respuestas de DataForSEO", () => {
  it("competitors_domain", () => {
    const res = [{ items: [{ domain: "rival.com", intersections: 12, full_domain_metrics: { organic: { count: 340, etv: 1234.5 } } }, { domain: "" }, { domain: "b.com", metrics: { organic: { count: 4 } } }] }];
    expect(parseLabsCompetitors(res)).toEqual([
      { domain: "rival.com", overlap: 12, keywords: 340, traffic: 1234.5 },
      { domain: "b.com", overlap: 4, keywords: null, traffic: null },
    ]);
    expect(parseLabsCompetitors([])).toEqual([]);
  });
  it("ranked_keywords", () => {
    const res = [
      {
        total_count: 3,
        metrics: { organic: { count: 120, etv: 88.2 } },
        items: [
          { keyword_data: { keyword: "Plomero Miami", keyword_info: { search_volume: 880 } }, ranked_serp_element: { serp_item: { rank_group: 4, url: "https://rival.com/" } } },
          { keyword_data: { keyword: "x" }, ranked_serp_element: { serp_item: {} } },
        ],
      },
    ];
    expect(parseRankedKeywords(res)).toEqual({ keywords: 120, traffic: 88.2, top: [{ keyword: "plomero miami", position: 4, volume: 880, url: "https://rival.com/" }] });
    expect(parseRankedKeywords([{ total_count: 0, items: null }])).toEqual({ keywords: 0, traffic: null, top: [] });
  });
});

describe("país y idioma de DataForSEO Labs", () => {
  const countries: LabsCountry[] = [
    { code: 2840, name: "United States", iso: "US", languages: ["en", "es"] },
    { code: 2484, name: "Mexico", iso: "MX", languages: ["es"] },
  ];
  it("usa el país directo o el que sale al final del nombre de la ciudad", () => {
    expect(pickCountry(countries, 2840, "")?.iso).toBe("US");
    expect(pickCountry(countries, 1015116, "Miami,Florida,United States")?.code).toBe(2840);
    expect(pickCountry(countries, 123, "Somewhere,Nowhere")).toBeNull();
  });
  it("cae al primer idioma si no hay el pedido", () => {
    expect(pickLanguage(countries[0], "es")).toBe("es");
    expect(pickLanguage(countries[1], "en")).toBe("es");
  });
});

describe("readCompetitorsReport", () => {
  it("lee un reporte válido y corrige campos raros", () => {
    const r = readCompetitorsReport({
      domain: "mio.com",
      location: { code: 1015116, name: "Miami,Florida,United States", local: true, countryCode: 2840, countryName: "United States", countryIso: "US", language: "es" },
      competitors: [{ domain: "rival.com", source: "raro", keywords: 3, traffic: "x", overlap: 2, serpHits: 1, analyzed: true, top: [kw("a", 1), { keyword: "", position: 1 }] }, { nope: 1 }],
      you: { keywords: 5, top: [] },
      gap: [{ keyword: "a", volume: 10, bestCompetitor: "rival.com", competitorPosition: 1, yourPosition: null }, { keyword: "b" }],
      notes: [{ es: "hola", en: "hi" }, "x"],
      cost: 0.07,
      createdAt: "2026-10-06T00:00:00.000Z",
    });
    expect(r).not.toBeNull();
    expect(r!.competitors).toHaveLength(1);
    expect(r!.competitors[0]).toMatchObject({ domain: "rival.com", source: "labs", traffic: null, analyzed: true });
    expect(r!.competitors[0].top).toHaveLength(1);
    expect(r!.you.domain).toBe("mio.com");
    expect(r!.gap).toHaveLength(1);
    expect(r!.notes).toEqual([{ es: "hola", en: "hi" }]);
    expect(r!.location.local).toBe(true);
  });
  it("null si no es un reporte", () => {
    expect(readCompetitorsReport(null)).toBeNull();
    expect(readCompetitorsReport({ domain: "a.com" })).toBeNull();
    expect(readCompetitorsReport([])).toBeNull();
  });
});

describe("varias zonas", () => {
  const miami = { rows: [{ keyword: "plomero", top: [{ position: 1, domain: "rival.com" }, { position: 2, domain: "otro.com" }] }] };
  const orlando = {
    rows: [
      { keyword: "Plomero", top: [{ position: 1, domain: "rival.com" }, { position: 3, domain: "local.com" }] },
      { keyword: "destapes", top: [{ position: 2, domain: "rival.com" }] },
    ],
  };

  it("junta las posiciones de todas las zonas y cuenta cada búsqueda una vez", () => {
    const rows = readRankRowsMany([miami, null, orlando]);
    expect(rows).toHaveLength(3);
    expect(distinctKeywords(rows)).toBe(2);
    expect(serpCandidates(rows, "mio.com")).toEqual([
      { domain: "rival.com", hits: 2 },
      { domain: "local.com", hits: 1 },
      { domain: "otro.com", hits: 1 },
    ]);
  });

  it("el país de cada zona, sin repetir", () => {
    expect(zoneCountry({ name: "Managua,Managua,Nicaragua", type: "City" })).toBe("Nicaragua");
    expect(zoneCountry({ name: "Nicaragua", type: "Country" })).toBe("Nicaragua");
    expect(zoneCountry({ name: "" })).toBe("");
    expect(
      distinctCountries([
        { name: "Managua,Managua,Nicaragua", type: "City" },
        { name: "Nicaragua", type: "Country" },
        { name: "Miami,Florida,United States", type: "City" },
        { name: "" },
      ]),
    ).toEqual(["Nicaragua", "United States"]);
  });
});

describe("isDirectory: directorios, redes, marketplaces, gobierno y noticias (datos de Fameseg, Nicaragua)", () => {
  it("reconoce directorios y clasificados de Latinoamérica en cualquier terminación", () => {
    for (const d of [
      "paginasamarillas.com.ni",
      "www.paginasamarillas.es",
      "amarillas.com.mx",
      "yellowpages.ca",
      "encuentra24.com",
      "diredi.com",
      "es.cybo.com",
      "starofservice.com.ni",
      "findglocal.com",
      "waze.com",
      "facebook.com",
      "www.instagram.com",
      "youtube.com",
      "tiktok.com",
      "ni.linkedin.com",
      "es.wikipedia.org",
      "yelp.es",
      "tripadvisor.com.mx",
      "articulo.mercadolibre.com.ni",
      "olx.com.br",
    ])
      expect(isDirectory(d), d).toBe(true);
  });
  it("acepta direcciones completas", () => {
    expect(isDirectory("https://www.paginasamarillas.com.ni/servicios/cortinas-metalicas")).toBe(true);
    expect(isDirectory("http://diredi.com/nicaragua/const-metal-managua-nicaragua/")).toBe(true);
  });
  it("gobierno, universidades y noticias tampoco son competencia", () => {
    for (const d of ["minsa.gob.ni", "usa.gov", "gov.uk", "www.gov.uk", "hmrc.gov.uk", "gob.mx", "impo.gub.uy", "repositorio.unan.edu.ni", "harvard.edu", "laprensani.com", "100noticias.com.ni", "miaminews.com", "diariolibre.com"])
      expect(isDirectory(d), d).toBe(true);
  });
  it("no confunde negocios reales", () => {
    for (const d of ["fameseg.com", "arteytecnica.com", "cormetal.com.ni", "cortinasmetalicasurgentes.com", "portoneselectricosbasilio.com", "inmenicsa.com", "gobernadorplumbing.com", "educarte.com", "angiehomes.com"])
      expect(isDirectory(d), d).toBe(false);
  });
  it("no elige directorios como competidores en serpCandidates ni en mergeCandidates", () => {
    const rows = readRankRows(fameseg.reports.rank.data);
    const serp = serpCandidates(rows, "fameseg.com", 5).map((c) => c.domain);
    expect(serp).not.toContain("paginasamarillas.com.ni");
    expect(serp).not.toContain("diredi.com");
    expect(serp).not.toContain("waze.com");
    expect(serp).not.toContain("encuentra24.com");
    expect(serp).toEqual(expect.arrayContaining(["portoneselectricosbasilio.com", "cormetal.com.ni", "arteytecnica.com", "cortinasmetalicasurgentes.com"]));
    const merged = mergeCandidates({
      self: "fameseg.com",
      labs: [{ domain: "paginasamarillas.com.ni", overlap: 2, keywords: 1460, traffic: 6699 }, { domain: "cormetal.com.ni", overlap: 1, keywords: 2, traffic: 1 }],
      serp: [{ domain: "diredi.com", hits: 1 }, { domain: "arteytecnica.com", hits: 1 }],
      owner: [],
    });
    expect(merged.map((c) => c.domain).sort()).toEqual(["arteytecnica.com", "cormetal.com.ni"]);
  });
});

describe("withoutDirectories (reportes guardados)", () => {
  it("oculta Páginas Amarillas y DireDi del reporte de Fameseg, y las búsquedas que solo ellos ganaban", () => {
    const report = readCompetitorsReport(fameseg.reports.competitors.data)!;
    const { report: shown, hidden } = withoutDirectories(report);
    expect(hidden).toEqual(["paginasamarillas.com.ni", "diredi.com"]);
    expect(shown.competitors.map((c) => c.domain)).toEqual(["arteytecnica.com", "cormetal.com.ni", "cortinasmetalicasurgentes.com"]);
    expect(shown.gap).toEqual([]);
  });
  it("deja los que agregó el dueño aunque parezcan directorio", () => {
    const report = readCompetitorsReport(fameseg.reports.competitors.data)!;
    const owned = { ...report, competitors: report.competitors.map((c) => (c.domain === "diredi.com" ? { ...c, source: "owner" as const } : c)) };
    expect(withoutDirectories(owned).hidden).toEqual(["paginasamarillas.com.ni"]);
  });
  it("sin directorios no cambia nada", () => {
    const report = readCompetitorsReport(fameseg.reports.competitors.data)!;
    const clean = { ...report, competitors: report.competitors.filter((c) => !isDirectory(c.domain)) };
    expect(withoutDirectories(clean).report).toBe(clean);
  });
});
