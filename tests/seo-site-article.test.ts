import { afterEach, describe, expect, it, vi } from "vitest";
import { placeSiteArticle, publishSiteArticle, siteArticleUrl, type SiteArticleInput, type SiteEntry } from "@/lib/publishers/website";
import {
  approveCostCents,
  approveLabel,
  markdownToSections,
  needsAiPick,
  plainInline,
  rankArticlePhotos,
  readArticleSite,
  sameShape,
  siteArticleId,
  siteErrorText,
  sourceCopy,
  type PhotoItem,
} from "@/lib/seo/site-article";

describe("markdown → secciones del sitio", () => {
  it("quita negritas y cursivas y deja la dirección de los enlaces web", () => {
    expect(plainInline("**Revisamos** tu *póliza* con `cuidado`")).toBe("Revisamos tu póliza con cuidado");
    expect(plainInline("Llama al [305-394-8090](tel:3053948090)")).toBe("Llama al 305-394-8090");
    expect(plainInline("Mira [nuestra web](https://ricardopa.com/)")).toBe("Mira nuestra web (ricardopa.com)");
    expect(plainInline("Entra a [ricardopa.com](https://ricardopa.com)")).toBe("Entra a ricardopa.com");
  });

  it("cada ## es una sección con párrafo, lista y párrafo final; el texto de arriba va en «Introducción»", () => {
    const md = "Intro uno.\n\nIntro dos.\n\n## Qué hacer\n\nPrimero esto.\n\n- Fotos\n- Videos\n\nDespués avisa.\n\n## Contacto\n\nLlámanos.";
    const { sections, faq } = markdownToSections(md, "es");
    expect(faq).toEqual([]);
    expect(sections).toEqual([
      { title: "Introducción", text: "Intro uno. Intro dos." },
      { title: "Qué hacer", text: "Primero esto.", items: ["Fotos", "Videos"], after: "Después avisa." },
      { title: "Contacto", text: "Llámanos." },
    ]);
    expect(markdownToSections("Hello.\n\n## A\n\nB", "en").sections[0].title).toBe("Introduction");
  });

  it("no pierde texto: una lista sin párrafo antes y una segunda lista van como texto", () => {
    const { sections } = markdownToSections("## Pasos\n\n- Uno\n- Dos\n\nLuego.\n\n1. Tres\n2. Cuatro", "es");
    expect(sections).toEqual([{ title: "Pasos", text: "Uno. Dos. Luego.", items: ["Tres", "Cuatro"] }]);
    const two = markdownToSections("## Pasos\n\nAntes.\n\n- Uno\n\nMedio.\n\n- Dos", "es").sections[0];
    expect(two).toEqual({ title: "Pasos", text: "Antes.", items: ["Uno"], after: "Medio. Dos." });
  });

  it("los ### son secciones propias; si el ## no tiene texto, su título se une al primero", () => {
    const { sections } = markdownToSections("## Tipos\n\n### Enrollables\n\nTexto A.\n\n### Corredizos\n\nTexto B.", "es");
    expect(sections.map((s) => s.title)).toEqual(["Tipos: Enrollables", "Corredizos"]);
    const withText = markdownToSections("## Tipos\n\nHay dos.\n\n### Enrollables\n\nTexto A.", "es").sections;
    expect(withText.map((s) => s.title)).toEqual(["Tipos", "Enrollables"]);
  });

  it("las preguntas frecuentes van a `faq` (con ### o con un párrafo que es la pregunta)", () => {
    const md = "## Preguntas frecuentes\n\n### ¿Cuánto tarda?\n\nUnos días.\n\n### ¿Tiene costo?\n\nNo.\n\n- Por teléfono\n- Por Zoom";
    const { sections, faq } = markdownToSections(md, "es");
    expect(sections).toEqual([]);
    expect(faq).toEqual([
      ["¿Cuánto tarda?", "Unos días."],
      ["¿Tiene costo?", "No. Por teléfono. Por Zoom."],
    ]);
    const bold = markdownToSections("## FAQ\n\n**What does it cost?**\n\nNothing.", "en");
    expect(bold.faq).toEqual([["What does it cost?", "Nothing."]]);
  });

  it("no repite títulos de sección (el sitio los usa como llave)", () => {
    const { sections } = markdownToSections("## Precio\n\nA.\n\n## Precio\n\nB.", "es");
    expect(sections.map((s) => s.title)).toEqual(["Precio", "Precio (2)"]);
  });

  it("arma la versión del idioma original con el título, el resumen y el slug del escritor", () => {
    const copy = sourceCopy({
      language: "es",
      draft: { title: "Título SEO", metaDescription: "Resumen.", slug: "Daños por Agua", h1: "Título grande", outline: [], markdown: "## Uno\n\nTexto.", socialPost: "" },
    });
    expect(copy).toMatchObject({ slug: "danos-por-agua", seoTitle: "Título SEO", title: "Título grande", description: "Resumen.", sections: [{ title: "Uno", text: "Texto." }] });
  });

  it("revisa que la traducción tenga la misma forma", () => {
    const a = { sections: [{ title: "A", text: "x", items: ["1", "2"] }], faq: [["q", "a"]] as [string, string][] };
    expect(sameShape(a, { sections: [{ title: "B", text: "y", items: ["1", "2"] }], faq: [["q", "a"]] })).toBe(true);
    expect(sameShape(a, { sections: [{ title: "B", text: "y", items: ["1"] }], faq: [["q", "a"]] })).toBe(false);
    expect(sameShape(a, { sections: [{ title: "B", text: "y", items: ["1", "2"] }] })).toBe(false);
  });
});

