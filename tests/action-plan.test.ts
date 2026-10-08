// El plan de acción único: cada regla convierte un reporte guardado en tareas (con los datos reales de Fameseg y
// reportes de ejemplo con la forma de los guardados), las claves no cambian entre corridas, lo que no tiene que ver
// con el negocio no entra y los estados que marcó el dueño se respetan.
import { describe, expect, it } from "vitest";
import { taskScore, type TaskDraft } from "@/lib/action-plan-shape";
import {
  aiTasks,
  auditTasks,
  backlinksTasks,
  cannibalTasks,
  decayTasks,
  gapTasks,
  gbpTasks,
  gscTasks,
  mapTasks,
  mergeDrafts,
  onpageTasks,
  planChanges,
  questionTasks,
  rankTasks,
  schemaTasks,
  setupTasks,
  sourceLine,
  type RuleCtx,
  type Saved,
} from "@/lib/action-plan-rules";
import { ISSUE_IDS } from "@/lib/seo/audit";
import { buildCannibal } from "@/lib/seo/cannibal";
import { businessTopicVocab, isRelevantKeyword } from "@/lib/seo/gap";
import type { QuestionsData } from "@/lib/seo/questions";
import { fmtDate } from "@/lib/time";
import fameseg from "./fixtures/fameseg.json";
import { backlinksSaved, cannibalPageQueries, cannibalRange, famesegAiWithTone, gscSaved, mapBefore, mapNow } from "./fixtures/seo-tools";

const ID = "cmuvspllw0000l6047ocei6sx";
const ctx: RuleCtx = { businessId: ID, website: fameseg.business.website, name: fameseg.business.name, vocab: businessTopicVocab(fameseg.business) };
const saved = (r: { data: unknown; createdAt: string }): Saved => ({ data: r.data, createdAt: r.createdAt });
const AT = "2026-10-06T14:00:00.000Z";
const keys = (list: TaskDraft[]) => list.map((t) => t.key);
const last = (t: TaskDraft) => t.detail!.es.split("\n\n").pop();

// ---------- Reportes de ejemplo con la forma de los guardados ----------

const auditPage = (path: string, extra: Record<string, unknown> = {}) => ({
  url: `https://fameseg.com${path}`,
  finalUrl: `https://fameseg.com${path}`,
  status: 200,
  ms: 400,
  bytes: 30000,
  title: "Cortinas metálicas en Managua | Fameseg",
  description: "",
  h1Count: 1,
  h1: "Cortinas metálicas",
  canonical: "",
  noindex: false,
  lang: "es",
  images: 4,
  imagesNoAlt: 0,
  words: 600,
  internalLinks: 12,
  viewport: true,
  ogImage: true,
  jsonLd: false,
  schema: [],
  https: true,
  ...extra,
});

const auditData = (extra: { issues?: unknown[]; localBusinessSchema?: boolean } = {}) => ({
  version: 1,
  website: "https://fameseg.com",
  startedAt: AT,
  finishedAt: AT,
  pages: [auditPage("/"), auditPage("/cortinas-metalicas"), auditPage("/portones"), auditPage("/contacto")],
  site: {
    home: "https://fameseg.com/",
    robots: true,
    sitemap: false,
    sitemapUrls: 0,
    https: true,
    httpRedirects: true,
    localBusinessSchema: extra.localBusinessSchema ?? false,
    brokenLinks: [
      { url: "https://fameseg.com/promo-2024", status: 404, from: ["https://fameseg.com/"] },
      { url: "https://fameseg.com/viejo", status: 404, from: ["https://fameseg.com/portones"] },
    ],
    checkedLinks: 40,
    stoppedEarly: false,
  },
  pagespeed: { error: "sin clave" },
  issues: extra.issues ?? [
    { id: "broken-links", severity: "error", pages: ["https://fameseg.com/promo-2024", "https://fameseg.com/viejo"], count: 2 },
    { id: "missing-description", severity: "warning", pages: ["https://fameseg.com/", "https://fameseg.com/cortinas-metalicas", "https://fameseg.com/portones"], count: 3 },
    { id: "no-sitemap", severity: "warning", pages: [], count: 1 },
    { id: "no-structured-data", severity: "warning", pages: [], count: 1 },
    { id: "title-too-short", severity: "notice", pages: ["https://fameseg.com/contacto"], count: 1 },
  ],
  score: 72,
});

