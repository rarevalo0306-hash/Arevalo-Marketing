import { describe, expect, it } from "vitest";
import { type AuditReport, type Issue, scoreFor } from "@/lib/seo/audit";
import type { GapDomain } from "@/lib/seo/backlinks";
import type { CannibalIssue, CannibalPage, CannibalReport } from "@/lib/seo/cannibal";
import type { DecayPage, DecayReport } from "@/lib/seo/decay";
import type { GapRow } from "@/lib/seo/gap";
import type { OnPagePage, OnPageReport } from "@/lib/seo/onpage";
import {
  absUrl,
  auditPrompt,
  backlinksChecklist,
  cannibalPrompt,
  contextLines,
  decayPrompt,
  directoriesChecklist,
  gapPrompt,
  gbpChecklist,
  generalPrompt,
  listingDomains,
  onPagePrompt,
  pagesByKeyword,
  type PromptContext,
  variantKey,
  questionsPrompt,
  rankPrompt,
  renderPrompt,
  schemaPrompt,
} from "@/lib/seo/prompts";
import type { QuestionGroup } from "@/lib/seo/questions";
import type { RankRow } from "@/lib/seo/rank";
import { auditDeductions, scoreLevel } from "@/lib/seo/verdict";

const ctx: PromptContext = {
  name: "Fameseg",
  website: "fameseg.com",
  area: "Managua, Masaya (Nicaragua)",
  sells: ["Cortinas de acero", "Portones tipo americano"],
  about: "",
  repo: "",
  branch: "",
};
const END_ES = "No inventes datos";
const END_EN = "Do not invent facts; keep prices, claims";

const lastLine = (s: string) => s.trim().split("\n").pop() ?? "";

function audit(over: Partial<AuditReport> = {}): AuditReport {
  const issues: Issue[] = [
    { id: "missing-title", severity: "error", count: 2, pages: ["https://fameseg.com/a", "https://fameseg.com/b"] },
    { id: "broken-links", severity: "error", count: 1, pages: ["https://fameseg.com/rota"] },
    { id: "no-sitemap", severity: "warning", count: 1, pages: ["https://fameseg.com/"] },
    { id: "images-no-alt", severity: "warning", count: 12, pages: Array.from({ length: 10 }, (_, i) => `https://fameseg.com/p${i}`) },
  ];
  return {
    version: 1,
    website: "https://fameseg.com",
    startedAt: "",
    finishedAt: "",
    pages: Array.from({ length: 20 }, (_, i) => ({ url: `https://fameseg.com/p${i}` }) as AuditReport["pages"][number]),
    site: {
      home: "https://fameseg.com/",
      robots: true,
      sitemap: false,
      sitemapUrls: 0,
      https: true,
      httpRedirects: true,
      localBusinessSchema: true,
      brokenLinks: [{ url: "https://fameseg.com/rota", status: 404, from: ["/contacto"] }],
      checkedLinks: 30,
      stoppedEarly: false,
    },
    pagespeed: { error: "x" },
    issues,
    score: 70,
    ...over,
  };
}

describe("prompt-core", () => {
  it("absUrl completa rutas con el dominio del negocio", () => {
    expect(absUrl("/contacto", "fameseg.com")).toBe("https://fameseg.com/contacto");
    expect(absUrl("https://otro.com/x", "fameseg.com")).toBe("https://otro.com/x");
    expect(absUrl("/x", "")).toBe("/x");
  });

  it("el contexto solo dice lo que se sabe (sin repositorio inventado)", () => {
    const lines = contextLines(ctx, "en").join("\n");
    expect(lines).toContain("Fameseg");
    expect(lines).toContain("https://fameseg.com");
    expect(lines).toContain("Cortinas de acero");
    expect(lines).not.toMatch(/GitHub|Next\.js/);
    const withRepo = contextLines({ ...ctx, repo: "owner/site", branch: "main" }, "en").join("\n");
    expect(withRepo).toContain('GitHub repository "owner/site" (branch "main")');
  });

  it("usa lo que escribió el dueño cuando no hay servicios", () => {
    const lines = contextLines({ ...ctx, sells: [], about: "Ajustadores públicos en Miami." }, "es").join("\n");
    expect(lines).toContain("Ajustadores públicos en Miami.");
  });

  it("sin cambios no hay texto", () => {
    expect(renderPrompt({ ctx, lang: "es", task: "x", sections: [{ title: "y", items: [] }] })).toBe("");
  });

  it("siempre termina con la regla de no inventar, en el idioma de la app", () => {
    expect(lastLine(auditPrompt(ctx, audit(), "en"))).toContain(END_EN);
    expect(lastLine(auditPrompt(ctx, audit(), "es"))).toContain(END_ES);
  });
});

