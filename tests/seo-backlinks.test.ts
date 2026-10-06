import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backlinksCostEstimate,
  dfsDate,
  isNoBacklinksAccess,
  linkHint,
  mergeGapDomains,
  NoBacklinksAccessError,
  parseBacklinksSummary,
  parseHistory,
  parseIntersection,
  parseReferringDomains,
  pickBacklinkCompetitors,
  readBacklinksLocked,
  readBacklinksReport,
  runBacklinksReport,
  withHistory,
} from "@/lib/seo/backlinks";
import { readCompetitorsReport } from "@/lib/seo/competitors";
import { dfsError } from "@/lib/seo/dataforseo";
import { errorText } from "@/lib/i18n";
import fameseg from "./fixtures/fameseg.json";

// ---------- Respuestas con la forma de la documentación (docs.dataforseo.com/v3/backlinks/...) ----------

// summary/live (ejemplo de la doc, recortado) para fameseg.com.
const summaryResult = (target: string, extra: Record<string, unknown> = {}) => ({
  target,
  first_seen: "2021-03-02 10:11:12 +00:00",
  lost_date: null,
  rank: 87,
  backlinks: 240,
  backlinks_spam_score: 8,
  crawled_pages: 30,
  info: { server: "cloudflare", cms: null, platform_type: ["unknown"], ip_address: "172.67.129.80", country: "NI", is_ip: false, target_spam_score: 0 },
  internal_links_count: 500,
  external_links_count: 40,
  broken_backlinks: 3,
  broken_pages: 2,
  referring_domains: 41,
  referring_domains_nofollow: 9,
  referring_main_domains: 38,
  referring_main_domains_nofollow: 8,
  referring_ips: 35,
  referring_subnets: 30,
  referring_pages: 200,
  referring_links_tld: { com: 150, ni: 90 },
  referring_links_types: { anchor: 230, image: 10 },
  referring_links_attributes: { nofollow: 60, noopener: 20 },
  referring_links_platform_types: { unknown: 120, cms: 80, news: 40 },
  referring_links_semantic_locations: { "": 140, article: 100 },
  referring_links_countries: { NI: 180, US: 60 },
  referring_pages_nofollow: 50,
  ...extra,
});

const historyItem = (date: string, rank: number, backlinks: number, domains: number, nb: number, lb: number, nd: number, ld: number) => ({
  type: "backlinks_history",
  date: `${date} 00:00:00 +00:00`,
  rank,
  backlinks,
  new_backlinks: nb,
  lost_backlinks: lb,
  new_referring_domains: nd,
  lost_referring_domains: ld,
  crawled_pages: 30,
  info: { server: null, cms: null, platform_type: null, ip_address: null, country: null, is_ip: false, target_spam_score: 0 },
  referring_domains: domains,
  referring_domains_nofollow: 2,
  referring_main_domains: domains,
  referring_ips: domains,
  referring_subnets: domains,
  referring_pages: backlinks,
  referring_links_attributes: null,
  referring_pages_nofollow: 1,
});
const historyResult = {
  target: "fameseg.com",
  date_from: "2026-06-01",
  date_to: "2026-10-06",
  items_count: 4,
  items: [
    // Desordenados a propósito: se ordenan por fecha.
    historyItem("2026-09-30", 87, 240, 41, 12, 4, 3, 1),
    historyItem("2026-06-30", 80, 200, 35, 5, 1, 1, 0),
    historyItem("2026-07-31", 82, 215, 37, 10, 2, 2, 1),
    historyItem("2026-08-31", 85, 230, 39, 8, 3, 2, 0),
  ],
};

