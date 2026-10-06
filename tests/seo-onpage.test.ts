import { describe, expect, it } from "vitest";
import type { AuditPage } from "@/lib/seo/audit";
import {
  applyOverride,
  assignKeywords,
  candidatePages,
  cleanSuggestion,
  type LivePage,
  matchScore,
  mergePage,
  ONPAGE_WEIGHTS,
  onPageIdeas,
  type OnPagePage,
  type OnPageReport,
  type PageSiteInfo,
  parseSeconds,
  planPages,
  rankFor,
  readLivePage,
  readOnPageReport,
  sortPages,
  speedFor,
  targetWords,
  topIdeas,
  urlKey,
  winnersOf,
} from "@/lib/seo/onpage";
import type { ContentTargets, SerpOrganic } from "@/lib/seo/writer";

const KW = "cortinas metálicas managua";
const SITE = "https://empresa.com";

const targets: ContentTargets = {
  wordCount: 1200,
  competitorWords: [1200, 1000, 1400],
  headings: [
    { text: "Tipos de cortinas metálicas", pages: 3 },
    { text: "Instalación y mantenimiento", pages: 2 },
  ],
  questions: ["¿Cuánto cuesta una cortina metálica?"],
  terms: ["acero galvanizado", "motor eléctrico"],
};

const organic: SerpOrganic[] = [
  { position: 1, title: "Cortinas metálicas en Managua", url: "https://rival1.com/cortinas", domain: "rival1.com", description: "" },
  { position: 2, title: "Cortinas Managua", url: "https://rival2.com/", domain: "rival2.com", description: "" },
  { position: 3, title: "Cortinas", url: "https://rival3.com/c", domain: "rival3.com", description: "" },
  { position: 4, title: "Más cortinas", url: "https://rival4.com/c", domain: "rival4.com", description: "" },
];

const filler = (n: number) => Array.from({ length: n }, (_, i) => `palabra${i % 50}`).join(" ");

/** Una página que cumple todo. */
const goodPage = (extra: Partial<LivePage> = {}): LivePage => ({
  url: `${SITE}/cortinas-metalicas-managua`,
  title: "Cortinas metálicas en Managua | Empresa",
  meta: "Fabricamos e instalamos cortinas metálicas en Managua para negocios y casas: acero galvanizado, motor eléctrico y mantenimiento. Pide tu cotización.",
  h1: "Cortinas metálicas en Managua",
  h1Count: 1,
  headings: [
    { level: 2, text: "Cortinas metálicas en Managua para negocios" },
    { level: 2, text: "Tipos de cortinas metálicas" },
    { level: 2, text: "Instalación y mantenimiento" },
    { level: 3, text: "¿Cuánto cuesta una cortina metálica en Managua?" },
  ],
  words: 1100,
  text: `Fabricamos cortinas metálicas en Managua con acero galvanizado y motor eléctrico. ${filler(1000)}`,
  intro: "Fabricamos cortinas metálicas en Managua con acero galvanizado y motor eléctrico.",
  images: 3,
  imagesNoAlt: 0,
  internalLinks: [`${SITE}/`, `${SITE}/contacto`, `${SITE}/portones`, `${SITE}/cortinas-metalicas-managua`],
  externalLinks: 1,
  schema: [],
  canonical: `${SITE}/cortinas-metalicas-managua`,
  noindex: false,
  ...extra,
});

const site = (extra: Partial<PageSiteInfo> = {}): PageSiteInfo => ({
  domain: "empresa.com",
  isHome: false,
  isContact: false,
  inboundLinks: 3,
  homeLinks: true,
  speed: { source: "server", seconds: 0.8 },
  rank: { position: 3, url: `${SITE}/cortinas-metalicas-managua/`, top: organic.map((o) => ({ position: o.position, domain: o.domain, url: o.url })) },
  ...extra,
});

const ids = (r: ReturnType<typeof onPageIdeas>) => r.ideas.map((i) => i.id);

describe("ONPAGE_WEIGHTS", () => {
  it("suman 100", () => {
    expect(Object.values(ONPAGE_WEIGHTS).reduce((s, n) => s + n, 0)).toBe(100);
  });
});

