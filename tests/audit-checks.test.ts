import { describe, expect, it } from "vitest";
import { analyzePage, type AuditPage, auditBreakdown, findIssues, ISSUE_IDS, ISSUE_META, ISSUE_TEXT, scoreFor, type SiteInfo, parseSitemap } from "@/lib/seo/audit";
import { checkLlmsTxt, isAllowed, parseRobots, robotsAiCheck, rulesFor } from "@/lib/seo/audit-ai";
import { CATEGORY_LABEL, LEGACY_ISSUE_IDS } from "@/lib/seo/audit-ids";
import { checkJsonLd } from "@/lib/seo/audit-schema";
import { isJunkWpUrl, isWpComHost, linkGraph, textHash } from "@/lib/seo/audit-site";
import { AUDIT_AI_FIX } from "@/lib/seo/audit-text";

const words = (n: number, w = "palabra") => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");
const ld = (json: unknown) => `<script type="application/ld+json">${typeof json === "string" ? json : JSON.stringify(json)}</script>`;

// El JSON-LD real de la página de inicio de ricardopa.com (recortado): LocalBusiness + ProfessionalService con
// availableLanguage directo en el negocio, que Semrush marcó como error en 43 páginas.
const RICARDOPA_LD = {
  "@context": "https://schema.org",
  "@type": ["LocalBusiness", "ProfessionalService"],
  "@id": "https://ricardopa.com/#business",
  name: "Ricardo Public Adjusters Corp.",
  url: "https://ricardopa.com/",
  telephone: "+1-305-394-8090",
  address: { "@type": "PostalAddress", streetAddress: "6800 Bird Rd, Suite 221", addressLocality: "Miami", addressRegion: "FL", postalCode: "33155", addressCountry: "US" },
  areaServed: [{ "@type": "AdministrativeArea", name: "Miami-Dade County" }, { "@type": "State", name: "Florida" }],
  availableLanguage: ["en", "es"],
  knowsLanguage: ["en", "es"],
  founder: { "@type": "Person", name: "Ricardo Arevalo", jobTitle: "Florida Public Adjuster" },
  openingHoursSpecification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], opens: "09:00", closes: "18:00" }],
};