const idea = (id: string, category: string, priority: string, es: string, detail?: string[]) => ({ id, category, priority, es, en: `${es} (en)`, impact: 5, ...(detail ? { detail } : {}) });
const onpageData = {
  version: 1,
  zone: { code: 2558, name: "Nicaragua" },
  language: "es",
  overrides: {},
  cost: 0.02,
  createdAt: AT,
  stoppedEarly: false,
  pages: [
    {
      url: "https://fameseg.com/cortinas-metalicas",
      title: "Cortinas",
      keyword: "cortinas metálicas managua",
      keywordSource: "rank",
      score: 54,
      checkedAt: AT,
      ideas: [
        idea("title-keyword", "titulos", "alta", "Pon “cortinas metálicas managua” en el título de la página."),
        idea("questions", "preguntas", "media", "Responde las preguntas que hace la gente.", ["¿Cuánto cuesta una cortina metálica?", "¿Cuánto dura?"]),
        idea("images-alt", "tecnico", "media", "Describe tus fotos."),
        idea("title-length", "titulos", "baja", "Tu título es muy corto."),
      ],
    },
    { url: "https://fameseg.com/portones", title: "Portones", keyword: "portones", score: null, checkedAt: AT, skipped: true, ideas: [idea("length", "contenido", "alta", "Agrega texto.")] },
  ],
};

const decayData = {
  version: 1,
  siteUrl: "sc-domain:fameseg.com",
  fetchedAt: AT,
  range: { start: "2026-09-08", end: "2026-10-05" },
  previousRange: { start: "2026-08-11", end: "2026-09-07" },
  quarterRange: { start: "2026-06-09", end: "2026-07-06" },
  pagesChecked: 8,
  decaying: 2,
  pages: [
    {
      url: "https://fameseg.com/blog/cuanto-cuesta-una-cortina-metalica-en-nicaragua",
      compare: "previous",
      before: { clicks: 40, impressions: 900, ctr: 0.044, position: 5.2 },
      now: { clicks: 22, impressions: 860, ctr: 0.025, position: 8.9 },
      clicksLost: 18,
      reason: "position",
      lostQueries: [{ query: "precio cortina metalica", clicksBefore: 20, clicksNow: 9, impressionsBefore: 400, impressionsNow: 390, positionBefore: 4, positionNow: 8 }],
      also: null,
    },
    {
      url: "https://fameseg.com/promociones",
      compare: "previous",
      before: { clicks: 12, impressions: 300, ctr: 0.04, position: 6 },
      now: { clicks: 7, impressions: 150, ctr: 0.046, position: 6.1 },
      clicksLost: 5,
      reason: "demand",
      lostQueries: [],
      also: null,
    },
  ],
};

const gbpData = (extra: Record<string, unknown> = {}) => ({
  version: 1,
  cost: 0.02,
  createdAt: AT,
  profile: {
    title: "Fameseg",
    cid: "194604053573767737",
    category: "Proveedor de puertas",
    additionalCategories: ["Taller de soldadura"],
    description: "Cortinas metálicas y portones en Managua con instalación y mantenimiento. ".repeat(5),
    phone: "+505 2222 3333",
    url: "https://fameseg.com/",
    domain: "fameseg.com",
    rating: 4.1,
    reviews: 9,
    hasHours: false,
    hoursDays: 0,
    totalPhotos: 25,
    isClaimed: true,
    attributes: ["is_small_business", "has_onsite_services", "offers_online_appointments"],
    ...extra,
  },
  competitors: [
    { title: "CortyPort Industrial", cid: "1", category: "Proveedor de puertas", additionalCategories: [], rating: 4.8, reviews: 60, totalPhotos: 30, isClaimed: true, hasDescription: true, hasHours: true },
    { title: "Metalfa", cid: "2", category: "Proveedor de puertas", additionalCategories: [], rating: 4.6, reviews: 35, totalPhotos: 20, isClaimed: true, hasDescription: true, hasHours: true },
  ],
});