describe("onPageIdeas", () => {
  it("una página que cumple todo saca 100 y no tiene ideas", () => {
    const r = onPageIdeas(goodPage(), KW, targets, { organic }, site());
    expect(ids(r)).toEqual([]);
    expect(r.score).toBe(100);
    expect(r.targetWords).toBe(1200);
  });

  it("una página con todo mal saca 0 y tiene cada idea", () => {
    const bad = goodPage({
      url: `${SITE}/contacto`,
      title: "Inicio",
      meta: "",
      h1: "",
      h1Count: 0,
      headings: [],
      words: 300,
      text: "Somos una empresa con experiencia. Escríbenos.",
      intro: "Somos una empresa con experiencia. Escríbenos.",
      imagesNoAlt: 2,
      internalLinks: [],
      canonical: `${SITE}/`,
      noindex: true,
    });
    const r = onPageIdeas(bad, KW, targets, { organic }, site({ isContact: true, inboundLinks: 0, speed: { source: "pagespeed", seconds: 6.2, performance: 35 }, rank: { position: null, url: null, top: [{ position: 1, domain: "rival1.com", url: "" }, { position: 2, domain: "www.empresa.com", url: "" }, { position: 3, domain: "rival2.com", url: "" }, { position: 4, domain: "rival3.com", url: "" }, { position: 5, domain: "rival4.com", url: "" }] } }));
    expect(r.score).toBe(0);
    expect(ids(r)).toEqual(
      expect.arrayContaining([
        "noindex",
        "canonical",
        "title-keyword",
        "title-length",
        "h1-missing",
        "meta-missing",
        "url-keyword",
        "intro-keyword",
        "h2-keyword",
        "length",
        "topics",
        "questions",
        "terms",
        "images-alt",
        "inbound-links",
        "outbound-links",
        "schema",
        "speed",
        "not-ranking",
      ]),
    );
    const notRanking = r.ideas.find((i) => i.id === "not-ranking")!;
    expect(notRanking.es).toContain("rival1.com, rival2.com y rival3.com");
    expect(notRanking.es).not.toContain("empresa.com");
    expect(r.ideas.find((i) => i.id === "length")!.priority).toBe("alta");
    expect(r.ideas.find((i) => i.id === "length")!.es).toContain("1.200");
    expect(r.ideas.find((i) => i.id === "speed")!.es).toContain("6,2 s");
    expect(r.ideas.find((i) => i.id === "questions")!.detail).toEqual(["¿Cuánto cuesta una cortina metálica?"]);
    expect(r.ideas.find((i) => i.id === "terms")!.detail).toEqual(["acero galvanizado", "motor eléctrico"]);
    // Ordenadas: primero las de prioridad alta.
    const order = r.ideas.map((i) => i.priority);
    expect(order).toEqual([...order].sort((a, b) => ["alta", "media", "baja"].indexOf(a) - ["alta", "media", "baja"].indexOf(b)));
  });

  it("palabra clave que falta en título y H1, con el texto actual", () => {
    const r = onPageIdeas(goodPage({ title: "Empresa de puertas y portones en Nicaragua", h1: "Bienvenidos a nuestra empresa" }), KW, targets, { organic }, site());
    expect(ids(r)).toContain("title-keyword");
    expect(ids(r)).toContain("h1-keyword");
    expect(r.ideas.find((i) => i.id === "title-keyword")!.es).toContain("Empresa de puertas y portones en Nicaragua");
    expect(r.score).toBe(100 - ONPAGE_WEIGHTS.titleKeyword - ONPAGE_WEIGHTS.h1);
  });

  it("título largo, meta sin palabra clave, varios H1", () => {
    const r = onPageIdeas(
      goodPage({ title: "Cortinas metálicas en Managua, puertas enrollables y portones eléctricos | Empresa", meta: "Hacemos trabajos de calidad para tu negocio.", h1Count: 3 }),
      KW,
      targets,
      { organic },
      site(),
    );
    expect(ids(r)).toEqual(expect.arrayContaining(["title-length", "meta-keyword", "h1-multiple"]));
    expect(ids(r)).not.toContain("title-keyword");
    expect(r.ideas.find((i) => i.id === "meta-keyword")!.es).toContain("120 a 160");
  });

  it("meta con palabra clave pero de largo malo: solo el largo", () => {
    const r = onPageIdeas(goodPage({ meta: "Cortinas metálicas en Managua." }), KW, targets, { organic }, site());
    expect(ids(r)).toContain("meta-length");
    expect(ids(r)).not.toContain("meta-keyword");
  });

  it("largo: la mitad de los puntos entre 50 % y 80 %", () => {
    const r = onPageIdeas(goodPage({ words: 700 }), KW, targets, { organic }, site());
    const idea = r.ideas.find((i) => i.id === "length")!;
    expect(idea.priority).toBe("media");
    expect(r.score).toBe(100 - ONPAGE_WEIGHTS.length / 2);
    expect(ids(onPageIdeas(goodPage({ words: 980 }), KW, targets, { organic }, site()))).not.toContain("length");
  });

  it("las preguntas cuentan aunque estén escritas en el texto (acordeón)", () => {
    const page = goodPage({ headings: goodPage().headings.slice(0, 3), text: `${goodPage().text} ¿Cuánto cuesta una cortina metálica? Depende del tamaño.` });
    expect(ids(onPageIdeas(page, KW, targets, { organic }, site()))).not.toContain("questions");
  });

  it("enlaces: sin enlaces hacia la página es alta; si falta solo el de inicio, media; la de inicio no cuenta", () => {
    expect(onPageIdeas(goodPage(), KW, targets, { organic }, site({ inboundLinks: 0 })).ideas.find((i) => i.id === "inbound-links")?.priority).toBe("alta");
    const home = onPageIdeas(goodPage(), KW, targets, { organic }, site({ inboundLinks: 2, homeLinks: false }));
    expect(home.ideas.find((i) => i.id === "home-link")?.priority).toBe("media");
    expect(home.score).toBe(100 - ONPAGE_WEIGHTS.inbound / 2);
    expect(ids(onPageIdeas(goodPage(), KW, targets, { organic }, site({ isHome: true, inboundLinks: 0, homeLinks: null, schema: undefined } as Partial<PageSiteInfo>)))).not.toContain("inbound-links");
    expect(ids(onPageIdeas(goodPage(), KW, targets, { organic }, site({ inboundLinks: null, homeLinks: null })))).not.toContain("inbound-links");
  });

  it("datos del negocio: solo en la de inicio o contacto", () => {
    expect(ids(onPageIdeas(goodPage(), KW, targets, { organic }, site({ isHome: true })))).toContain("schema");
    expect(ids(onPageIdeas(goodPage({ schema: ["LocalBusiness"] }), KW, targets, { organic }, site({ isHome: true })))).not.toContain("schema");
    expect(ids(onPageIdeas(goodPage(), KW, targets, { organic }, site()))).not.toContain("schema");
  });

  it("la de inicio no pide la palabra en la dirección", () => {
    expect(ids(onPageIdeas(goodPage({ url: `${SITE}/` }), KW, targets, { organic }, site({ isHome: true, schema: undefined, rank: null } as Partial<PageSiteInfo>)))).not.toContain("url-keyword");
    expect(ids(onPageIdeas(goodPage({ url: `${SITE}/servicios` }), KW, targets, { organic }, site()))).toContain("url-keyword");
  });

  it("velocidad: media entre 2,5 y 4 s; nada si es rápida o no se sabe", () => {
    const meh = onPageIdeas(goodPage(), KW, targets, { organic }, site({ speed: { source: "pagespeed", seconds: 3.1, performance: 80 } }));
    expect(meh.ideas.find((i) => i.id === "speed")?.priority).toBe("media");
    expect(ids(onPageIdeas(goodPage(), KW, targets, { organic }, site({ speed: { source: "server", seconds: 7 } })))).toContain("speed");
    expect(ids(onPageIdeas(goodPage(), KW, targets, { organic }, site({ speed: null })))).not.toContain("speed");
    expect(ids(onPageIdeas(goodPage(), KW, targets, { organic }, site({ speed: { source: "pagespeed", seconds: 1.9, performance: 92 } })))).not.toContain("speed");
  });

  it("competencia: otra página tuya sale, o sales en la segunda página", () => {
    const other = onPageIdeas(goodPage(), KW, targets, { organic }, site({ rank: { position: 5, url: `${SITE}/`, top: [] } }));
    expect(other.ideas.find((i) => i.id === "other-page-ranks")?.es).toContain("lugar 5");
    const low = onPageIdeas(goodPage(), KW, targets, { organic }, site({ rank: { position: 14, url: `${SITE}/cortinas-metalicas-managua`, top: organic.map((o) => ({ ...o })) } }));
    expect(ids(low)).toContain("low-ranking");
    expect(low.score).toBe(100);
  });

  it("sin datos de posiciones usa los 10 de Google de la investigación", () => {
    expect(ids(onPageIdeas(goodPage(), KW, targets, { organic }, site({ rank: null })))).toContain("not-ranking");
    const mine = [...organic, { position: 6, title: "x", url: `${SITE}/otra`, domain: "empresa.com", description: "" }];
    expect(ids(onPageIdeas(goodPage(), KW, targets, { organic: mine }, site({ rank: null })))).toContain("other-page-ranks");
    const same = [...organic, { position: 6, title: "x", url: `${SITE}/cortinas-metalicas-managua`, domain: "empresa.com", description: "" }];
    const r = onPageIdeas(goodPage(), KW, targets, { organic: same }, site({ rank: null }));
    expect(ids(r).filter((i) => ["not-ranking", "other-page-ranks"].includes(i))).toEqual([]);
  });

  it("el puntaje siempre queda entre 0 y 100", () => {
    const empty: ContentTargets = { wordCount: 0, competitorWords: [], headings: [], questions: [], terms: [] };
    for (const t of [targets, empty]) {
      for (const p of [goodPage(), goodPage({ title: "", meta: "", h1: "", words: 0, text: "", intro: "", headings: [], imagesNoAlt: 9 })]) {
        const r = onPageIdeas(p, KW, t, { organic: [] }, site({ speed: null, rank: null }));
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
        expect(Number.isInteger(r.score)).toBe(true);
      }
    }
    // Sin páginas leídas, el largo se mide contra 600.
    expect(onPageIdeas(goodPage({ words: 250 }), KW, empty, { organic: [] }, site()).targetWords).toBe(600);
  });
});