describe("datos estructurados (JSON-LD)", () => {
  it("el caso de ricardopa.com: availableLanguage directo en LocalBusiness va en contactPoint", () => {
    const r = checkJsonLd(ld([RICARDOPA_LD]));
    expect(r.found).toBe(true);
    expect(r.types).toEqual(expect.arrayContaining(["LocalBusiness", "ProfessionalService", "PostalAddress"]));
    expect(r.findings).toEqual([{ kind: "wrong-property", value: "LocalBusiness.availableLanguage → contactPoint (ContactPoint)" }]);
  });

  it("availableLanguage dentro de contactPoint o en un hotel está bien", () => {
    const ok = { ...RICARDOPA_LD, availableLanguage: undefined, contactPoint: { "@type": "ContactPoint", contactType: "customer service", availableLanguage: ["English", "Spanish"] } };
    expect(checkJsonLd(ld(ok)).findings).toEqual([]);
    expect(checkJsonLd(ld({ "@type": "Hotel", name: "H", url: "https://h.com", telephone: "1", address: "x", availableLanguage: "es" })).findings).toEqual([]);
  });

  it("JSON mal escrito", () => {
    const r = checkJsonLd(`<script type="application/ld+json">{"@type":"LocalBusiness","name":"X",}</script>`);
    expect(r.findings[0].kind).toBe("invalid-json");
    expect(r.types).toContain("LocalBusiness");
  });

  it("negocio sin dirección, teléfono ni web; campos de dirección sueltos", () => {
    const r = checkJsonLd(ld({ "@context": "https://schema.org", "@type": "Plumber", name: "Plomería X", streetAddress: "Calle 8", openingHours: "Lunes a viernes 8-5" }));
    expect(r.findings).toEqual(
      expect.arrayContaining([
        { kind: "wrong-property", value: "Plumber.streetAddress → address (PostalAddress)" },
        { kind: "business-incomplete", value: "Plumber: address, telephone, url" },
        { kind: "opening-hours", value: 'Plumber openingHours: "Lunes a viernes 8-5"' },
      ]),
    );
  });

  it("horarios: formatos válidos y mal escritos", () => {
    const base = { "@type": "LocalBusiness", name: "X", url: "https://x.com", telephone: "1", address: "x" };
    expect(checkJsonLd(ld({ ...base, openingHours: ["Mo-Fr 09:00-18:00", "Sa 10:00-14:00", "Mo,We,Fr 08:00-12:00"] })).findings).toEqual([]);
    const bad = checkJsonLd(ld({ ...base, openingHoursSpecification: { dayOfWeek: ["Lunes", "https://schema.org/Tuesday"], opens: "9am", closes: "18:00" } })).findings;
    expect(bad.map((f) => f.value)).toEqual(['LocalBusiness opens: "9am"', 'LocalBusiness dayOfWeek: "Lunes"']);
  });

  it("Organization y WebSite incompletos (solo los principales; los anidados como publisher no)", () => {
    const r = checkJsonLd(ld({ "@context": "https://schema.org", "@graph": [{ "@type": "Organization", name: "Marca" }, { "@type": "WebSite", url: "https://x.com" }, { "@type": "Article", publisher: { "@type": "Organization", name: "Marca" } }] }));
    expect(r.findings).toEqual([
      { kind: "org-incomplete", value: "Organization: url, logo" },
      { kind: "org-incomplete", value: "WebSite: name" },
    ]);
  });

  it("una referencia a otro nodo no se exige completa", () => {
    expect(checkJsonLd(ld({ "@type": "Service", name: "Techos", provider: { "@type": "LocalBusiness", "@id": "https://x.com/#negocio" } })).findings).toEqual([]);
  });
});

describe("robots.txt y robots de IA", () => {
  const ROBOTS = `User-agent: *
Allow: /
Disallow: /api/

User-agent: GPTBot
User-agent: PerplexityBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: ClaudeBot
Disallow: /private/

Sitemap: https://x.com/sitemap.xml`;

  it("lista qué robots de IA están bloqueados, separados en búsqueda y entrenamiento", () => {
    const r = robotsAiCheck(ROBOTS);
    expect(r.blocksGoogle).toBe(false);
    expect(r.searchBlocked).toEqual(["PerplexityBot"]);
    expect(r.trainingBlocked).toEqual(["GPTBot", "Google-Extended"]);
  });

  it("Disallow: / para todos bloquea a Google y a todas las IAs", () => {
    const r = robotsAiCheck("User-agent: *\nDisallow: /\n");
    expect(r.blocksGoogle).toBe(true);
    expect(r.searchBlocked).toEqual(["OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Claude-User", "Claude-SearchBot"]);
    expect(r.trainingBlocked).toEqual(["GPTBot", "ClaudeBot", "Google-Extended", "Applebot-Extended"]);
  });

  it("gana la regla más larga y Allow en empate; un grupo propio reemplaza al de *", () => {
    const groups = parseRobots("User-agent: *\nDisallow: /\nAllow: /$\n\nUser-agent: Googlebot\nDisallow:\n");
    expect(isAllowed(rulesFor(groups, "Googlebot"), "/servicios")).toBe(true);
    expect(isAllowed(rulesFor(groups, "Bingbot"), "/")).toBe(true);
    expect(isAllowed(rulesFor(groups, "Bingbot"), "/servicios")).toBe(false);
    expect(robotsAiCheck("User-agent: *\nDisallow: /\nAllow: /$\n").blocksGoogle).toBe(false);
  });
});