const review = (id: string, rating: number, daysAgo: number, answered: boolean) => ({
  id,
  name: "María López",
  rating,
  text: "Muy buen servicio",
  language: "es",
  timestamp: new Date(Date.parse(AT) - daysAgo * 86400000).toISOString(),
  ownerAnswer: answered ? "¡Gracias, María!" : "",
  ownerTimestamp: answered ? new Date(Date.parse(AT) - (daysAgo - 1) * 86400000).toISOString() : "",
});
const reviewsData = { version: 1, total: 9, rating: 4.1, cost: 0.0015, createdAt: AT, reviews: [review("a", 5, 3, true), review("b", 2, 10, false), review("c", 5, 20, false), review("d", 4, 40, true)] };

const questions: QuestionsData = {
  groups: [
    {
      keyword: "cortinas metálicas managua",
      related: [],
      questions: [
        { question: "¿Cuánto cuesta una cortina metálica en Nicaragua?", keywords: ["cortinas metálicas managua"], zones: [], from: ["google"], answered: null, topic: "precio de cortinas metálicas en Nicaragua" },
        { question: "¿Qué es una cortina metálica?", keywords: ["cortinas metálicas managua"], zones: [], from: ["google"], answered: { where: "site", label: "Cortinas", url: "https://fameseg.com/cortinas-metalicas" }, topic: "qué es una cortina metálica" },
        { question: "¿Cómo se engrasa una cortina metálica?", keywords: ["cortinas metálicas managua"], zones: [], from: ["google"], answered: null, topic: "engrasar cortina metálica" },
      ],
    },
  ],
  total: 3,
  unanswered: 2,
  answeredSite: 1,
  answeredArticle: 0,
  hidden: 0,
  rankHasQuestions: true,
  rankReports: 1,
  checkedAt: AT,
  siteTexts: 10,
  siteChecked: true,
};

// ---------- Reglas ----------

describe("revisión de la página web (audit)", () => {
  const list = auditTasks({ data: auditData(), createdAt: AT }, ctx);

  it("cada problema es una tarea: errores urgentes, avisos importantes, notas como mejora", () => {
    expect(keys(list)).toEqual(["audit:broken-links", "audit:missing-description", "audit:no-sitemap", "audit:no-structured-data", "audit:title-too-short"]);
    expect(list.map((t) => t.impact)).toEqual([3, 2, 2, 2, 1]);
    expect(list.every((t) => t.area === "web")).toBe(true);
  });

  it("dice cuántas páginas, da ejemplos y de dónde salió (con fecha de Miami)", () => {
    const desc = list.find((t) => t.key === "audit:missing-description")!;
    expect(desc.title.es).toBe("Sin descripción (3 páginas)");
    expect(desc.title.en).toBe("Missing description (3 pages)");
    expect(desc.detail!.es).toContain("Por ejemplo: «/», «/cortinas-metalicas» y «/portones».");
    expect(last(desc)).toBe(`Según la revisión de tu página web del ${fmtDate(AT, "es")}.`);
    expect(desc.detail!.en.split("\n\n").pop()).toBe(`Source: your website check, ${fmtDate(AT, "en")}.`);
    const broken = list.find((t) => t.key === "audit:broken-links")!;
    expect(broken.title.es).toBe("Enlaces rotos (2 enlaces)");
    expect(broken.detail!.es).toContain("/promo-2024 (en /)");
    // Lo de todo el sitio no cuenta páginas.
    expect(list.find((t) => t.key === "audit:no-sitemap")!.title.es).toBe("Sin mapa del sitio (sitemap)");
  });

  it("lleva a la revisión de la página, y lo de los datos para Google a la herramienta del código", () => {
    expect(list.find((t) => t.key === "audit:broken-links")!.href).toBe(`/b/${ID}/seo?tab=web#auditoria`);
    const schema = list.find((t) => t.key === "audit:no-structured-data")!;
    expect(schema.href).toBe(`/b/${ID}/seo?tab=local#codigo-google`);
    expect(schema.source).toBe("schema");
  });

  it("sin reporte o con un formato viejo no devuelve nada", () => {
    expect(auditTasks(null, ctx)).toEqual([]);
    expect(auditTasks({ data: { score: 50 }, createdAt: AT }, ctx)).toEqual([]);
  });
});