describe("auditPrompt", () => {
  it("lista cada problema con su gravedad, cómo arreglarlo y las direcciones completas", () => {
    const p = auditPrompt(ctx, audit(), "en");
    expect(p).toMatch(/^Hi\. You are the AI that manages the website of Fameseg/);
    expect(p).toContain("score: 70 out of 100");
    expect(p).toContain("[Error] Pages without a title (2 pages)");
    expect(p).toContain("- https://fameseg.com/a");
    expect(p).toContain("<title>");
    // Enlaces rotos: la dirección rota y dónde está, en dirección completa.
    expect(p).toContain("Broken: https://fameseg.com/rota (returns 404) · found on: https://fameseg.com/contacto");
    // Más páginas de las que se listan.
    expect(p).toContain("…and 2 more");
    // Errores antes que advertencias.
    expect(p.indexOf("[Error]")).toBeLessThan(p.indexOf("[Warning]"));
  });

  it("en español", () => {
    const p = auditPrompt(ctx, audit(), "es");
    expect(p).toContain("[Error] Páginas sin título (2 páginas)");
    expect(p).toContain("## Reglas");
  });
});

describe("verdict", () => {
  it("escala: 90 excelente, 70 bien, 50 regular, menos urgente", () => {
    expect(scoreLevel(94)).toBe("excellent");
    expect(scoreLevel(90)).toBe("excellent");
    expect(scoreLevel(89)).toBe("good");
    expect(scoreLevel(70)).toBe("good");
    expect(scoreLevel(69)).toBe("fair");
    expect(scoreLevel(50)).toBe("fair");
    expect(scoreLevel(49)).toBe("urgent");
  });

  it("lo que resta cada problema suma lo mismo que scoreFor", () => {
    const a = audit();
    const total = auditDeductions(a.issues, a.pages.length).reduce((s, d) => s + d.points, 0);
    expect(Math.max(0, Math.round(100 - total))).toBe(scoreFor(a.issues, a.pages.length));
    // El sitemap es de todo el sitio: resta el peso completo de una advertencia.
    expect(auditDeductions(a.issues, a.pages.length).find((d) => d.id === "no-sitemap")?.points).toBe(4);
  });
});