describe("llms.txt", () => {
  it("bien armado", () => {
    expect(checkLlmsTxt(200, "text/plain", "# Techos Pérez\n\n> Reparamos techos en Miami.\n\n## Servicios\n- [Reparación](https://x.com/reparacion): techos con goteras\n")).toEqual({ status: "ok" });
    // El resumen «>» se recomienda pero no es obligatorio.
    expect(checkLlmsTxt(200, "text/markdown", "# Techos\n- [Inicio](https://x.com/)")).toEqual({ status: "ok" });
  });
  it("no existe, o la página devuelve HTML con 200 (no es un llms.txt)", () => {
    expect(checkLlmsTxt(404, "", "")).toEqual({ status: "missing", why: "not-found" });
    expect(checkLlmsTxt(200, "text/html; charset=utf-8", "<!doctype html><html>…")).toEqual({ status: "missing", why: "html" });
  });
  it("mal armado: sin título, sin enlaces o vacío", () => {
    expect(checkLlmsTxt(200, "text/plain", "Somos Techos Pérez, reparamos techos.")).toEqual({ status: "invalid", problems: ["no-title", "no-summary", "no-links"] });
    expect(checkLlmsTxt(200, "text/plain", "   ")).toEqual({ status: "invalid", problems: ["empty"] });
  });
});

describe("WordPress viejo y wp.com", () => {
  it("reconoce las direcciones que deja WordPress (las de ricardopa.com y otras)", () => {
    for (const u of [
      "https://ricardopa.com/2024/06/",
      "https://ricardopa.com/author/admin/",
      "https://ricardopa.com/category/uncategorized/",
      "https://ricardopa.com/uncategorized/",
      "https://x.com/tag/techos/",
      "https://x.com/?p=123",
      "https://x.com/index.php?page_id=7",
      "https://x.com/feed/",
      "https://x.com/blog/feed",
      "https://x.com/foto/attachment/techo-1/",
      "https://x.com/?attachment_id=55",
      "https://x.com/2019/12/mi-entrada",
    ])
      expect(isJunkWpUrl(u), u).toBe(true);
    for (const u of ["https://ricardopa.com/", "https://ricardopa.com/services/water-damage", "https://x.com/product-category/zapatos/", "https://x.com/blog/guia-2024", "https://x.com/?q=techos", "https://x.com/servicios?p=2", "https://x.com/feedback", "https://x.com/2024/13/"])
      expect(isJunkWpUrl(u), u).toBe(false);
  });

  it("wp.com y wordpress.com", () => {
    expect(isWpComHost("i0.wp.com")).toBe(true);
    expect(isWpComHost("ricardopa.files.wordpress.com")).toBe(true);
    expect(isWpComHost("wordpress.com")).toBe(true);
    expect(isWpComHost("mywp.com")).toBe(false);
    expect(isWpComHost("ricardopa.com")).toBe(false);
  });
});