const refItem = (domain: string, rank: number, backlinks: number, attrs: Record<string, number> | null, spam = 0) => ({
  type: "backlinks_referring_domain",
  domain,
  rank,
  backlinks,
  first_seen: "2023-05-10 08:00:00 +00:00",
  lost_date: null,
  backlinks_spam_score: spam,
  broken_backlinks: 0,
  broken_pages: 0,
  referring_domains: 1,
  referring_domains_nofollow: 0,
  referring_main_domains: 1,
  referring_main_domains_nofollow: 0,
  referring_ips: 1,
  referring_subnets: 1,
  referring_pages: backlinks,
  referring_links_tld: { ni: backlinks },
  referring_links_types: { anchor: backlinks },
  referring_links_attributes: attrs,
  referring_links_platform_types: { unknown: backlinks },
  referring_links_semantic_locations: { "": backlinks },
  referring_links_countries: null,
  referring_pages_nofollow: 0,
});
const referringResult = {
  target: "fameseg.com",
  total_count: 38,
  items_count: 3,
  items: [
    refItem("www.paginasamarillas.com.ni", 310, 4, null),
    refItem("facebook.com", 290, 10, { nofollow: 10, noopener: 10 }),
    refItem("cybo.com", 120, 2, { noopener: 2 }),
  ],
};

const block = (target: string, rank: number, backlinks: number, spam = 0, platforms: Record<string, number> = { unknown: backlinks }) => ({
  type: "backlinks_domain_intersection",
  target,
  rank,
  backlinks,
  first_seen: "2022-06-17 19:02:31 +00:00",
  lost_date: null,
  backlinks_spam_score: spam,
  broken_backlinks: 0,
  broken_pages: 0,
  referring_domains: 1,
  referring_domains_nofollow: 0,
  referring_main_domains: 1,
  referring_main_domains_nofollow: 0,
  referring_ips: 1,
  referring_subnets: 1,
  referring_pages: backlinks,
  referring_links_tld: { com: backlinks },
  referring_links_types: { anchor: backlinks },
  referring_links_attributes: null,
  referring_links_platform_types: platforms,
  referring_links_semantic_locations: { "": backlinks },
  referring_links_countries: null,
  referring_pages_nofollow: 0,
});
const intersectionResult = (competitor: string, rows: ReturnType<typeof block>[]) => ({
  targets: { "1": competitor },
  total_count: rows.length,
  items_count: rows.length,
  items: rows.map((b) => ({ domain_intersection: { "1": b }, summary: { intersections_count: 1 } })),
});

// ---------- Ayudantes ----------

describe("backlinksCostEstimate", () => {
  it("usa el precio por llamada y por fila de la página de precios", () => {
    // 9 llamadas × 0.024 + (1 + 5 + 50 + 3 × 51) filas × 0.000036 = 0.2235 → 0.224
    expect(backlinksCostEstimate(3)).toBe(0.224);
    // Sin competencia: 3 llamadas.
    expect(backlinksCostEstimate(0)).toBe(0.075);
    // Nunca más de 3 competidores.
    expect(backlinksCostEstimate(7)).toBe(backlinksCostEstimate(3));
  });
});

describe("dfsDate", () => {
  it("convierte el formato de DataForSEO", () => {
    expect(dfsDate("2020-01-18 11:50:58 +00:00")).toBe("2020-01-18T11:50:58.000Z");
    expect(dfsDate(null)).toBeNull();
    expect(dfsDate("no es fecha")).toBeNull();
  });
});

describe("isNoBacklinksAccess", () => {
  const docMessage = "Access denied. Visit Plans and Subscriptions to activate your subscription and get access to this API: https://app.dataforseo.com/backlinks-subscription";
  it("reconoce el 40204 en código, mensaje o error", () => {
    expect(isNoBacklinksAccess(40204)).toBe(true);
    expect(isNoBacklinksAccess(docMessage)).toBe(true);
    expect(isNoBacklinksAccess(dfsError(40204, docMessage))).toBe(true);
    expect(isNoBacklinksAccess(new NoBacklinksAccessError())).toBe(false); // ya es el error amable, no el de la API
  });
  it("no confunde otros errores", () => {
    expect(isNoBacklinksAccess(40200)).toBe(false);
    expect(isNoBacklinksAccess(dfsError(40200, "Payment Required."))).toBe(false);
    expect(isNoBacklinksAccess(new Error("timeout"))).toBe(false);
    expect(isNoBacklinksAccess(undefined)).toBe(false);
  });
  it("el error amable viene en los dos idiomas", () => {
    const e = new NoBacklinksAccessError();
    expect(errorText(e, "es")).toMatch(/Backlinks API/);
    expect(errorText(e, "en")).toMatch(/turned on/);
  });
});