describe("onPagePrompt", () => {
  const page = (over: Partial<OnPagePage>): OnPagePage => ({
    url: "https://fameseg.com/cortinas",
    title: "Cortinas",
    keyword: "cortinas metálicas managua",
    keywordSource: "rank",
    score: 55,
    ideas: [{ id: "title-keyword", category: "titulos", priority: "alta", es: "Pon la búsqueda en el título.", en: "Put the search in the title.", impact: 10 }],
    stats: { words: 200, targetWords: 800, title: "Cortinas", h1: "", meta: "", h2: [], images: 0, imagesNoAlt: 0, linksOut: 0, linksIn: 0, external: 0, schema: [], canonical: "", loadSeconds: null, loadSource: null, position: null },
    winners: [],
    brief: null,
    linksTo: [],
    checkedAt: "",
    ...over,
  });
  const report: OnPageReport = {
    version: 1,
    zone: { code: 1, name: "Nicaragua" },
    language: "es",
    pages: [page({}), page({ url: "https://fameseg.com/ok", score: 95, ideas: [] }), page({ url: "https://fameseg.com/x", needsRecheck: true })],
    overrides: {},
    cost: 0,
    createdAt: "",
    stoppedEarly: false,
  };

  it("por página: la búsqueda, lo que hay hoy, qué cambiar y la dirección", () => {
    const p = onPagePrompt(ctx, report, "en");
    expect(p).toContain('Main search for this page: "cortinas metálicas managua"');
    expect(p).toContain("Put the search in the title.");
    expect(p).toContain('Current H1: "(none)"');
    expect(p).toContain("Length: 200 words; the pages winning on Google have about 800.");
    expect(p).toContain("- https://fameseg.com/cortinas");
    // Las que ya están bien o falta volver a revisar no se piden.
    expect(p).not.toContain("https://fameseg.com/ok");
    expect(p).not.toContain("https://fameseg.com/x");
  });

  it("usa la sugerencia de la IA si existe", () => {
    const withSuggestion: OnPageReport = {
      ...report,
      pages: [page({ suggestion: { title: "Cortinas metálicas en Managua | Fameseg", metaDescription: "desc", h1: "Cortinas metálicas", h2s: ["Tipos"], provider: "x", createdAt: "" } })],
    };
    const p = onPagePrompt(ctx, withSuggestion, "es");
    expect(p).toContain("Cambia el <title> por: «Cortinas metálicas en Managua | Fameseg»");
    expect(p).toContain("«Tipos»");
  });
});

describe("decayPrompt", () => {
  const dp = (over: Partial<DecayPage>): DecayPage => ({
    url: "https://fameseg.com/blog/precios",
    compare: "previous",
    before: { clicks: 40, impressions: 900, ctr: 0.04, position: 4 },
    now: { clicks: 10, impressions: 800, ctr: 0.012, position: 9 },
    clicksLost: 30,
    reason: "position",
    lostQueries: [{ query: "precio cortinas", clicksBefore: 20, clicksNow: 2, impressionsBefore: 300, impressionsNow: 200, positionBefore: 3, positionNow: 10 }],
    also: null,
    ...over,
  });
  const report = { version: 1, siteUrl: "", fetchedAt: "", range: { start: "", end: "" }, previousRange: { start: "", end: "" }, quarterRange: { start: "", end: "" }, pagesChecked: 5, decaying: 2, pages: [dp({}), dp({ url: "https://fameseg.com/temporada", reason: "demand" })] } as DecayReport;

  it("pide actualizar las que bajaron y deja fuera las de temporada", () => {
    const p = decayPrompt(ctx, report, "en");
    expect(p).toContain("https://fameseg.com/blog/precios");
    expect(p).toContain('"precio cortinas"');
    expect(p).toContain("Clicks from Google: 40 → 10.");
    expect(p).not.toContain("temporada");
  });

  it("si solo hay bajas de temporada no hay nada que pedir", () => {
    expect(decayPrompt(ctx, { ...report, pages: [dp({ reason: "demand" })] }, "es")).toBe("");
  });
});

describe("cannibalPrompt", () => {
  const cp = (url: string, main: boolean): CannibalPage => ({ url, title: null, clicks: 1, impressions: 10, position: 5, share: 0.5, seen: null, zones: [], main });
  const issue = (fix: CannibalIssue["fix"]): CannibalIssue => ({
    query: "cortinas metálicas",
    source: "gsc",
    severity: "alta",
    totalImpressions: 20,
    totalClicks: 2,
    checks: null,
    pages: [cp("https://fameseg.com/cortinas", true), cp("https://fameseg.com/blog/cortinas", false)],
    fix,
    anchor: "cortinas metálicas en Managua",
    places: [],
  });
  const report = (fix: CannibalIssue["fix"]): CannibalReport => ({ version: 1, issues: [issue(fix)], source: "gsc", gscRange: null, createdAt: "" });

  it("unir: 301 de la otra a la principal, con direcciones completas", () => {
    const p = cannibalPrompt(ctx, report("merge"), "en");
    expect(p).toContain("301 redirect from https://fameseg.com/blog/cortinas to https://fameseg.com/cortinas");
    expect(p).toContain("[Urgent]");
  });

  it("enlazar: con el texto sugerido", () => {
    const p = cannibalPrompt(ctx, report("link"), "es");
    expect(p).toContain("agrega un enlace a https://fameseg.com/cortinas con el texto «cortinas metálicas en Managua»");
  });
});