describe("analyzePage: lo nuevo", () => {
  const HTML = `<!doctype html><html lang="es"><head>
    <title>Techos en Miami</title>
    <link rel="alternate" hreflang="en" href="/en">
    <link rel="stylesheet" href="http://cdn.viejo.com/estilo.css">
    <script src="http://cdn.viejo.com/app.js"></script>
    ${ld([RICARDOPA_LD])}
  </head><body>
    <div><h1>Techos en Miami</h1>
    <p>${words(160)}</p><p>Corto.</p>
    <img src="https://i0.wp.com/ricardopa.com/wp-content/uploads/2024/06/techo.jpg" alt="techo">
    <img src="http://x.com/inseguro.jpg" alt="foto">
    <img src="/bien.jpg" alt="bien">
    <a href="https://ricardopa.wordpress.com/2024/06/hola/">Blog viejo</a>
    <a href="/servicios">Servicios</a><a href="https://otro.com">Otro</a>
    <svg xmlns="http://www.w3.org/2000/svg"></svg></div>
  </body></html>`;
  const a = analyzePage(HTML, "https://x.com/techos");

  it("párrafos largos, estructura, enlaces y proporción de texto", () => {
    expect(a.longParagraphs).toBe(1);
    expect(a.longestParagraph).toBe(160);
    expect(a.longSample).toMatch(/^palabra0 palabra1 .*…$/);
    expect(a.hasMain).toBe(false);
    expect(a.h2Count).toBe(0);
    expect(a.linksTotal).toBe(3);
    expect(a.textRatio).toBeGreaterThan(0);
    expect(a.textRatio).toBeLessThan(100);
    expect(a.hreflang).toBe(1);
  });

  it("enlaces y fotos de wp.com, y contenido mixto (no cuenta el xmlns del SVG)", () => {
    expect(a.wpLinks).toBe(2);
    expect(a.wpSample).toBe("https://ricardopa.wordpress.com/2024/06/hola/");
    expect(a.mixed).toEqual(expect.arrayContaining(["http://x.com/inseguro.jpg", "http://cdn.viejo.com/app.js", "http://cdn.viejo.com/estilo.css"]));
    expect(a.mixedCount).toBe(3);
    expect(a.imageUrls).toContain("https://x.com/bien.jpg");
  });

  it("revisa el JSON-LD y guarda la huella del texto", () => {
    expect(a.schemaFindings).toEqual([{ kind: "wrong-property", value: "LocalBusiness.availableLanguage → contactPoint (ContactPoint)" }]);
    expect(a.textHash).toMatch(/^[0-9a-f]{8}$/);
    expect(analyzePage(HTML, "https://x.com/otra").textHash).toBe(a.textHash);
    expect(textHash("a")).not.toBe(textHash("b"));
  });

  it("una página http no tiene contenido mixto; una con <main> y <h2> sí tiene estructura", () => {
    expect(analyzePage(HTML, "http://x.com/techos").mixedCount).toBe(0);
    const b = analyzePage(`<html><body><main><h1>A</h1><h2>B</h2><p>${words(20)}</p></main></body></html>`, "https://x.com/");
    expect(b.hasMain).toBe(true);
    expect(b.h2Count).toBe(1);
    expect(b.longParagraphs).toBe(0);
  });

  it("el sitemap dice si tiene hreflang", () => {
    expect(parseSitemap(`<urlset><url><loc>https://x.com/</loc><xhtml:link rel="alternate" hreflang="es" href="https://x.com/es"/></url></urlset>`).hreflang).toBe(true);
    expect(parseSitemap(`<urlset><url><loc>https://x.com/</loc></url></urlset>`).hreflang).toBe(false);
  });
});

describe("clics desde el inicio y enlaces internos", () => {
  it("cuenta clics, enlaces que recibe cada página y sigue redirecciones", () => {
    const edges = new Map<string, string[]>([
      ["https://x.com/", ["https://x.com/a", "https://x.com/b", "https://x.com/viejo"]],
      ["https://x.com/a", ["https://x.com/a1", "https://x.com/"]],
      ["https://x.com/a1", ["https://x.com/a2"]],
      ["https://x.com/a2", ["https://x.com/a3"]],
      ["https://x.com/a3", []],
      ["https://x.com/b", ["https://x.com/a"]],
      ["https://x.com/huerfana", ["https://x.com/"]],
    ]);
    const g = linkGraph("https://x.com/", edges, (u) => (u === "https://x.com/viejo" ? "https://x.com/b" : u));
    expect(g.depth.get("https://x.com/")).toBe(0);
    expect(g.depth.get("https://x.com/a3")).toBe(4);
    expect(g.depth.has("https://x.com/huerfana")).toBe(false);
    expect(g.inlinks.get("https://x.com/a")).toBe(2);
    expect(g.inlinks.get("https://x.com/b")).toBe(1); // /viejo manda a /b: es el mismo enlace desde el inicio
    expect(g.inlinks.get("https://x.com/huerfana")).toBeUndefined();
  });
});