describe("assignKeywords", () => {
  const pages = [
    { url: `${SITE}/`, title: "Empresa | Cortinas y portones", h1: "Bienvenidos" },
    { url: `${SITE}/cortinas-metalicas`, title: "Cortinas metálicas", h1: "Cortinas metálicas" },
    { url: `${SITE}/contacto/`, title: "Contacto", h1: "Contáctanos" },
    { url: `${SITE}/blog/puertas-enrollables`, title: "Guía de puertas enrollables", h1: "Puertas enrollables" },
    { url: `${SITE}/galeria`, title: "Galería de fotos", h1: "Nuestros trabajos" },
  ];

  it("cada fuente, en orden de prioridad, y cada palabra en una sola página", () => {
    const r = assignKeywords(pages, {
      overrides: { "https://www.empresa.com/contacto": "contacto cortinas managua" },
      gsc: [
        { page: "https://www.empresa.com/", query: "empresa", impressions: 900 },
        { page: `${SITE}/`, query: "cortinas metalicas managua", impressions: 120 },
        { page: `${SITE}/cortinas-metalicas`, query: "cortinas metalicas managua", impressions: 80 },
        { page: `${SITE}/cortinas-metalicas`, query: "precio cortinas metalicas", impressions: 40 },
        { page: `${SITE}/galeria`, query: "fotos de portones", impressions: 2 },
      ],
      rank: [
        { keyword: "puertas enrollables", url: `${SITE}/blog/puertas-enrollables/`, position: 7 },
        { keyword: "cortinas metalicas", url: `${SITE}/cortinas-metalicas`, position: 4 },
      ],
      candidates: ["cortinas metálicas", "puertas enrollables"],
      brand: "Empresa",
    });
    expect(r.map((x) => [x.keyword, x.source])).toEqual([
      ["cortinas metalicas managua", "gsc"], // la de más impresiones (sin la del nombre del negocio)
      ["precio cortinas metalicas", "gsc"], // la primera ya la tiene la página de inicio
      ["contacto cortinas managua", "owner"],
      ["puertas enrollables", "rank"],
      [null, null], // 2 impresiones no alcanzan
    ]);
  });

  it("parecido al título: gana la página que más se parece y la otra no repite", () => {
    const r = assignKeywords(pages, { candidates: ["cortinas metálicas", "puertas enrollables", "pintura de casas"] });
    expect(r.find((x) => x.url.endsWith("/cortinas-metalicas"))).toMatchObject({ keyword: "cortinas metálicas", source: "match" });
    expect(r.find((x) => x.url.endsWith("/puertas-enrollables"))).toMatchObject({ keyword: "puertas enrollables", source: "match" });
    expect(r.filter((x) => x.keyword === "cortinas metálicas")).toHaveLength(1);
    expect(r.find((x) => x.url.endsWith("/galeria"))).toMatchObject({ keyword: null, source: null });
  });

  it("sin parecido suficiente no hay palabra", () => {
    expect(matchScore(pages[4], "portones eléctricos managua")).toBe(0);
    expect(matchScore(pages[1], "cortinas metálicas managua")).toBeGreaterThan(0); // 2 de 3 palabras
    expect(matchScore(pages[1], "cortinas de baño")).toBe(0); // 1 de 2
    expect(assignKeywords(pages, { candidates: ["portones eléctricos managua"] }).every((x) => x.keyword === null)).toBe(true);
    expect(assignKeywords(pages, {}).every((x) => x.keyword === null)).toBe(true);
  });

  it("Search Console gana a tus posiciones, y tus posiciones al parecido", () => {
    const one = [pages[1]];
    expect(assignKeywords(one, { gsc: [{ page: pages[1].url, query: "cortinas enrollables", impressions: 10 }], rank: [{ keyword: "cortinas metalicas", url: pages[1].url, position: 2 }], candidates: ["cortinas metálicas"] })[0]).toMatchObject({ source: "gsc", keyword: "cortinas enrollables" });
    expect(assignKeywords(one, { rank: [{ keyword: "cortinas", url: pages[1].url, position: 2 }, { keyword: "cortinas baratas", url: pages[1].url, position: 9 }], candidates: ["cortinas metálicas"] })[0]).toMatchObject({ source: "rank", keyword: "cortinas" });
    expect(assignKeywords(one, { rank: [{ keyword: "cortinas", url: pages[1].url, position: null }], candidates: ["cortinas metálicas"] })[0]).toMatchObject({ source: "match" });
  });

  it("lo que eligió el dueño gana aunque otra página tenga esa búsqueda", () => {
    const r = assignKeywords(pages.slice(0, 2), { overrides: { [`${SITE}/cortinas-metalicas`]: "cortinas metalicas managua" }, gsc: [{ page: `${SITE}/`, query: "cortinas metalicas managua", impressions: 500 }] });
    expect(r[1]).toMatchObject({ keyword: "cortinas metalicas managua", source: "owner" });
    expect(r[0]).toMatchObject({ keyword: null, source: null });
  });
});