describe("dirección del artículo en la web", () => {
  it("usa /es/recursos y /resources, como la web", () => {
    expect(siteArticleUrl("https://ricardopa.com/", "es", "danos-por-agua")).toBe("https://ricardopa.com/es/recursos/danos-por-agua");
    expect(siteArticleUrl(" https://ricardopa.com ", "en", "water-damage")).toBe("https://ricardopa.com/resources/water-damage");
  });
  it("el id del artículo es fijo y sirve como nombre de la foto", () => {
    expect(siteArticleId("cmabc123XYZ")).toBe("article-cmabc123xyz");
    expect(/^[a-z0-9-]+$/.test(siteArticleId("cm_1.2"))).toBe(true);
  });
});

const item = (id: string, over: Partial<PhotoItem> = {}): PhotoItem => ({
  id,
  kind: "photo",
  url: `https://cdn.test/${id}.jpg`,
  status: "ready",
  usable: true,
  quality: 4,
  privacy: [],
  choice: "",
  tags: [],
  folderPath: "",
  description: null,
  width: 1600,
  height: 900,
  usedCount: 0,
  lastUsedAt: null,
  ...over,
});

describe("fotos de la biblioteca para el artículo", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const q = { text: "daños por agua en casa\nfuga de agua en el techo", keywords: ["daños por agua"] };

  it("ordena por parecido con el tema y deja fuera las que no se pueden usar o no tienen que ver", () => {
    const items = [
      item("roof", { tags: ["techo"], description: { es: "Techo de una casa", en: "House roof", scene: "done", topics: ["techo"] } }),
      item("water", { tags: ["agua", "daños"], description: { es: "Daños por agua en una sala", en: "Water damage in a living room", scene: "damage", topics: ["daños por agua"] } }),
      item("private", { tags: ["agua", "daños"], privacy: ["faces"] }),
      item("car", { tags: ["carro"] }),
      item("video", { kind: "video", tags: ["agua", "daños"] }),
    ];
    const ranked = rankArticlePhotos(items, q, now);
    expect(ranked.map((r) => r.item.id)).toEqual(["water", "roof"]);
  });

  it("prefiere la horizontal y la menos usada cuando se parecen igual", () => {
    const base = { tags: ["agua", "daños"] };
    const ranked = rankArticlePhotos([item("vertical", { ...base, width: 900, height: 1600 }), item("wide", base)], q, now);
    expect(ranked[0].item.id).toBe("wide");
    const used = rankArticlePhotos([item("used", { ...base, usedCount: 3 }), item("fresh", base)], q, now);
    expect(used[0].item.id).toBe("fresh");
  });

  it("solo pregunta a la IA si la mejor no es clara", () => {
    const strong = rankArticlePhotos([item("a", { tags: ["agua", "daños", "techo", "fuga"] })], q, now);
    expect(needsAiPick(strong)).toBe(false);
    const weak = rankArticlePhotos([item("b", { tags: ["techo"] })], q, now);
    expect(needsAiPick(weak)).toBe(true);
    const tie = rankArticlePhotos([item("c", { tags: ["agua", "daños", "techo", "fuga"] }), item("d", { tags: ["agua", "daños", "techo", "fuga"] })], q, now);
    expect(needsAiPick(tie)).toBe(true);
    expect(needsAiPick([])).toBe(false);
  });
});