describe("pickBacklinkCompetitors", () => {
  it("toma hasta 3 del reporte de Fameseg sin directorios", () => {
    const report = readCompetitorsReport(fameseg.reports.competitors.data);
    expect(pickBacklinkCompetitors(report, "fameseg.com")).toEqual(["arteytecnica.com", "cormetal.com.ni", "cortinasmetalicasurgentes.com"]);
  });
  it("respeta los que agregó el dueño y quita tu propio sitio", () => {
    const report = {
      competitors: [
        { domain: "fameseg.com", source: "labs" },
        { domain: "yelp.com", source: "labs" },
        { domain: "encuentra24.com", source: "owner" },
        { domain: "cormetal.com.ni", source: "serp" },
      ],
    } as unknown as Parameters<typeof pickBacklinkCompetitors>[0];
    expect(pickBacklinkCompetitors(report, "fameseg.com")).toEqual(["encuentra24.com", "cormetal.com.ni"]);
    expect(pickBacklinkCompetitors(null, "fameseg.com")).toEqual([]);
  });
});

describe("linkHint", () => {
  it.each([
    ["paginasamarillas.com.ni", "directory"],
    ["es.cybo.com", "directory"],
    ["directorioempresas.com", "directory"],
    ["facebook.com", "social"],
    ["m.youtube.com", "social"],
    ["laprensani.com", "news"],
    ["elnuevodiario.com.ni", "news"],
    ["noticiasmanagua.com", "news"],
    ["minsa.gob.ni", "public"],
    ["unan.edu.ni", "public"],
    ["amcham.org.ni", "association"],
    ["camaradecomercio.org", "association"],
    ["reddit.com", "forum"],
    ["miblog.blogspot.com", "blog"],
    ["blog.ejemplo.com", "blog"],
    ["ferreteriarichardson.com.ni", "supplier"],
    ["acerosdenicaragua.com", "supplier"],
    ["ejemplo.org", "association"],
    ["ejemplo.com", "other"],
  ])("%s → %s", (domain, hint) => {
    expect(linkHint(domain)).toBe(hint);
  });
  it("usa el tipo de sitio de DataForSEO cuando el nombre no dice nada", () => {
    expect(linkHint("ejemplo.com", ["news"])).toBe("news");
    expect(linkHint("ejemplo.com", ["organization"])).toBe("association");
    expect(linkHint("ejemplo.com", ["message-boards"])).toBe("forum");
    expect(linkHint("ejemplo.com", ["cms", "blogs"])).toBe("blog");
  });
});

// ---------- Lectura de respuestas ----------

describe("parseBacklinksSummary", () => {
  it("lee el resumen de la doc", () => {
    const s = parseBacklinksSummary([summaryResult("fameseg.com")]);
    expect(s).toMatchObject({
      domain: "fameseg.com",
      rank: 87,
      backlinks: 240,
      referringDomains: 41,
      referringMainDomains: 38,
      referringIps: 35,
      referringSubnets: 30,
      nofollowLinks: 60,
      nofollowDomains: 9,
      brokenBacklinks: 3,
      brokenPages: 2,
      spamScore: 8,
      firstSeen: "2021-03-02T10:11:12.000Z",
    });
    expect(s.dofollowShare).toBeCloseTo(0.75);
  });
  it("sin atributos todos los enlaces pasan fuerza; sin datos queda en null", () => {
    expect(parseBacklinksSummary([summaryResult("x.com", { referring_links_attributes: null })]).dofollowShare).toBe(1);
    const empty = parseBacklinksSummary([], "fameseg.com");
    expect(empty.domain).toBe("fameseg.com");
    expect(empty.rank).toBeNull();
    expect(empty.dofollowShare).toBeNull();
  });
});