describe("candidatePages y planPages", () => {
  const ap = (url: string, extra: Partial<AuditPage> = {}): AuditPage => ({
    url,
    finalUrl: url,
    status: 200,
    ms: 500,
    bytes: 1000,
    title: "",
    description: "",
    h1Count: 1,
    h1: "",
    canonical: "",
    noindex: false,
    lang: "es",
    images: 0,
    imagesNoAlt: 0,
    words: 300,
    internalLinks: 3,
    viewport: true,
    ogImage: true,
    jsonLd: false,
    schema: [],
    https: true,
    ...extra,
  });
  const audit = {
    site: { home: `${SITE}/` } as never,
    pages: [
      ap(`${SITE}/privacidad`),
      ap(`${SITE}/`),
      ap(`${SITE}/cortinas`, { title: "Cortinas metálicas" }),
      ap(`${SITE}/cortinas/`),
      ap(`${SITE}/vieja`, { status: 404 }),
      ap(`${SITE}/oculta`, { noindex: true }),
      ap(`${SITE}/caida`, { status: 0, error: "timeout" }),
      ap(`${SITE}/portones`),
    ],
  };

  it("solo páginas 200 sin noindex, sin repetir, la de inicio primero", () => {
    expect(candidatePages(audit).map((p) => p.url)).toEqual([`${SITE}/`, `${SITE}/privacidad`, `${SITE}/cortinas`, `${SITE}/portones`]);
    expect(candidatePages(audit)[0].isHome).toBe(true);
  });

  it("inicio, luego las que tienen palabra, y las legales al final; máximo N", () => {
    const plan = planPages(candidatePages(audit), { candidates: ["cortinas metálicas"] }, 3);
    expect(plan.map((p) => p.url)).toEqual([`${SITE}/`, `${SITE}/cortinas`, `${SITE}/portones`]);
    expect(plan[1]).toMatchObject({ keyword: "cortinas metálicas", source: "match" });
  });
});

