import { describe, expect, it } from "vitest";
import {
  analyzePage,
  type AuditPage,
  findIssues,
  hasBusinessSchema,
  isPrivateHost,
  ISSUE_IDS,
  ISSUE_TEXT,
  normalizeUrl,
  parseSitemap,
  readAuditReport,
  scoreFor,
  type SiteInfo,
  startUrl,
} from "@/lib/seo/audit";

const words = (n: number) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(" ");

const SAMPLE = `<!doctype html>
<html lang="es">
<head>
  <title>Reparación de techos en Miami | Techos Pérez</title>
  <meta name="description" content="Reparamos e instalamos techos en Miami &amp; Hialeah. Presupuesto gratis.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta property="og:image" content="/foto.jpg">
  <link rel="canonical" href="/techos">
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"RoofingContractor","name":"Techos Pérez"},{"@type":"WebSite"}]}</script>
  <script>var x = "<h1>no cuenta</h1>";</script>
</head>
<body>
  <svg><title>icono</title></svg>
  <h1>Techos en <em>Miami</em></h1>
  <p>${words(30)}</p>
  <img src="a.jpg" alt="Techo nuevo">
  <img src="b.jpg">
  <img src="c.jpg" alt="">
  <noscript><img src="https://facebook.com/tr?id=1"></noscript>
  <a href="/servicios#precios">Servicios</a>
  <a href="https://www.techos.com/contacto?utm_source=x">Contacto</a>
  <a href="https://otro.com/">Afuera</a>
  <a href="mailto:hola@techos.com">Email</a>
  <a href="/folleto.pdf">PDF</a>
</body>
</html>`;

describe("analyzePage", () => {
  const a = analyzePage(SAMPLE, "https://techos.com/techos");

  it("lee título, descripción, h1, canonical e idioma", () => {
    expect(a.title).toBe("Reparación de techos en Miami | Techos Pérez");
    expect(a.description).toBe("Reparamos e instalamos techos en Miami & Hialeah. Presupuesto gratis.");
    expect(a.h1Count).toBe(1);
    expect(a.h1).toBe("Techos en Miami");
    expect(a.canonical).toBe("https://techos.com/techos");
    expect(a.lang).toBe("es");
    expect(a.viewport).toBe(true);
    expect(a.ogImage).toBe(true);
    expect(a.https).toBe(true);
    expect(a.noindex).toBe(false);
  });

  it("cuenta fotos sin alt (no las de noscript) y las palabras visibles", () => {
    expect(a.images).toBe(3);
    expect(a.imagesNoAlt).toBe(1);
    expect(a.words).toBeGreaterThanOrEqual(30);
    expect(a.words).toBeLessThan(45);
  });

  it("detecta JSON-LD de negocio local, incluso dentro de @graph", () => {
    expect(a.jsonLd).toBe(true);
    expect(a.schema).toEqual(expect.arrayContaining(["RoofingContractor", "WebSite"]));
    expect(hasBusinessSchema(a.schema)).toBe(true);
    expect(hasBusinessSchema(["WebSite", "BreadcrumbList"])).toBe(false);
  });

  it("solo guarda enlaces internos, sin #fragmento ni utm", () => {
    expect(a.links).toContain("https://techos.com/servicios");
    expect(a.links).toContain("https://www.techos.com/contacto");
    expect(a.links).toContain("https://techos.com/folleto.pdf");
    expect(a.links.some((l) => l.includes("otro.com") || l.startsWith("mailto"))).toBe(false);
  });

  it("detecta noindex y páginas sin título ni descripción", () => {
    const b = analyzePage(`<html><head><meta name="robots" content="noindex, follow"></head><body><h1>A</h1><h1>B</h1></body></html>`, "http://x.com/");
    expect(b.noindex).toBe(true);
    expect(b.title).toBe("");
    expect(b.description).toBe("");
    expect(b.h1Count).toBe(2);
    expect(b.lang).toBe("");
    expect(b.https).toBe(false);
    expect(b.jsonLd).toBe(false);
  });
});

const page = (over: Partial<AuditPage>): AuditPage => ({
  url: "https://x.com/",
  finalUrl: over.url ?? "https://x.com/",
  status: 200,
  ms: 400,
  bytes: 20000,
  title: "Plomero en Doral con servicio 24 horas | Plomería X",
  description: "Plomeros en Doral y Miami: destapes, fugas y calentadores. Servicio 24 horas, presupuesto gratis y garantía por escrito.",
  h1Count: 1,
  h1: "Plomero en Doral",
  canonical: "",
  noindex: false,
  lang: "es",
  images: 2,
  imagesNoAlt: 0,
  words: 600,
  internalLinks: 10,
  viewport: true,
  ogImage: true,
  jsonLd: true,
  schema: ["Plumber"],
  https: true,
  ...over,
});

const site: SiteInfo = {
  home: "https://x.com/",
  robots: true,
  sitemap: true,
  sitemapUrls: 3,
  https: true,
  httpRedirects: true,
  localBusinessSchema: true,
  brokenLinks: [],
  checkedLinks: 5,
  stoppedEarly: false,
};