describe("parseHistory + withHistory", () => {
  it("ordena por mes y suma el último mes y los últimos 3", () => {
    const points = parseHistory([historyResult]);
    expect(points.map((p) => p.date.slice(0, 7))).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    const s = withHistory(parseBacklinksSummary([summaryResult("fameseg.com")]), points);
    expect(s).toMatchObject({ newBacklinks1m: 12, lostBacklinks1m: 4, newDomains1m: 3, lostDomains1m: 1, newBacklinks3m: 30, lostBacklinks3m: 9, newDomains3m: 7, lostDomains3m: 2 });
    expect(s.trend).toHaveLength(4);
    expect(s.trend[3]).toMatchObject({ rank: 87, backlinks: 240, referringDomains: 41 });
  });
  it("sin historia deja el resumen igual", () => {
    const base = parseBacklinksSummary([summaryResult("fameseg.com")]);
    expect(withHistory(base, parseHistory([{ items: null }]))).toBe(base);
  });
});

describe("parseReferringDomains", () => {
  it("lee dominio, fuerza, enlaces, fecha y si pasa fuerza", () => {
    const r = parseReferringDomains([referringResult]);
    expect(r.total).toBe(38);
    expect(r.items).toEqual([
      { domain: "paginasamarillas.com.ni", rank: 310, backlinks: 4, firstSeen: "2023-05-10T08:00:00.000Z", dofollow: true, spamScore: 0 },
      { domain: "facebook.com", rank: 290, backlinks: 10, firstSeen: "2023-05-10T08:00:00.000Z", dofollow: false, spamScore: 0 },
      { domain: "cybo.com", rank: 120, backlinks: 2, firstSeen: "2023-05-10T08:00:00.000Z", dofollow: true, spamScore: 0 },
    ]);
    expect(parseReferringDomains([]).items).toEqual([]);
  });
});

describe("parseIntersection", () => {
  it("lee el ejemplo de la doc con dos sitios (moz.com y ahrefs.com)", () => {
    const result = {
      targets: { "1": "moz.com", "2": "ahrefs.com" },
      total_count: 40921,
      items_count: 2,
      items: [
        { domain_intersection: { "1": block("www.xroxy.com", 113, 547189), "2": block("www.xroxy.com", 0, 87) }, summary: { intersections_count: 2 } },
        { domain_intersection: { "1": block("sharkzmarketing.com", 0, 374292), "2": null }, summary: { intersections_count: 1 } },
      ],
    };
    const rows = parseIntersection([result], { "1": "moz.com", "2": "ahrefs.com" });
    expect(rows).toEqual([
      { domain: "xroxy.com", rank: 113, backlinks: 547276, spamScore: 0, platforms: [], linksTo: ["moz.com", "ahrefs.com"] },
      { domain: "sharkzmarketing.com", rank: 0, backlinks: 374292, spamScore: 0, platforms: [], linksTo: ["moz.com"] },
    ]);
  });
  it("guarda el tipo de sitio para la pista", () => {
    const rows = parseIntersection([intersectionResult("cormetal.com.ni", [block("laprensani.com", 400, 2, 0, { news: 2 })])], { "1": "cormetal.com.ni" });
    expect(rows[0]).toMatchObject({ domain: "laprensani.com", platforms: ["news"], linksTo: ["cormetal.com.ni"] });
  });
});

describe("mergeGapDomains", () => {
  it("junta, quita tu sitio, a la competencia y el spam, y ordena por competidores y fuerza", () => {
    const a = parseIntersection(
      [
        intersectionResult("arteytecnica.com", [
          block("paginasamarillas.com.ni", 310, 3),
          block("laprensani.com", 450, 1, 0, { news: 1 }),
          block("spammy-links.xyz", 500, 900, 85),
          block("cormetal.com.ni", 90, 1),
          block("fameseg.com", 10, 1),
        ]),
      ],
      { "1": "arteytecnica.com" },
    );
    const b = parseIntersection([intersectionResult("cormetal.com.ni", [block("paginasamarillas.com.ni", 320, 2), block("amcham.org.ni", 200, 1)])], { "1": "cormetal.com.ni" });
    const { gap, spamHidden } = mergeGapDomains([a, b], "fameseg.com", ["arteytecnica.com", "cormetal.com.ni"]);
    expect(spamHidden).toBe(1);
    expect(gap.map((g) => g.domain)).toEqual(["paginasamarillas.com.ni", "laprensani.com", "amcham.org.ni"]);
    expect(gap[0]).toMatchObject({ rank: 320, backlinks: 5, linksTo: ["arteytecnica.com", "cormetal.com.ni"], hint: "directory" });
    expect(gap[1].hint).toBe("news");
    expect(gap[2].hint).toBe("association");
  });
});