// ---------- findIssues con los datos nuevos ----------

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
  h2Count: 3,
  hasMain: true,
  longParagraphs: 0,
  longestParagraph: 80,
  longSample: "",
  textRatio: 25,
  linksTotal: 40,
  wpLinks: 0,
  wpSample: "",
  mixed: [],
  mixedCount: 0,
  hreflang: 0,
  textHash: over.url ?? "home",
  schemaFindings: [],
  depth: 1,
  inlinks: 3,
  inSitemap: true,
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
  robotsAi: { blocksGoogle: false, searchBlocked: [], trainingBlocked: [] },
  llms: { status: "ok" },
  wwwRedirects: true,
  altHost: "www.x.com",
  junkUrls: [],
  sitemapBad: [],
  brokenImages: [],
  checkedImages: 4,
  sitemapHreflang: false,
};

const healthy = [
  page({ url: "https://x.com/", depth: 0, inlinks: 0 }),
  page({ url: "https://x.com/b", title: "Destapes de cañería en Doral | Plomería X", description: "Destapamos cañerías en Doral y Miami el mismo día. Sin romper pisos, con cámara y garantía por escrito para tu tranquilidad." }),
];
const by = (pages: AuditPage[], s: SiteInfo = site) => Object.fromEntries(findIssues(pages, s).map((i) => [i.id, i]));