describe("questionsPrompt", () => {
  const groups: QuestionGroup[] = [
    {
      keyword: "cortinas metálicas managua",
      related: [],
      questions: [
        { question: "¿Cuánto cuesta una cortina metálica?", keywords: ["cortinas metálicas managua"], zones: [], from: ["google"], answered: null, topic: "x" },
        { question: "¿Qué es una cortina?", keywords: [], zones: [], from: ["google"], answered: { where: "site", label: "x", url: "https://fameseg.com" }, topic: "y" },
      ],
    },
    { keyword: "portones", related: [], questions: [{ question: "¿Cuánto dura un portón?", keywords: [], zones: [], from: ["google"], answered: null, topic: "z" }] },
  ];

  it("dice en qué página contestar y solo las que faltan", () => {
    const pageFor = pagesByKeyword([{ rows: [{ keyword: "Cortinas metálicas Managua", url: "/cortinas" } as RankRow] }]);
    const p = questionsPrompt(ctx, groups, pageFor, "es");
    expect(p).toContain("«¿Cuánto cuesta una cortina metálica?»");
    expect(p).not.toContain("¿Qué es una cortina?");
    expect(p).toContain("- https://fameseg.com/cortinas");
    // Sin página para esa búsqueda: crear una.
    expect(p).toContain("No hay una página para «portones»");
    expect(p).toContain("[POR CONFIRMAR]");
  });

  it("pagesByKeyword: la elegida por el dueño gana a la de las posiciones", () => {
    const map = pagesByKeyword([{ rows: [{ keyword: "a", url: "https://x.com/rank" } as RankRow] }], [{ keyword: "A", url: "https://x.com/owner" }]);
    expect(map.a).toBe("https://x.com/owner");
  });
});

describe("gapPrompt y rankPrompt", () => {
  const row = (over: Partial<GapRow>): GapRow => ({ keyword: "portones automáticos", volume: 320, cpc: 1, difficulty: 12, intent: "commercial", yourPosition: null, competitors: [{ domain: "rival.com", position: 3 }], type: "missing", opportunity: 80, ...over });

  it("crear páginas para lo que falta, la mejor oportunidad primero", () => {
    const p = gapPrompt(ctx, [row({ keyword: "baja", opportunity: 10 }), row({})], "en");
    expect(p).toContain('Create a page or article for "portones automáticos"');
    expect(p).toContain("320 searches a month · difficulty 12/100 · rival.com ranks #3");
    expect(p.indexOf("portones automáticos")).toBeLessThan(p.indexOf('"baja"'));
  });

  it("junta las variantes de la misma búsqueda en una sola página", () => {
    expect(variantKey("Portón corredizo")).toBe(variantKey("portones corredizos"));
    const p = gapPrompt(ctx, [row({ keyword: "portones corredizos", opportunity: 90 }), row({ keyword: "porton corredizo", opportunity: 70 }), row({ keyword: "portón corredizo", opportunity: 60 })], "es");
    expect(p.match(/Crear una página o artículo/g)?.length).toBe(1);
    expect(p).toContain("También la buscan como «porton corredizo», «portón corredizo»");
  });

  it("rank: crea páginas donde no sales y mejora las que salen lejos", () => {
    const rows = [
      { keyword: "cortinas", position: null, url: null, localPack: null, top: [], features: [] },
      { keyword: "portones", position: 16, url: "https://fameseg.com/portones", localPack: null, top: [{ position: 16, url: "https://fameseg.com/portones", domain: "fameseg.com", title: "Portones" }], features: [] },
      { keyword: "motores", position: 1, url: "https://fameseg.com/motores", localPack: null, top: [], features: [] },
    ] as unknown as RankRow[];
    const p = rankPrompt(ctx, { rows }, "en");
    expect(p).toContain('Create a page dedicated to "cortinas"');
    expect(p).toContain('Improve the page for "portones"');
    expect(p).toContain("- https://fameseg.com/portones");
    expect(p).not.toContain("motores");
  });
});