// ---------- Reporte guardado ----------

describe("readBacklinksReport", () => {
  const good = {
    domain: "fameseg.com",
    summary: { ...withHistory(parseBacklinksSummary([summaryResult("fameseg.com")]), parseHistory([historyResult])) },
    referring: parseReferringDomains([referringResult]).items,
    referringTotal: 38,
    competitors: [{ domain: "cormetal.com.ni", rank: 120, backlinks: 500, referringDomains: 60, dofollowShare: 0.8, ok: true }],
    gap: [{ domain: "paginasamarillas.com.ni", rank: 320, linksTo: ["cormetal.com.ni"], backlinks: 2, spamScore: 0, hint: "directory" }],
    gapSpamHidden: 1,
    notes: [{ es: "nota", en: "note" }],
    cost: 0.2,
    createdAt: "2026-10-06T08:00:00.000Z",
  };
  it("lee un reporte bueno igual que se guardó", () => {
    expect(readBacklinksReport(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });
  it("aguanta datos malos", () => {
    expect(readBacklinksReport(null)).toBeNull();
    expect(readBacklinksReport("x")).toBeNull();
    expect(readBacklinksReport({ domain: "fameseg.com" })).toBeNull();
    expect(readBacklinksReport({ locked: true, at: "2026-10-06" })).toBeNull();
    const r = readBacklinksReport({
      domain: "https://www.Fameseg.com/",
      summary: { rank: "87", backlinks: 5, dofollowShare: 3, trend: "nope" },
      referring: [{ domain: "" }, { domain: "cybo.com", rank: 1, dofollow: "yes" }, 7],
      competitors: "nope",
      gap: [{ domain: "laprensani.com", hint: "weird", linksTo: ["a.com", 3] }],
      notes: [{ es: "solo es" }],
    });
    expect(r).not.toBeNull();
    expect(r?.domain).toBe("fameseg.com");
    expect(r?.summary.rank).toBeNull();
    expect(r?.summary.dofollowShare).toBe(1);
    expect(r?.summary.trend).toEqual([]);
    expect(r?.referring).toEqual([{ domain: "cybo.com", rank: 1, backlinks: null, firstSeen: null, dofollow: null, spamScore: null }]);
    expect(r?.competitors).toEqual([]);
    expect(r?.gap[0]).toMatchObject({ hint: "news", linksTo: ["a.com"] });
    expect(r?.notes).toEqual([]);
    expect(r?.cost).toBe(0);
  });
  it("reconoce la marca de sin acceso", () => {
    expect(readBacklinksLocked({ locked: true, at: "2026-10-06T00:00:00Z" })).toEqual({ at: "2026-10-06T00:00:00Z" });
    expect(readBacklinksLocked(good)).toBeNull();
  });
});

// ---------- La corrida completa, con DataForSEO simulado ----------

describe("runBacklinksReport", () => {
  const envelope = (result: unknown[], cost = 0.024, task: { status_code?: number; status_message?: string } = {}) => ({
    version: "0.1.20230825",
    status_code: 20000,
    status_message: "Ok.",
    cost,
    tasks_count: 1,
    tasks_error: task.status_code && task.status_code !== 20000 ? 1 : 0,
    tasks: [{ id: "t1", status_code: task.status_code ?? 20000, status_message: task.status_message ?? "Ok.", cost, result_count: result.length, result }],
  });
  let calls: { path: string; body: Record<string, unknown> }[] = [];
  const stub = (respond: (path: string, body: Record<string, unknown>) => unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        const path = url.replace("https://api.dataforseo.com/v3", "");
        const body = (JSON.parse(init.body) as Record<string, unknown>[])[0];
        calls.push({ path, body });
        return new Response(JSON.stringify(respond(path, body)), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );

  beforeEach(() => {
    calls = [];
    vi.stubEnv("DATAFORSEO_LOGIN", "login");
    vi.stubEnv("DATAFORSEO_PASSWORD", "password");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sin acceso a Backlinks API se detiene en la primera llamada (40204 en la tarea)", async () => {
    stub(() => envelope([], 0, { status_code: 40204, status_message: "Access denied. Visit Plans and Subscriptions to activate your subscription and get access to this API: https://app.dataforseo.com/backlinks-subscription" }));
    await expect(runBacklinksReport({ website: "https://fameseg.com", competitors: ["cormetal.com.ni"] })).rejects.toBeInstanceOf(NoBacklinksAccessError);
    expect(calls).toHaveLength(1);
  });

  it("también si el 40204 viene en la respuesta general", async () => {
    stub(() => ({ status_code: 40204, status_message: "Access denied. Visit Plans and Subscriptions to activate your subscription.", tasks: [] }));
    await expect(runBacklinksReport({ website: "fameseg.com", competitors: [] })).rejects.toBeInstanceOf(NoBacklinksAccessError);
    expect(calls).toHaveLength(1);
  });

  it("hace 3 + 2 llamadas por competidor y arma el reporte", async () => {
    stub((path, body) => {
      if (path === "/backlinks/summary/live") return envelope([summaryResult(String(body.target), body.target === "fameseg.com" ? {} : { rank: 150, referring_domains: 90, backlinks: 900 })]);
      if (path === "/backlinks/history/live") return envelope([historyResult]);
      if (path === "/backlinks/referring_domains/live") return envelope([referringResult], 0.0258);
      if (path === "/backlinks/domain_intersection/live") {
        const c = (body.targets as Record<string, string>)["1"];
        return envelope([intersectionResult(c, c === "arteytecnica.com" ? [block("laprensani.com", 450, 1, 0, { news: 1 }), block("cybo.com", 100, 1)] : [block("cybo.com", 110, 2)])], 0.0258);
      }
      return { status_code: 40400, status_message: "Not Found.", tasks: [] };
    });
    const report = await runBacklinksReport({ website: "https://www.fameseg.com", competitors: ["arteytecnica.com", "cormetal.com.ni", "fameseg.com"], now: new Date("2026-10-06T12:00:00Z") });
    expect(calls).toHaveLength(7);
    const history = calls.find((c) => c.path === "/backlinks/history/live");
    expect(history?.body).toMatchObject({ target: "fameseg.com", date_from: "2026-06-01" });
    const gapCall = calls.find((c) => c.path === "/backlinks/domain_intersection/live");
    expect(gapCall?.body).toMatchObject({ exclude_targets: ["fameseg.com"], limit: 50, order_by: ["1.rank,desc"] });
    expect(calls.find((c) => c.path === "/backlinks/referring_domains/live")?.body).toMatchObject({ limit: 50, order_by: ["rank,desc"] });

    expect(report.domain).toBe("fameseg.com");
    expect(report.summary).toMatchObject({ rank: 87, referringDomains: 41, newDomains1m: 3 });
    expect(report.referring).toHaveLength(3);
    expect(report.referringTotal).toBe(38);
    expect(report.competitors.map((c) => [c.domain, c.rank, c.referringDomains])).toEqual([
      ["arteytecnica.com", 150, 90],
      ["cormetal.com.ni", 150, 90],
    ]);
    expect(report.gap.map((g) => [g.domain, g.linksTo.length, g.hint])).toEqual([
      ["cybo.com", 2, "directory"],
      ["laprensani.com", 1, "news"],
    ]);
    expect(report.notes).toEqual([]);
    expect(report.cost).toBeCloseTo(0.024 * 3 + 0.024 + 0.0258 + 0.0258 * 2, 4);
    expect(readBacklinksReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
  });

  it("si falla una parte sigue con lo demás y lo anota", async () => {
    stub((path) => {
      if (path === "/backlinks/summary/live") return envelope([summaryResult("fameseg.com")]);
      if (path === "/backlinks/history/live") return envelope([], 0, { status_code: 40501, status_message: "Invalid Field." });
      return envelope([{ total_count: 0, items: [] }]);
    });
    const report = await runBacklinksReport({ website: "fameseg.com", competitors: [] });
    expect(calls).toHaveLength(3);
    expect(report.notes).toHaveLength(1);
    expect(report.summary.newDomains1m).toBeNull();
    expect(report.competitors).toEqual([]);
    expect(report.gap).toEqual([]);
  });
});