describe("findIssues: revisiones nuevas", () => {
  it("un sitio sano con todos los datos nuevos no tiene problemas", () => {
    expect(findIssues(healthy, site)).toEqual([]);
  });

  it("datos estructurados: el error de ricardopa con su valor exacto, y JSON roto como error", () => {
    const f = by([
      page({ url: "https://x.com/", schemaFindings: [{ kind: "wrong-property", value: "LocalBusiness.availableLanguage → contactPoint (ContactPoint)" }] }),
      page({ url: "https://x.com/es", title: "Plomero en Doral, servicio 24 horas | Plomería X", schemaFindings: [{ kind: "wrong-property", value: "LocalBusiness.availableLanguage → contactPoint (ContactPoint)" }, { kind: "invalid-json", value: "Unexpected token }" }] }),
    ]);
    expect(f["schema-wrong-property"].count).toBe(2);
    expect(f["schema-wrong-property"].severity).toBe("warning");
    expect(f["schema-wrong-property"].category).toBe("schema");
    expect(f["schema-wrong-property"].items![0]).toEqual({ url: "https://x.com/", value: "LocalBusiness.availableLanguage → contactPoint (ContactPoint)" });
    expect(f["schema-invalid-json"].severity).toBe("error");
    expect(f["schema-invalid-json"].pages).toEqual(["https://x.com/es"]);
  });

  it("títulos largos guardan el título exacto y cuántas letras tiene", () => {
    const long = "Reparación de techos, goteras e impermeabilización en Miami y Hialeah | Techos Pérez";
    const i = by([page({ title: long })])["title-too-long"];
    expect(i.items![0]).toEqual({ url: "https://x.com/", value: long, detail: { es: `${long.length} letras`, en: `${long.length} characters` } });
  });

  it("contenido, IA y rendimiento por página", () => {
    const f = by([
      page({ url: "https://x.com/", depth: 0, inlinks: 0, h1: "Plomero en Doral con servicio 24 horas | Plomería X", longParagraphs: 2, longestParagraph: 210, longSample: "Somos una empresa…", hasMain: false, textRatio: 6.2, linksTotal: 320, wpLinks: 23, wpSample: "https://i0.wp.com/x.com/foto.jpg", mixed: ["http://x.com/a.jpg"], mixedCount: 1, bytes: 2_500_000 }),
      page({ url: "https://x.com/b", title: "Otra página distinta de servicios en Doral FL", wpLinks: 12, depth: 5, inlinks: 1 }),
    ]);
    expect(f["h1-same-as-title"].pages).toEqual(["https://x.com/"]);
    expect(f["long-paragraphs"].items![0].detail!.es).toBe("2 párrafos largos; el más largo tiene 210 palabras");
    expect(f["weak-semantic-html"].items![0].value).toBe("<main>/<article>");
    expect(f["low-text-ratio"].items![0].value).toBe("6.2%");
    expect(f["too-many-links"].items![0].value).toBe("320");
    expect(f["wp-com-links"].count).toBe(2);
    expect(f["wp-com-links"].total).toBe(35);
    expect(f["mixed-content"].items![0].value).toBe("http://x.com/a.jpg");
    expect(f["large-html"].items![0].value).toBe("2.5 MB");
    expect(f["deep-pages"].pages).toEqual(["https://x.com/b"]);
    expect(f["single-inlink"].pages).toEqual(["https://x.com/b"]);
    expect(f["single-inlink"].severity).toBe("notice");
  });

  it("páginas huérfanas del sitemap (con al menos 5 páginas leídas) y texto duplicado", () => {
    const pages = [
      page({ url: "https://x.com/", depth: 0, inlinks: 0 }),
      ...[1, 2, 3].map((n) => page({ url: `https://x.com/p${n}`, title: `Servicio número ${n} de plomería en Doral FL`, description: `Descripción ${n} con suficientes letras para que no sea corta y diga qué hacemos en Doral.` })),
      page({ url: "https://x.com/sola", title: "Página sola de servicios de plomería en Doral", description: "Otra descripción con suficientes letras para no ser corta, sobre plomería en Doral.", inlinks: 0, depth: null, textHash: "same" }),
      page({ url: "https://x.com/copia", title: "Copia de la página de servicios de plomería Doral", description: "Una descripción más con suficientes letras para no ser corta, sobre plomería en Doral.", textHash: "same" }),
    ];
    const f = by(pages);
    expect(f["orphan-pages"].pages).toEqual(["https://x.com/sola"]);
    expect(f["duplicate-content"].pages.sort()).toEqual(["https://x.com/copia", "https://x.com/sola"]);
    expect(f["duplicate-content"].items![0].detail!.es).toBe("Igual en 2 páginas");
  });

  it("sitio en dos idiomas sin hreflang (salvo que el sitemap lo tenga)", () => {
    const pages = [page({ url: "https://x.com/", lang: "en" }), page({ url: "https://x.com/es", lang: "es-US", title: "Plomero en Doral, servicio de 24 horas | Plomería X" })];
    expect(by(pages)["hreflang-missing"].count).toBe(2);
    expect(by(pages, { ...site, sitemapHreflang: true })["hreflang-missing"]).toBeUndefined();
    expect(by([...pages.map((p) => ({ ...p, hreflang: 2 }))])["hreflang-missing"]).toBeUndefined();
  });

  it("de todo el sitio: robots, IAs, llms.txt, www, WordPress viejo, sitemap y fotos rotas", () => {
    const f = by(healthy, {
      ...site,
      robotsAi: { blocksGoogle: true, searchBlocked: ["OAI-SearchBot", "PerplexityBot"], trainingBlocked: ["GPTBot"] },
      llms: { status: "missing", why: "not-found" },
      wwwRedirects: false,
      junkUrls: [
        { url: "https://x.com/author/admin/", status: 200, where: "probe", live: true },
        { url: "https://x.com/2024/06/", status: 404, where: "sitemap", live: false },
        { url: "https://x.com/category/uncategorized/", status: 404, where: "link", live: false },
      ],
      sitemapBad: [{ url: "https://x.com/viejo", status: 404, why: "error" }, { url: "https://x.com/a", status: 200, why: "redirect", to: "https://x.com/a/" }],
      brokenImages: [{ url: "https://x.com/foto.jpg", status: 404, from: ["https://x.com/"] }],
    });
    expect(f["robots-blocks-site"].severity).toBe("error");
    expect(f["robots-blocks-site"].pages).toEqual(["https://x.com/robots.txt"]);
    expect(f["ai-search-bots-blocked"].items![0].value).toBe("OAI-SearchBot, PerplexityBot");
    expect(f["ai-training-bots-blocked"].items![0].value).toBe("GPTBot");
    expect(f["llms-txt-missing"].pages).toEqual(["https://x.com/llms.txt"]);
    expect(f["www-mismatch"].pages).toEqual(["https://www.x.com/"]);
    expect(f["wp-junk-urls"].pages).toEqual(["https://x.com/author/admin/", "https://x.com/2024/06/"]);
    expect(f["wp-junk-urls"].items![1].detail!.es).toBe("Responde 404 · en el sitemap");
    expect(f["sitemap-bad-urls"].count).toBe(2);
    expect(f["sitemap-bad-urls"].items![1]).toEqual({ url: "https://x.com/a", value: "https://x.com/a/", detail: { es: "manda a otra página: https://x.com/a/", en: "redirects to another page: https://x.com/a/" } });
    expect(f["broken-images"].items![0].value).toBe("404");
  });

  it("llms.txt mal armado dice qué le falta", () => {
    const f = by(healthy, { ...site, llms: { status: "invalid", problems: ["no-title", "no-links"] } });
    expect(f["llms-txt-invalid"].items![0].detail!.es).toBe("no empieza con «# Nombre»; no tiene enlaces a tus páginas");
  });

  it("si robots.txt o el sitemap no respondieron, no se marcan como faltantes", () => {
    const f = by(healthy, { ...site, robots: false, robotsChecked: false, sitemap: false, sitemapChecked: false });
    expect(f["no-robots"]).toBeUndefined();
    expect(f["no-sitemap"]).toBeUndefined();
    expect(by(healthy, { ...site, robots: false, sitemap: false })["no-sitemap"]).toBeDefined();
  });
});