describe("costo de publicar", () => {
  it("solo cuesta la foto que la IA va a crear; publicar es gratis", () => {
    expect(approveCostCents({ kind: "generate", idea: "x" }, 4)).toBe(4);
    expect(approveCostCents({ kind: "library", itemId: "a", url: "https://x", thumb: "", label: "" }, 4)).toBe(0);
    expect(approveCostCents({ kind: "generated", url: "https://x", idea: "", costCents: 4 }, 4)).toBe(0);
    expect(approveCostCents({ kind: "stock" }, 7)).toBe(0);
  });
  it("el botón dice el total", () => {
    expect(approveLabel(4, false)).toEqual({ es: "Autorizar y publicar · US$0.04", en: "Approve and publish · US$0.04" });
    expect(approveLabel(0, true).es).toBe("Autorizar y actualizar · sin costo");
  });
});

describe("lo guardado en el reporte", () => {
  it("lee la vista previa y lo publicado sin confiar en la forma", () => {
    const copy = { slug: "a", seoTitle: "A", title: "A", description: "d", category: "c", sections: [{ title: "T", text: "x", items: ["1"] }, { title: "", text: "vacía" }] };
    const site = readArticleSite({
      prepared: { at: "2026-10-10T00:00:00Z", draftAt: "v1", mode: "new", photoKey: "nope", es: copy, en: copy, photo: { kind: "library", itemId: "i", url: "javascript:alert(1)" }, options: [{ id: "x", url: "ftp://bad" }] },
      published: { at: "2026-10-10T00:00:00Z", url: "https://s/es/recursos/a", date: "2026-10-10", slugEs: "a" },
    });
    expect(site.prepared?.photoKey).toBe("review");
    expect(site.prepared?.photo).toEqual({ kind: "stock" });
    expect(site.prepared?.options).toEqual([]);
    expect(site.prepared?.es.sections).toEqual([{ title: "T", text: "x", items: ["1"] }]);
    expect(site.published?.date).toBe("2026-10-10");
    expect(readArticleSite(null)).toEqual({});
  });
});

describe("errores de la web en palabras simples", () => {
  it("explica la llave vencida, el permiso, el repo y la conexión incompleta", () => {
    expect(siteErrorText("401: Bad credentials").es).toMatch(/llave de GitHub/);
    expect(siteErrorText("403: Resource not accessible").en).toMatch(/write access/);
    expect(siteErrorText("404: Not Found").es).toMatch(/No encontramos tu web/);
    expect(siteErrorText("404: Tu sitio todavía no está preparado: falta content/articles.json").es).toMatch(/preparada/);
    expect(siteErrorText("Faltan datos de la conexión: githubToken").es).toBe("A la conexión de tu web le falta la llave de GitHub. Complétala en Conexiones → Sitio web.");
    expect(siteErrorText("Faltan datos de la conexión: repo, siteUrl").en).toMatch(/the repository and your website address/);
    expect(siteErrorText("409: conflict").es).toMatch(/Intenta otra vez/);
  });
});

const input = (over: Partial<SiteArticleInput> = {}): SiteArticleInput => ({
  id: "article-r1",
  photo: "water",
  es: { slug: "danos-por-agua", seoTitle: "S", title: "Daños por agua", description: "D", category: "Reclamos", sections: [{ title: "Uno", text: "Texto", items: ["a", " "] }], faq: [["¿P?", "R"]] },
  en: { slug: "water-damage", seoTitle: "S", title: "Water damage", description: "D", category: "Claims", sections: [{ title: "One", text: "Text", items: ["a"] }], faq: [["Q?", "A"]] },
  ...over,
});
const existing = (): SiteEntry[] => [
  { id: "post-1", published: "2026-10-01", photo: "roof", es: { slug: "danos-por-agua", seoTitle: "x", title: "x", description: "x", category: "x", sections: [{ title: "x", text: "x" }] }, en: { slug: "other", seoTitle: "x", title: "x", description: "x", category: "x", sections: [{ title: "x", text: "x" }] } },
];