describe("readLivePage", () => {
  it("saca títulos, textos y enlaces del HTML", () => {
    const html = `<html><head><title>Cortinas metálicas en Managua</title><meta name="description" content="Desc &amp; más">
      <link rel="canonical" href="/cortinas"><script type="application/ld+json">{"@type":"LocalBusiness"}</script></head>
      <body><nav><a href="/">Inicio</a><a href="/contacto">Contacto</a></nav>
      <main><h1>Cortinas metálicas</h1><p>Fabricamos cortinas metálicas en Managua. ${filler(200)}</p>
      <h2>Tipos de cortinas</h2><h3>¿Cuánto cuesta?</h3><img src="a.jpg"><img src="b.jpg" alt="cortina">
      <a href="https://otro.com/x">otro</a><a href="https://www.otro.com/y">otro</a><a href="https://empresa.com/portones">portones</a></main></body></html>`;
    const p = readLivePage(html, `${SITE}/cortinas`);
    expect(p.title).toBe("Cortinas metálicas en Managua");
    expect(p.meta).toBe("Desc & más");
    expect(p.h1).toBe("Cortinas metálicas");
    expect(p.headings).toEqual([{ level: 2, text: "Tipos de cortinas" }, { level: 3, text: "¿Cuánto cuesta?" }]);
    expect(p.imagesNoAlt).toBe(1);
    expect(p.externalLinks).toBe(2);
    expect(p.internalLinks.map(urlKey)).toEqual(expect.arrayContaining(["empresa.com/", "empresa.com/contacto", "empresa.com/portones"]));
    expect(p.schema).toContain("LocalBusiness");
    expect(p.canonical).toBe(`${SITE}/cortinas`);
    expect(p.intro.startsWith("Cortinas metálicas Fabricamos cortinas metálicas en Managua")).toBe(true);
    expect(p.intro.split(" ")).toHaveLength(100);
    expect(p.words).toBeGreaterThan(200);
  });
});