// Los problemas nuevos de la auditoría (versión 2: llms.txt, robots de IA, JSON-LD, WordPress viejo) entran solos al
// plan por su id, grupo y unidad. Estas pruebas corren cuando audit.ts ya los conoce.
const V2 = (ISSUE_IDS as readonly string[]).includes("llms-txt-missing");
describe.skipIf(!V2)("revisión profunda de la página (audit v2)", () => {
  const data = {
    ...auditData({
      issues: [
        { id: "llms-txt-missing", severity: "notice", pages: [], count: 1 },
        { id: "ai-search-bots-blocked", severity: "warning", pages: [], count: 1 },
        { id: "schema-invalid-json", severity: "error", pages: ["https://fameseg.com/"], count: 1 },
        { id: "wp-junk-urls", severity: "warning", pages: ["https://fameseg.com/author/admin/", "https://fameseg.com/category/sin-categoria/"], count: 2 },
      ],
    }),
    version: 2,
  };
  const list = auditTasks({ data, createdAt: AT }, ctx);
  it("lo de las IAs va al área IA, lo del JSON-LD a la herramienta del código, las direcciones viejas se cuentan", () => {
    const by = Object.fromEntries(list.map((t) => [t.key, t]));
    expect(by["audit:llms-txt-missing"].area).toBe("ia");
    expect(by["audit:ai-search-bots-blocked"].area).toBe("ia");
    expect(by["audit:schema-invalid-json"].href).toBe(`/b/${ID}/seo?tab=local#codigo-google`);
    expect(by["audit:schema-invalid-json"].impact).toBe(3);
    expect(by["audit:wp-junk-urls"].title.es).toContain("(2 direcciones)");
    expect(by["audit:llms-txt-missing"].title.es).not.toMatch(/\(\d/);
  });
});

describe("datos del negocio para Google (schema)", () => {
  it("sin LocalBusiness y sin el problema en la revisión → una tarea con la herramienta del código", () => {
    const list = schemaTasks({ data: auditData({ issues: [] }), createdAt: AT }, ctx);
    expect(keys(list)).toEqual(["schema:localbusiness"]);
    expect(list[0].href).toBe(`/b/${ID}/seo?tab=local#codigo-google`);
  });
  it("si la revisión ya lo dice, o la página ya lo tiene, no se repite", () => {
    expect(schemaTasks({ data: auditData(), createdAt: AT }, ctx)).toEqual([]);
    expect(schemaTasks({ data: auditData({ issues: [], localBusinessSchema: true }), createdAt: AT }, ctx)).toEqual([]);
  });
});

describe("revisión de tus páginas (onpage)", () => {
  const list = onpageTasks({ data: onpageData, createdAt: AT }, ctx);
  it("las 2 ideas más importantes de cada página revisada (las bajas y las no revisadas no)", () => {
    expect(keys(list)).toEqual(["onpage:fameseg.com/cortinas-metalicas:title-keyword", "onpage:fameseg.com/cortinas-metalicas:questions"]);
    expect(list[0].title.es).toBe("Pon «cortinas metálicas managua» en el título — /cortinas-metalicas");
    expect(list[0].impact).toBe(3);
    expect(list[0].area).toBe("web");
    expect(list[1].area).toBe("contenido");
    expect(list[1].detail!.es).toContain("¿Cuánto cuesta una cortina metálica?");
    expect(list[0].href).toBe(`/b/${ID}/seo?tab=web#paginas`);
  });
});

describe("páginas que pierden visitas (decay)", () => {
  const list = decayTasks({ data: decayData, createdAt: AT }, ctx);
  it("«Actualiza la página…» con los clics perdidos; la baja por temporada vale menos", () => {
    expect(keys(list)).toEqual(["decay:fameseg.com/blog/cuanto-cuesta-una-cortina-metalica-en-nicaragua", "decay:fameseg.com/promociones"]);
    expect(list[0].title.es).toContain("(−18 clics)");
    expect(list[0].impact).toBe(3);
    expect(list[0].detail!.es).toContain("estaba cerca del puesto 5 y ahora del 9");
    expect(list[1].impact).toBe(1);
    expect(list.every((t) => t.area === "contenido")).toBe(true);
  });
});

describe("páginas que compiten entre sí (cannibal)", () => {
  it("la búsqueda urgente que se reparten dos páginas → qué hacer", () => {
    const report = buildCannibal({ businessName: "Fameseg", website: "https://fameseg.com", zones: [], gsc: { pageQueries: cannibalPageQueries, range: cannibalRange }, ranks: [], audit: null });
    const list = cannibalTasks({ data: report, createdAt: AT }, ctx);
    expect(keys(list)).toContain("cannibal:cortinas metalicas");
    const t = list.find((x) => x.key === "cannibal:cortinas metalicas")!;
    expect(t.title.es).toBe("Dos páginas tuyas compiten por «cortinas metalicas»");
    expect(t.href).toBe(`/b/${ID}/seo?tab=web#canibalizacion`);
  });
});

describe("preguntas que nadie responde", () => {
  it("solo las que tu web no responde, con el escritor de artículos", () => {
    const list = questionTasks(questions, ctx);
    expect(keys(list)).toEqual(["question:cuanto cuesta una cortina metalica en nicaragua", "question:como se engrasa una cortina metalica"]);
    expect(list[0].href).toBe(`/b/${ID}/seo/escribir?kw=${encodeURIComponent("precio de cortinas metálicas en Nicaragua")}`);
    expect(questionTasks(null, ctx)).toEqual([]);
  });
});

describe("casi en la primera página (posiciones + búsquedas, datos reales de Fameseg)", () => {
  const list = rankTasks([saved(fameseg.reports.rank)], [saved(fameseg.reports.keywords)], ctx);
  it("los puestos 4 a 20 son «casi»; lo que se busca y no sale → crear página", () => {
    expect(keys(list).sort()).toEqual(["create:mantenimiento de cortinas metalicas", "near:cortinas tubulares managua", "near:portones tipo americano nicaragua"]);
    const near = list.find((t) => t.key === "near:portones tipo americano nicaragua")!;
    expect(near.title.es).toBe("Casi en la primera página: «portones tipo americano nicaragua» (puesto 15)");
    expect(near.area).toBe("google");
    expect(list.find((t) => t.key === "near:cortinas tubulares managua")!.title.es).toBe("Sube al top 3 con «cortinas tubulares managua» (estás 4°)");
    // Sale 3° en el mapa: crear la página ayuda, pero no es urgente.
    const create = list.find((t) => t.key === "create:mantenimiento de cortinas metalicas")!;
    expect(create.impact).toBe(1);
    expect(create.href).toContain("/seo/escribir?kw=");
    expect(last(create)).toBe(`Según tus posiciones en Google del ${fmtDate(fameseg.reports.rank.createdAt, "es")}.`);
  });
  it("lo que ya está en el top 3 no es tarea", () => {
    expect(keys(list).some((k) => k.includes("cortinas metalicas managua"))).toBe(false);
  });
});

describe("Search Console", () => {
  it("sin conectar → «Conecta Search Console» (solo si hay página web)", () => {
    const list = gscTasks({ connected: false, saved: null, now: new Date(AT) }, ctx);
    expect(keys(list)).toEqual(["setup:gsc"]);
    expect(list[0].href).toBe(`/b/${ID}/conexiones`);
    expect(gscTasks({ connected: false, saved: null, now: new Date(AT) }, { ...ctx, website: "" })).toEqual([]);
  });
  it("conectado: búsquedas reales casi en la primera página, sin marca ni temas ajenos", () => {
    const data = {
      ...gscSaved,
      version: 1,
      siteUrl: "sc-domain:fameseg.com",
      fetchedAt: AT,
      pages: [],
      devices: [],
      countries: [],
      opportunities: [
        { key: "portones electricos managua", clicks: 2, impressions: 320, ctr: 0.006, position: 11.2 },
        { key: "fameseg telefono", clicks: 1, impressions: 90, ctr: 0.01, position: 6 },
        { key: "dentista en managua", clicks: 0, impressions: 500, ctr: 0, position: 14 },
      ],
      lowCtr: [{ key: "cortinas metalicas precio", clicks: 1, impressions: 150, ctr: 0.006, position: 3.1 }],
    };
    const list = gscTasks({ connected: true, saved: { data, createdAt: AT }, now: new Date(AT) }, ctx);
    expect(keys(list)).toEqual(["near:portones electricos managua", "ctr:cortinas metalicas precio"]);
    expect(list[0].impact).toBe(3);
  });
});

describe("lo que tu competencia tiene y tú no (gap, datos reales de Fameseg)", () => {
  const list = gapTasks(saved(fameseg.reports.gap), ctx);
  it("solo búsquedas que tienen que ver con cortinas y portones (nada de gasolineras, dentistas ni moteles)", () => {
    expect(list.length).toBeGreaterThan(0);
    for (const t of list) expect(isRelevantKeyword(t.key.replace(/^(create|near):/, ""), ctx.vocab)).toBe(true);
    const all = keys(list).join(" ");
    for (const bad of ["gas cerca", "dentista", "motel", "eskimo", "concentrix", "sport bar"]) expect(all).not.toContain(bad);
    // «Estás más abajo» para nombres de la competencia (fesame, inmenicsa) tampoco entra.
    expect(all).not.toMatch(/fesame|inmenicsa/);
    expect(keys(list)).toContain("create:portones corredizos");
    const t = list.find((x) => x.key === "create:portones corredizos")!;
    expect(t.title.es).toBe("Crea una página o artículo para «portones corredizos»");
    expect(t.detail!.es).toContain("Unas 320 personas la buscan al mes en Nicaragua.");
    expect(t.href).toBe(`/b/${ID}/seo/escribir?kw=portones%20corredizos`);
  });
});

describe("enlaces", () => {
  it("directorios y asociaciones primero; sin redes sociales; el más útil es urgente", () => {
    const list = backlinksTasks({ data: backlinksSaved, createdAt: backlinksSaved.createdAt }, null, ctx);
    expect(keys(list)).toEqual([
      "link:paginasamarillas.com.ni",
      "link:camaradecomercio.org.ni",
      "link:mipyme.org.ni",
      "link:ferreteriasinsa.com",
      "link:laprensani.com",
      "link:constructores-nica.blogspot.com",
    ]);
    expect(list[0].title.es).toBe("Regístrate en paginasamarillas.com.ni");
    expect(list[0].effort).toBe(1);
    expect(list[1].impact).toBe(3); // asociación que enlaza a 2 competidores
    expect(list.every((t) => t.area === "enlaces" && t.href === `/b/${ID}/seo?tab=competencia#enlaces`)).toBe(true);
    expect(keys(list)).not.toContain("links:spam");
  });
  it("mucho spam → revisar con cuidado (desautorizar solo con una acción manual, nunca solo)", () => {
    const data = { ...backlinksSaved, summary: { ...backlinksSaved.summary, spamScore: 45 } };
    const spam = backlinksTasks({ data, createdAt: AT }, null, ctx).find((t) => t.key === "links:spam")!;
    expect(spam.impact).toBe(1);
    expect(spam.detail!.es).toContain("acción manual");
    expect(spam.detail!.es).toContain("nunca lo hace sola");
  });
  it("si ya hay borrador de contacto, lo dice", () => {
    const outreach = { data: { version: 1, drafts: { "paginasamarillas.com.ni": { domain: "paginasamarillas.com.ni", hint: "directory", type: "signup", lang: "es", steps: [], createdAt: AT } } }, createdAt: AT };
    const list = backlinksTasks({ data: backlinksSaved, createdAt: AT }, outreach, ctx);
    expect(list[0].detail!.es).toContain("Ya tienes los pasos");
  });
});

describe("Perfil de Google y reseñas", () => {
  const list = gbpTasks({ data: gbpData(), createdAt: AT }, { data: reviewsData, createdAt: AT }, ctx);
  it("horario, calificación y reseñas frente a la competencia, y las que faltan por contestar", () => {
    expect(keys(list)).toEqual(expect.arrayContaining(["gbp:hours", "gbp:rating", "gbp:reviewCount", "gbp:answered"]));
    expect(keys(list)).not.toContain("gbp:phone");
    expect(list.find((t) => t.key === "gbp:answered")!.title.es).toBe("Responde 2 reseñas");
    expect(list.find((t) => t.key === "gbp:hours")!.title.es).toBe("Agrega tu horario en Google");
    expect(list.find((t) => t.key === "gbp:rating")!.detail!.es).toContain("tus competidores tienen 4.7 ★");
    expect(list.every((t) => t.area === "maps")).toBe(true);
    expect(list.find((t) => t.key === "gbp:answered")!.source).toBe("reviews");
  });
  it("sin perfil pero con reseñas: al menos las que faltan por contestar", () => {
    expect(keys(gbpTasks(null, { data: reviewsData, createdAt: AT }, ctx))).toEqual(["gbp:answered"]);
    expect(gbpTasks(null, null, ctx)).toEqual([]);
  });
});

describe("mapa de calor", () => {
  it("cuenta el mapa más nuevo de cada búsqueda: en la mitad de los puntos ya está bien", () => {
    expect(mapTasks([{ data: mapNow, createdAt: mapNow.createdAt }, { data: mapBefore, createdAt: mapBefore.createdAt }], ctx)).toEqual([]);
  });
  it("en pocos puntos del top 3 → «Sube en Google Maps…»", () => {
    const list = mapTasks([{ data: mapBefore, createdAt: mapBefore.createdAt }], ctx);
    expect(keys(list)).toEqual(["map:cortinas metalicas"]);
    expect(list[0].detail!.es).toContain("Sales entre los 3 primeros en 1 de 4 puntos de tu zona y no sales en 1.");
    expect(list[0].href).toBe(`/b/${ID}/seo?tab=local#mapa`);
  });
});

describe("visibilidad en las IAs (datos reales de Fameseg)", () => {
  it("te recomiendan (80 %): solo los directorios que ellas citan donde conviene aparecer", () => {
    const list = aiTasks(saved(fameseg.reports.ai), ctx);
    expect(keys(list)).toEqual(["ai:source:starofservice.com.ni", "ai:source:es.cybo.com", "ai:source:findglocal.com"]);
    expect(list[0].title.es).toBe("Aparece en starofservice.com.ni");
    expect(list.every((t) => t.area === "ia")).toBe(true);
  });
  it("no te nombran → urgente; con menciones negativas → revisar", () => {
    const zero = { ...(fameseg.reports.ai.data as Record<string, unknown>), score: 0 };
    const list = aiTasks({ data: zero, createdAt: AT }, ctx);
    expect(list[0].key).toBe("ai:mentions");
    expect(list[0].impact).toBe(3);
    expect(list[0].detail!.es).toContain("«Inmenicsa»");
    expect(keys(aiTasks({ data: famesegAiWithTone(), createdAt: AT }, ctx))).toContain("ai:negative");
  });
});

describe("lo básico del negocio", () => {
  it("lo que falta lleva al diagnóstico guiado", () => {
    const list = setupTasks({ website: "", keywords: 0, zones: 1, study: false, now: new Date(AT) }, ctx);
    expect(keys(list)).toEqual(["setup:website", "setup:keywords", "setup:study"]);
    expect(list.every((t) => t.href === `/b/${ID}/diagnostico`)).toBe(true);
    expect(setupTasks({ website: "https://fameseg.com", keywords: 5, zones: 1, study: true, now: new Date(AT) }, ctx)).toEqual([]);
  });
});

describe("fuente y fecha", () => {
  it("la fecha es la de Miami (un reporte de las 2 a. m. UTC es del día anterior)", () => {
    expect(sourceLine("audit", "2026-10-06T02:00:00.000Z").es).toBe(`Según la revisión de tu página web del ${fmtDate("2026-10-05T12:00:00.000Z", "es")}.`);
  });
});

// ---------- Juntar y guardar ----------

const everything = () =>
  mergeDrafts(
    gscTasks({ connected: false, saved: null, now: new Date(AT) }, ctx),
    auditTasks({ data: auditData(), createdAt: AT }, ctx),
    onpageTasks({ data: onpageData, createdAt: AT }, ctx),
    rankTasks([saved(fameseg.reports.rank)], [saved(fameseg.reports.keywords)], ctx),
    gapTasks(saved(fameseg.reports.gap), ctx),
    backlinksTasks({ data: backlinksSaved, createdAt: AT }, null, ctx),
    gbpTasks({ data: gbpData(), createdAt: AT }, { data: reviewsData, createdAt: AT }, ctx),
    aiTasks(saved(fameseg.reports.ai), ctx),
  );

describe("claves estables", () => {
  it("dos corridas con los mismos reportes dan las mismas claves, sin repetir y sin fechas", () => {
    const a = keys(everything());
    const b = keys(everything());
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    for (const k of a) expect(k).not.toMatch(/20\d\d-\d\d/);
  });
  it("si dos reglas dan la misma clave, gana la primera", () => {
    const one = { key: "near:x", source: "keywords", area: "google", title: { es: "1", en: "1" }, impact: 2, effort: 2, href: "" } as const;
    const two = { ...one, title: { es: "2", en: "2" } };
    expect(mergeDrafts([one], [two]).map((t) => t.title.es)).toEqual(["1"]);
  });
});

describe("estados del plan", () => {
  const drafts = everything();
  const [d0, d1, d2] = drafts;

  it("lo nuevo entra como pendiente", () => {
    const ch = planChanges([], drafts);
    expect(ch.create.length).toBe(drafts.length);
    expect(ch.update).toEqual([]);
    expect(ch.open).toBe(drafts.length);
  });

  it("pendiente que ya no sale → gone; hecha queda hecha; descartada queda descartada", () => {
    const existing = [
      { id: "1", key: "audit:viejo", status: "todo" },
      { id: "2", key: "audit:hecho-antes", status: "done" },
      { id: "3", key: "audit:no-aplica-antes", status: "dismissed" },
    ];
    const ch = planChanges(existing, drafts);
    expect(ch.gone).toEqual(["1"]);
    expect(ch.update).toEqual([]);
  });

  it("lo que sigue saliendo conserva el estado que puso el dueño (y se refresca el texto)", () => {
    const existing = [
      { id: "a", key: d0.key, status: "done" },
      { id: "b", key: d1.key, status: "dismissed" },
      { id: "c", key: d2.key, status: "todo" },
      { id: "d", key: drafts[3].key, status: "gone" },
    ];
    const ch = planChanges(existing, drafts);
    const by = Object.fromEntries(ch.update.map((u) => [u.id, u.status]));
    expect(by).toEqual({ a: "done", b: "dismissed", c: "todo", d: "todo" });
    expect(ch.update.find((u) => u.id === "a")!.draft.title).toEqual(d0.title);
    expect(ch.create.map((d) => d.key)).not.toContain(d0.key);
    expect(ch.gone).toEqual([]);
    // Las hechas y descartadas no cuentan como abiertas.
    expect(ch.open).toBe(drafts.length - 2);
  });

  it("máximo de abiertas: se quedan fuera las de menor puntaje (y una pendiente que queda fuera pasa a gone)", () => {
    const sorted = [...drafts].sort((a, b) => taskScore(b) - taskScore(a));
    const lowest = sorted[sorted.length - 1];
    const ch = planChanges([{ id: "low", key: lowest.key, status: "todo" }], drafts, 5);
    expect(ch.open).toBe(5);
    expect(ch.create.length + ch.update.length).toBe(5);
    const minKept = Math.min(...[...ch.create, ...ch.update.map((u) => u.draft)].map(taskScore));
    const dropped = drafts.filter((d) => ![...ch.create.map((x) => x.key), ...ch.update.map((u) => u.draft.key)].includes(d.key));
    expect(Math.max(...dropped.map(taskScore))).toBeLessThanOrEqual(minKept);
    expect(ch.gone).toEqual(["low"]);
  });

  it("las hechas no ocupan lugar en el máximo", () => {
    const sorted = [...drafts].sort((a, b) => taskScore(b) - taskScore(a));
    const ch = planChanges([{ id: "top", key: sorted[0].key, status: "done" }], drafts, 3);
    expect(ch.open).toBe(3);
    expect(ch.update.find((u) => u.id === "top")!.status).toBe("done");
  });
});