describe("listas para el dueño", () => {
  it("backlinks: casillas con el sitio y cómo conseguir el enlace (los fáciles primero)", () => {
    const gap: GapDomain[] = [
      { domain: "noticias.com.ni", rank: 300, linksTo: ["rival.com"], backlinks: 3, spamScore: 1, hint: "news" },
      { domain: "paginasamarillas.com.ni", rank: 200, linksTo: ["rival.com"], backlinks: 3, spamScore: 1, hint: "directory" },
    ];
    const c = backlinksChecklist(ctx, gap, "es");
    expect(c).toContain("[ ] paginasamarillas.com.ni");
    expect(c.indexOf("paginasamarillas")).toBeLessThan(c.indexOf("noticias.com.ni"));
    expect(c).toContain("https://fameseg.com");
    expect(c).not.toContain("## Reglas");
  });

  it("directorios: salen de los primeros resultados de tus búsquedas", () => {
    const rows = [
      { keyword: "a", top: [{ domain: "paginasamarillas.com.ni" }, { domain: "rival.com" }, { domain: "m.facebook.com" }] },
      { keyword: "b", top: [{ domain: "paginasamarillas.com.ni" }, { domain: "es.wikipedia.org" }] },
    ] as unknown as RankRow[];
    const list = listingDomains([{ rows }], ["yelp.com"]);
    expect(list[0]).toBe("paginasamarillas.com.ni");
    expect(list).toContain("m.facebook.com");
    expect(list).toContain("yelp.com");
    expect(list).not.toContain("rival.com");
    expect(list).not.toContain("es.wikipedia.org");
    expect(directoriesChecklist(ctx, list, "en")).toContain("[ ] paginasamarillas.com.ni");
  });

  it("perfil de Google: lo importante primero y las reseñas sin contestar", () => {
    const c = gbpChecklist(
      ctx,
      [
        { es: "Agrega fotos", en: "Add photos", priority: "low" },
        { es: "Reclama tu perfil", en: "Claim your profile", priority: "high" },
      ],
      4,
      "en",
    );
    expect(c.indexOf("Claim your profile")).toBeLessThan(c.indexOf("Add photos"));
    expect(c).toContain("Reply to your 4 unanswered reviews");
    expect(gbpChecklist(ctx, [], 0, "es")).toBe("");
  });
});

describe("schemaPrompt y generalPrompt", () => {
  it("el código va adentro, antes de las reglas, para la página de inicio", () => {
    const code = '<script type="application/ld+json">{"@type":"LocalBusiness"}</script>';
    const p = schemaPrompt(ctx, code, "en", "missing");
    expect(p).toContain("inside the <head> of the home page (https://fameseg.com)");
    expect(p).toContain(code);
    expect(p.indexOf(code)).toBeLessThan(p.indexOf("## Rules"));
    expect(lastLine(p)).toContain(END_EN);
    expect(schemaPrompt(ctx, code, "es", "present")).toContain("agrégale solo los datos que le falten");
    expect(schemaPrompt(ctx, code, "es", "present")).not.toContain("tal cual");
  });

  it("general: junta lo más importante de cada sección, numerado, con el resumen", () => {
    const p = generalPrompt(
      ctx,
      {
        audit: audit(),
        gap: [{ keyword: "portones", volume: 10, cpc: null, difficulty: 5, intent: null, yourPosition: null, competitors: [], type: "missing", opportunity: 50 }],
        status: ["Sales 3° en «cortinas»."],
      },
      "es",
    );
    expect(p).toContain("## Cómo va hoy (resumen)");
    expect(p).toContain("- Sales 3° en «cortinas».");
    expect(p).toContain("## 1. Problemas técnicos de la página (auditoría: 70/100)");
    expect(p).toContain("## 2. Páginas nuevas para ganarle a la competencia");
    expect(lastLine(p)).toContain(END_ES);
    expect(generalPrompt(ctx, {}, "es")).toBe("");
  });
});