describe("ayudantes", () => {
  it("urlKey ignora protocolo, www, barra final y #", () => {
    expect(urlKey("http://www.Empresa.com/a/#x")).toBe(urlKey("https://empresa.com/a"));
    expect(urlKey("https://empresa.com")).toBe("empresa.com/");
  });

  it("parseSeconds lee lo que da PageSpeed", () => {
    expect(parseSeconds("6.1 s")).toBe(6.1);
    expect(parseSeconds("6,1 s")).toBe(6.1);
    expect(parseSeconds("850 ms")).toBe(0.85);
    expect(parseSeconds("")).toBeNull();
  });

  it("targetWords: mediana entre 300 y 2500, redondeada a 50", () => {
    expect(targetWords({ competitorWords: [1180, 990, 1420] })).toBe(1200);
    expect(targetWords({ competitorWords: [100, 120] })).toBe(300);
    expect(targetWords({ competitorWords: [9000] })).toBe(2500);
    expect(targetWords({ competitorWords: [] })).toBe(600);
  });

  it("speedFor: PageSpeed para la de inicio, tiempo de la auditoría para las demás", () => {
    const audit = {
      pages: [{ url: `${SITE}/a`, finalUrl: `${SITE}/a/`, ms: 4200, error: undefined }] as AuditPage[],
      pagespeed: { performance: 40, seo: 90, accessibility: 90, bestPractices: 90, lcp: "6.3 s", cls: "0", tbt: "0 ms" },
    };
    expect(speedFor(`${SITE}/`, `${SITE}/`, audit, 300)).toEqual({ source: "pagespeed", seconds: 6.3, performance: 40 });
    expect(speedFor(`${SITE}/a`, `${SITE}/`, audit, 300)).toEqual({ source: "server", seconds: 4.2 });
    expect(speedFor(`${SITE}/b`, `${SITE}/`, audit, 300)).toEqual({ source: "server", seconds: 0.3 });
    expect(speedFor(`${SITE}/b`, `${SITE}/`, { ...audit, pagespeed: { error: "x" } }, null)).toBeNull();
  });

  it("rankFor y winnersOf", () => {
    const rows = [{ keyword: "Cortinas Metálicas", position: 4, url: `${SITE}/c`, localPack: null, top: [], features: [] }];
    expect(rankFor(rows, "cortinas metalicas")?.position).toBe(4);
    expect(rankFor(rows, "otra")).toBeNull();
    const w = winnersOf({ organic, pages: [{ position: 1, url: "https://rival1.com/cortinas", domain: "rival1.com", title: "", h1: "", headings: [], words: 1300 }] });
    expect(w).toHaveLength(4);
    expect(w[0].words).toBe(1300);
    expect(w[1].words).toBeNull();
  });

  it("cleanSuggestion corta sin partir palabras", () => {
    const s = cleanSuggestion({ title: "Cortinas metálicas en Managua para negocios, casas y bodegas industriales", metaDescription: "x ".repeat(120), h1: "# Cortinas", h2s: ["a", "b", "c", "d", "e", "f", ""] }, "gemini");
    expect(s.title.length).toBeLessThanOrEqual(60);
    expect(s.title.endsWith(" ")).toBe(false);
    expect(s.metaDescription.length).toBeLessThanOrEqual(160);
    expect(s.h1).toBe("Cortinas");
    expect(s.h2s).toHaveLength(5);
  });
});