describe("poner el artículo en content/articles.json", () => {
  it("nuevo: va primero, con listas y preguntas, y sin repetir slugs", () => {
    const { list, article, already } = placeSiteArticle(existing(), input(), { mode: "new", today: "2026-10-10", image: "/images/marketing/article-r1.webp" });
    expect(already).toBe(false);
    expect(list[0]).toBe(article);
    expect(article.es.slug).toBe("danos-por-agua-2");
    expect(article.en.slug).toBe("water-damage");
    expect(article.es.sections[0].items).toEqual(["a"]);
    expect(article.es.faq).toEqual([["¿P?", "R"]]);
    expect(article.published).toBe("2026-10-10");
    expect(article.image).toBe("/images/marketing/article-r1.webp");
  });
  it("no publica dos veces el mismo artículo", () => {
    const first = placeSiteArticle(existing(), input(), { mode: "new", today: "2026-10-10" }).list;
    const again = placeSiteArticle(first, input(), { mode: "new", today: "2026-10-11" });
    expect(again.already).toBe(true);
    expect(again.list).toHaveLength(2);
  });
  it("actualizar: misma dirección y fecha de publicación, con «Actualizado»", () => {
    const first = placeSiteArticle(existing(), input(), { mode: "new", today: "2026-10-10", image: "/images/marketing/article-r1.webp" }).list;
    const { list, article } = placeSiteArticle(first, input({ es: { ...input().es, slug: "otro", title: "Nuevo título" } }), { mode: "update", today: "2026-10-12" });
    expect(list).toHaveLength(2);
    expect(article.es.slug).toBe("danos-por-agua-2");
    expect(article.es.title).toBe("Nuevo título");
    expect(article.published).toBe("2026-10-10");
    expect(article.updated).toBe("2026-10-12");
    expect(article.image).toBe("/images/marketing/article-r1.webp");
    expect(() => placeSiteArticle(existing(), input(), { mode: "update" })).toThrow(/ya no está/);
  });
});

describe("publicar en GitHub (simulado, sin red)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const creds = { repo: "owner/site", githubToken: "fake", branch: "main", siteUrl: "https://ricardopa.com" };

  it("lee articles.json y lo guarda con el artículo nuevo en un commit", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url, method: init.method ?? "GET", body: init.body as string | undefined });
        if (!init.method) return new Response(JSON.stringify({ sha: "abc", content: Buffer.from(JSON.stringify(existing())).toString("base64") }), { status: 200 });
        return new Response("{}", { status: 200 });
      }),
    );
    const out = await publishSiteArticle(input(), creds, { mode: "new", today: "2026-10-10" });
    expect(out.url).toBe("https://ricardopa.com/es/recursos/danos-por-agua-2");
    expect(out.urlEn).toBe("https://ricardopa.com/resources/water-damage");
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toBe("https://api.github.com/repos/owner/site/contents/content/articles.json");
    const body = JSON.parse(put!.body!) as { sha: string; content: string; branch: string };
    expect(body.sha).toBe("abc");
    const saved = JSON.parse(Buffer.from(body.content, "base64").toString("utf8")) as SiteEntry[];
    expect(saved.map((a) => a.id)).toEqual(["article-r1", "post-1"]);
  });

  it("si ya estaba, no escribe nada", async () => {
    const list = placeSiteArticle(existing(), input(), { mode: "new", today: "2026-10-10" }).list;
    const fetch = vi.fn(async () => new Response(JSON.stringify({ sha: "abc", content: Buffer.from(JSON.stringify(list)).toString("base64") }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const out = await publishSiteArticle(input(), creds, { mode: "new" });
    expect(out.already).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("si la llave falla, el error dice el código (para explicarlo en palabras simples)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 })));
    await expect(publishSiteArticle(input(), creds, { mode: "new" })).rejects.toThrow(/^401: Bad credentials/);
    await expect(publishSiteArticle(input(), { ...creds, githubToken: "" }, { mode: "new" })).rejects.toThrow(/githubToken/);
  });
});