describe("findIssues", () => {
  it("no encuentra nada en un sitio sano", () => {
    expect(findIssues([page({}), page({ url: "https://x.com/b", title: "Destapes de cañería en Doral | Plomería X", description: "Destapamos cañerías en Doral y Miami el mismo día. Sin romper pisos, con cámara y garantía por escrito para tu tranquilidad." })], site)).toEqual([]);
  });

  it("encuentra títulos repetidos, falta de descripción y poco texto", () => {
    const issues = findIssues(
      [page({ url: "https://x.com/" }), page({ url: "https://x.com/a", description: "" }), page({ url: "https://x.com/b", words: 120, description: "Otra descripción distinta con suficientes letras para no ser corta, sobre destapes en Doral." })],
      site,
    );
    const by = Object.fromEntries(issues.map((i) => [i.id, i]));
    expect(by["duplicate-title"].count).toBe(3);
    expect(by["missing-description"].pages).toEqual(["https://x.com/a"]);
    expect(by["thin-content"].pages).toEqual(["https://x.com/b"]);
    expect(by["duplicate-description"]).toBeUndefined();
  });

  it("no cuenta como duplicadas las páginas con el mismo canonical", () => {
    const issues = findIssues([page({ url: "https://x.com/?a=1", canonical: "https://x.com/" }), page({ url: "https://x.com/", canonical: "https://x.com/" })], site);
    expect(issues.find((i) => i.id === "duplicate-title")).toBeUndefined();
  });

  it("agrega problemas del sitio y los ordena por gravedad", () => {
    const issues = findIssues(
      [page({ status: 404, url: "https://x.com/viejo" }), page({ ogImage: false })],
      { ...site, sitemap: false, robots: false, localBusinessSchema: false, httpRedirects: false, brokenLinks: [{ url: "https://x.com/viejo", status: 404, from: ["https://x.com/"] }] },
    );
    const ids = issues.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["page-errors", "broken-links", "no-https", "no-sitemap", "no-robots", "no-structured-data", "no-og-image"]));
    const rank = { error: 0, warning: 1, notice: 2 };
    const ranks = issues.map((i) => rank[i.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(issues.find((i) => i.id === "no-https")!.pages).toEqual(["http://x.com/"]);
  });

  it("limita la lista a 10 páginas pero cuenta todas", () => {
    const pages = Array.from({ length: 14 }, (_, i) => page({ url: `https://x.com/p${i}`, title: `Página número ${i} de servicios en Doral, Florida`, description: "", imagesNoAlt: 1 }));
    const noAlt = findIssues(pages, site).find((i) => i.id === "images-no-alt")!;
    expect(noAlt.count).toBe(14);
    expect(noAlt.pages).toHaveLength(10);
  });
});

describe("scoreFor", () => {
  it("da 100 sin problemas", () => {
    expect(scoreFor([], 10)).toBe(100);
  });

  it("baja más con errores que con sugerencias, y más si afecta más páginas", () => {
    const err = scoreFor([{ id: "missing-title", severity: "error", count: 1 }], 10);
    const note = scoreFor([{ id: "no-og-image", severity: "notice", count: 1 }], 10);
    const errAll = scoreFor([{ id: "missing-title", severity: "error", count: 10 }], 10);
    expect(err).toBeLessThan(100);
    expect(err).toBeLessThan(note);
    expect(errAll).toBeLessThan(err);
  });

  it("nunca baja de 0", () => {
    const all = ISSUE_IDS.map((id) => ({ id, severity: "error" as const, count: 50 }));
    expect(scoreFor([...all, ...all], 5)).toBe(0);
  });
});

describe("helpers", () => {
  it("rechaza direcciones internas", () => {
    for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.10", "172.20.0.1", "169.254.169.254", "[::1]", "printer.local", "0.0.0.0"]) expect(isPrivateHost(h)).toBe(true);
    for (const h of ["example.com", "8.8.8.8", "172.32.0.1"]) expect(isPrivateHost(h)).toBe(false);
    expect(() => startUrl("http://localhost:3000")).toThrow();
    expect(() => startUrl("ftp://x.com")).toThrow();
    expect(startUrl("techos.com").href).toBe("https://techos.com/");
  });

  it("normaliza URLs y lee sitemaps", () => {
    expect(normalizeUrl("https://x.com/a?utm_source=f&id=2#top")).toBe("https://x.com/a?id=2");
    const s = parseSitemap(`<?xml version="1.0"?><urlset><url><loc>https://x.com/</loc></url><url><loc><![CDATA[https://x.com/a?b=1&amp;c=2]]></loc></url></urlset>`);
    expect(s.index).toBe(false);
    expect(s.urls).toEqual(["https://x.com/", "https://x.com/a?b=1&c=2"]);
    expect(parseSitemap(`<sitemapindex><sitemap><loc>https://x.com/s1.xml</loc></sitemap></sitemapindex>`).index).toBe(true);
  });

  it("lee con cuidado reportes viejos o rotos", () => {
    expect(readAuditReport(null)).toBeNull();
    expect(readAuditReport({ score: 50 })).toBeNull();
    const r = readAuditReport({ pages: [{ url: "https://x.com/", status: 200 }], issues: [{ id: "missing-title", pages: ["https://x.com/"] }, { id: "algo-viejo" }], score: 140 });
    expect(r?.issues.map((i) => i.id)).toEqual(["missing-title"]);
    expect(r?.issues[0].count).toBe(1);
    expect(r?.score).toBe(100);
    expect(r?.pages[0].title).toBe("");
    expect("error" in r!.pagespeed).toBe(true);
  });

  it("tiene textos en los dos idiomas para cada problema", () => {
    for (const id of ISSUE_IDS) {
      expect(ISSUE_TEXT[id].es.title && ISSUE_TEXT[id].es.fix && ISSUE_TEXT[id].en.title && ISSUE_TEXT[id].en.fix).toBeTruthy();
    }
  });
});