const savedPage = (url: string, extra: Partial<OnPagePage> = {}): OnPagePage => ({
  url,
  title: "T",
  keyword: "cortinas",
  keywordSource: "match",
  score: 50,
  ideas: [{ id: "length", category: "contenido", priority: "alta", es: "a", en: "a", impact: 7 }],
  stats: null,
  winners: [],
  brief: null,
  linksTo: [],
  checkedAt: new Date(0).toISOString(),
  ...extra,
});

const report = (pages: OnPagePage[]): OnPageReport => ({
  version: 1,
  zone: { code: 1, name: "Managua" },
  language: "es",
  pages,
  overrides: {},
  cost: 0.004,
  createdAt: new Date(0).toISOString(),
  stoppedEarly: false,
});

describe("cambios sobre el reporte", () => {
  it("applyOverride guarda la palabra y marca la página para volver a revisar", () => {
    const r = applyOverride(report([savedPage(`${SITE}/a`), savedPage(`${SITE}/b`)]), `${SITE}/a/`, "  cortinas metálicas managua ");
    expect(r.overrides).toEqual({ [`${SITE}/a/`]: "cortinas metálicas managua" });
    expect(r.pages[0]).toMatchObject({ keyword: "cortinas metálicas managua", keywordSource: "owner", needsRecheck: true, score: null, ideas: [] });
    expect(r.pages[1].needsRecheck).toBeUndefined();
    const back = applyOverride(r, `${SITE}/a`, "");
    expect(back.overrides).toEqual({});
    expect(back.pages[0]).toMatchObject({ keyword: null, keywordSource: null, needsRecheck: true });
  });

  it("mergePage reemplaza la página y suma el costo", () => {
    const r = mergePage(report([savedPage(`${SITE}/a`), savedPage(`${SITE}/b`)]), savedPage(`${SITE}/b/`, { score: 90 }), 0.002);
    expect(r.pages).toHaveLength(2);
    expect(r.pages[1].score).toBe(90);
    expect(r.cost).toBe(0.006);
    expect(mergePage(report([]), savedPage(`${SITE}/c`)).pages).toHaveLength(1);
  });

  it("topIdeas y sortPages ponen primero lo más urgente", () => {
    const a = savedPage(`${SITE}/a`, { score: 80, ideas: [{ id: "terms", category: "contenido", priority: "baja", es: "x", en: "x", impact: 2 }] });
    const b = savedPage(`${SITE}/b`, {
      score: 40,
      ideas: [
        { id: "length", category: "contenido", priority: "alta", es: "l", en: "l", impact: 14 },
        { id: "title-keyword", category: "titulos", priority: "alta", es: "t", en: "t", impact: 10 },
        { id: "h1-keyword", category: "titulos", priority: "alta", es: "h", en: "h", impact: 9 },
      ],
    });
    const c = savedPage(`${SITE}/c`, { score: null, keyword: null, ideas: [] });
    expect(topIdeas([a, b, c]).map((x) => x.idea.id)).toEqual(["length", "title-keyword", "terms"]);
    expect(sortPages([c, a, b]).map((p) => p.url)).toEqual([`${SITE}/b`, `${SITE}/a`, `${SITE}/c`]);
  });
});