describe("nota", () => {
  it("lo que resta cada problema suma lo mismo que scoreFor, y los de todo el sitio restan completo", () => {
    const issues = findIssues(
      [page({ url: "https://x.com/", title: "x".repeat(70) }), page({ url: "https://x.com/b", title: "Otra página distinta de servicios en Doral FL", wpLinks: 3 })],
      { ...site, llms: { status: "missing", why: "not-found" }, robotsAi: { blocksGoogle: false, searchBlocked: ["PerplexityBot"], trainingBlocked: [] } },
    );
    const total = auditBreakdown(issues, 2).reduce((s, d) => s + d.points, 0);
    expect(scoreFor(issues, 2)).toBe(Math.round(100 - total));
    expect(auditBreakdown(issues, 10).find((d) => d.id === "llms-txt-missing")?.points).toBe(1);
    expect(auditBreakdown(issues, 10).find((d) => d.id === "ai-search-bots-blocked")?.points).toBe(4);
  });
});

describe("textos y datos de cada problema", () => {
  it("cada id tiene gravedad, grupo, título y arreglo en los dos idiomas, y la versión para la IA", () => {
    for (const id of ISSUE_IDS) {
      expect(ISSUE_META[id].severity, id).toMatch(/^(error|warning|notice)$/);
      expect(CATEGORY_LABEL[ISSUE_META[id].category].es, id).toBeTruthy();
      expect(ISSUE_TEXT[id].es.title && ISSUE_TEXT[id].es.fix && ISSUE_TEXT[id].en.title && ISSUE_TEXT[id].en.fix, id).toBeTruthy();
      expect(AUDIT_AI_FIX[id].es && AUDIT_AI_FIX[id].en, id).toBeTruthy();
    }
    expect(new Set(ISSUE_IDS).size).toBe(ISSUE_IDS.length);
    expect(ISSUE_IDS.slice(0, LEGACY_ISSUE_IDS.length)).toEqual([...LEGACY_ISSUE_IDS]);
  });
});