describe("readOnPageReport", () => {
  it("null si no es un reporte", () => {
    expect(readOnPageReport(null)).toBeNull();
    expect(readOnPageReport([])).toBeNull();
    expect(readOnPageReport("x")).toBeNull();
    expect(readOnPageReport({ pages: "x" })).toBeNull();
  });

  it("tolera datos rotos", () => {
    const r = readOnPageReport({
      zone: "x",
      language: "fr",
      cost: "caro",
      createdAt: "ayer",
      overrides: { [`${SITE}/a`]: "cortinas", "no-url": "x", [`${SITE}/b`]: 5 },
      pages: [
        null,
        { url: "no es url" },
        {
          url: `${SITE}/a`,
          keyword: "cortinas",
          keywordSource: "inventada",
          score: 150,
          ideas: [null, { es: "ok", category: "contenido", priority: "alta", impact: "x" }, { es: "mala", category: "otra", priority: "alta" }, { category: "titulos", priority: "baja" }],
          stats: { words: "mucho", title: 5, h2: [1, "Sub"], linksIn: null, loadSource: "radio", position: 0 },
          winners: [{ position: 1, domain: "a.com" }, { position: 0, domain: "b.com" }, "x"],
          suggestion: { title: "Nuevo", h2s: ["a", 3] },
          error: "falló",
          needsRecheck: "sí",
        },
        { url: `${SITE}/a/`, keyword: "duplicada" },
      ],
    });
    expect(r).not.toBeNull();
    expect(r!.language).toBe("es");
    expect(r!.cost).toBe(0);
    expect(r!.zone).toEqual({ code: 0, name: "" });
    expect(r!.createdAt).toBe(new Date(0).toISOString());
    expect(r!.overrides).toEqual({ [`${SITE}/a`]: "cortinas" });
    expect(r!.pages).toHaveLength(1);
    const p = r!.pages[0];
    expect(p.score).toBe(100);
    expect(p.keywordSource).toBeNull();
    expect(p.ideas).toEqual([{ id: "length", category: "contenido", priority: "alta", es: "ok", en: "ok", impact: 0 }]);
    expect(p.stats).toMatchObject({ words: 0, title: "", h2: ["Sub"], linksIn: null, loadSource: null, position: null, targetWords: null });
    expect(p.winners).toEqual([{ position: 1, domain: "a.com", url: "", title: "", words: null }]);
    expect(p.suggestion).toMatchObject({ title: "Nuevo", metaDescription: "", h2s: ["a"] });
    expect(p.error).toEqual({ es: "falló", en: "falló" });
    expect(p.needsRecheck).toBeUndefined();
    expect(p.brief).toBeNull();
  });

  it("lee lo que se guardó tal cual", () => {
    const saved = report([savedPage(`${SITE}/a`, { needsRecheck: true, skipped: true, error: { es: "a", en: "b" } })]);
    expect(readOnPageReport(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });
});
