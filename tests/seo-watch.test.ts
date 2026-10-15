import { beforeEach, describe, expect, it, vi } from "vitest";

const dfs = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/seo/dataforseo", async (orig) => ({ ...(await orig<typeof import("@/lib/seo/dataforseo")>()), dfsPost: dfs.post }));
vi.mock("@/lib/seo/competitors", async (orig) => ({
  ...(await orig<typeof import("@/lib/seo/competitors")>()),
  resolveLocation: vi.fn(async () => ({ countryCode: 2840, countryName: "United States", language: "es" })),
}));

import {
  changeText,
  parsePages,
  readWatchConfig,
  readWatchReport,
  runWatch,
  type WatchSnapshot,
  watchChanges,
  watchCostEstimate,
  watchDomains,
  watchEmail,
  watchIsDue,
} from "@/lib/seo/watch";

const snap = (over: Partial<WatchSnapshot> = {}): WatchSnapshot => ({
  domain: "rival.com",
  traffic: 1000,
  keywordsCount: 300,
  paidKeywords: 10,
  keywords: [
    { keyword: "techos miami", position: 3, volume: 900 },
    { keyword: "goteras", position: 8, volume: 400 },
  ],
  pages: ["/", "/techos"],
  adsRunning: 0,
  adsNew: 0,
  ok: true,
  ...over,
});

describe("Qué hizo tu competencia (puros)", () => {
  it("lee las páginas sin dominio, sin «?» y sin «/» final, una sola vez", () => {
    expect(parsePages([{ items: [{ page_address: "https://rival.com/techos/?utm=x" }, { page_address: "rival.com/" }, { page_address: "/techos" }, { page_address: "" }, { page_address: "https://rival.com" }] }])).toEqual([
      "/techos",
      "rival.com",
      "/",
    ]);
    expect(parsePages([])).toEqual([]);
  });

  it("encuentra búsquedas nuevas, páginas nuevas, visitas, anuncios y búsquedas pagadas", () => {
    const prev = snap();
    const cur = snap({
      traffic: 1500,
      paidKeywords: 30,
      keywords: [...prev.keywords, { keyword: "techos metálicos", position: 6, volume: 200 }, { keyword: "lejana", position: 40, volume: 50 }],
      pages: ["/", "/techos", "/oferta-verano"],
      adsRunning: 5,
      adsNew: 2,
    });
    expect(watchChanges(cur, prev)).toEqual([
      { kind: "new-keywords", keywords: [{ keyword: "techos metálicos", position: 6, volume: 200 }] },
      { kind: "new-pages", pages: ["/oferta-verano"] },
      { kind: "traffic", from: 1000, to: 1500, pct: 50 },
      { kind: "ads", running: 5, started: 2 },
      { kind: "paid", from: 10, to: 30 },
    ]);
  });

  it("no inventa cambios: primera vez, datos que faltaron o cambios chicos", () => {
    expect(watchChanges(snap(), null)).toEqual([]);
    expect(watchChanges(snap(), snap({ ok: false }))).toEqual([]);
    // La lista anterior vino vacía (no se pudo leer): no todo es «nuevo».
    expect(watchChanges(snap(), snap({ keywords: [], pages: [] }))).toEqual([]);
    // 10 % de visitas y 2 búsquedas pagadas más no cuentan.
    expect(watchChanges(snap({ traffic: 1100, paidKeywords: 12 }), snap())).toEqual([]);
    // Con muy pocas visitas, un salto no cuenta.
    expect(watchChanges(snap({ traffic: 40 }), snap({ traffic: 20 }))).toEqual([]);
  });

  it("dice los cambios en palabras simples (español e inglés)", () => {
    expect(changeText({ kind: "new-keywords", keywords: [{ keyword: "goteras", position: 4, volume: 10 }] }, "es")).toBe("Empezó a salir en 1 búsqueda nueva: «goteras» (#4).");
    expect(changeText({ kind: "traffic", from: 2000, to: 1000, pct: -50 }, "es")).toBe("Sus visitas de Google bajaron 50 % (de 2000 a 1000 al mes).");
    expect(changeText({ kind: "traffic", from: 1000, to: 2500, pct: 150 }, "en")).toBe("Its Google visits went up 150% (from 1,000 to 2,500 a month).");
    expect(changeText({ kind: "ads", running: 3, started: 1 }, "es")).toBe("Lanzó 1 anuncio nuevo en Google esta semana (3 activos).");
    expect(changeText({ kind: "paid", from: 30, to: 10 }, "en")).toBe("Pays for ads on fewer searches: from 30 to 10.");
    expect(changeText({ kind: "new-pages", pages: ["/a", "/b"] }, "en")).toBe("Has 2 new pages getting visits: /a, /b.");
  });

  it("toca cada semana (con unas horas de margen)", () => {
    const now = Date.parse("2026-10-14T12:00:00Z");
    expect(watchIsDue(0, now)).toBe(true);
    expect(watchIsDue(now - 6 * 86_400_000, now)).toBe(false);
    expect(watchIsDue(now - 7 * 86_400_000 + 3 * 3600_000, now)).toBe(true);
  });

  it("elige a quién vigilar: lo que escribió el dueño o su competencia (sin su página ni directorios)", () => {
    const config = readWatchConfig({ enabled: true, domains: ["https://www.Rival.com/x", "otro.com", "", 5], updatedAt: "2026-10-01" });
    expect(config).toEqual({ enabled: true, domains: ["rival.com", "otro.com"], updatedAt: "2026-10-01" });
    expect(watchDomains(config, ["nada.com"], "mipagina.com")).toEqual(["rival.com", "otro.com"]);
    expect(watchDomains({ enabled: false, domains: [], updatedAt: "" }, ["mipagina.com", "yelp.com", "a.com", "www.a.com", "b.com", "c.com", "d.com"], "https://mipagina.com")).toEqual(["a.com", "b.com", "c.com"]);
    expect(readWatchConfig(null)).toEqual({ enabled: false, domains: [], updatedAt: "" });
    expect(readWatchConfig({ enabled: "true", domains: ["a.com", "b.com", "c.com", "d.com"] }).domains).toHaveLength(3);
  });

  it("lee una revisión guardada sin confiar en su forma", () => {
    const r = readWatchReport({
      country: "United States",
      competitors: [{ ...snap(), changes: [{ kind: "ads", running: 1, started: 1 }, { kind: "hack" }], first: false, pages: ["/ok", "javascript:x"] }, { domain: "" }],
      auto: true,
      notes: [{ es: "a", en: "b" }, { es: 1 }],
      cost: 0.12,
      createdAt: "2026-10-14T00:00:00.000Z",
    });
    expect(r?.competitors).toHaveLength(1);
    expect(r?.competitors[0].changes).toEqual([{ kind: "ads", running: 1, started: 1 }]);
    expect(r?.competitors[0].pages).toEqual(["/ok"]);
    expect(r?.notes).toEqual([{ es: "a", en: "b" }]);
    expect(readWatchReport({ competitors: "x" })).toBeNull();
  });

  it("calcula lo que cuesta por semana", () => {
    expect(watchCostEstimate(1)).toBeGreaterThan(0.04);
    expect(watchCostEstimate(1)).toBeLessThan(0.06);
    expect(watchCostEstimate(3)).toBeCloseTo(watchCostEstimate(1) * 3, 2);
    expect(watchCostEstimate(10)).toBe(watchCostEstimate(3));
  });

  it("arma el email con un bloque por competidor que cambió y cómo apagarlo", () => {
    const render = vi.fn((_b, _lang, title: string, blocks: unknown[], opts?: { anchor?: string; offText?: string }) => ({ html: `<h1>${title}</h1>`, text: JSON.stringify({ blocks, opts }) }));
    const report = {
      country: "US",
      competitors: [
        { ...snap(), changes: [{ kind: "ads" as const, running: 2, started: 2 }], first: false },
        { ...snap({ domain: "quieto.com" }), changes: [], first: false },
      ],
      auto: true,
      notes: [],
      cost: 0.1,
      createdAt: "2026-10-14T00:00:00.000Z",
    };
    const email = watchEmail({ id: "b1", name: "Techos Sol", color: "#000" }, report, "es", render);
    expect(email.subject).toBe("Lo que hizo tu competencia esta semana · Techos Sol");
    const [, , , blocks, opts] = render.mock.calls[0];
    expect(blocks).toEqual([
      { kind: "p", text: "Revisamos a tu competencia en Google. Esto es lo nuevo:" },
      { kind: "h", text: "rival.com" },
      { kind: "list", items: [{ text: "Lanzó 2 anuncios nuevos en Google esta semana (2 activos)." }] },
    ]);
    expect(opts?.anchor).toBe("?tab=competencia#vigilancia");
    expect(opts?.offText).toContain("Revisar cada semana");
  });
});

describe("Qué hizo tu competencia (revisión)", () => {
  beforeEach(() => {
    dfs.post.mockReset();
  });

  const answer = (path: string, body: Record<string, unknown>) => {
    if (body.target === "caido.com") throw new Error("boom");
    if (path.includes("domain_rank_overview")) return { cost: 0.0101, result: [{ items: [{ metrics: { organic: { etv: 1500, count: 320 }, paid: { count: 12 } } }] }] };
    if (path.includes("ranked_keywords"))
      return {
        cost: 0.0172,
        result: [
          {
            items: [
              { keyword_data: { keyword: "techos miami", keyword_info: { search_volume: 900 } }, ranked_serp_element: { serp_item: { rank_group: 3, url: "https://rival.com/" } } },
              { keyword_data: { keyword: "techos metálicos", keyword_info: { search_volume: 200 } }, ranked_serp_element: { serp_item: { rank_group: 6, url: "https://rival.com/m" } } },
            ],
          },
        ],
      };
    if (path.includes("relevant_pages")) return { cost: 0.0156, result: [{ items: [{ page_address: "https://rival.com/" }, { page_address: "https://rival.com/techos" }] }] };
    return {
      cost: 0.002,
      result: [
        {
          items_count: 2,
          items: [
            { type: "ads_search", first_shown: "2026-10-12 10:00:00 +00:00", last_shown: "2026-10-13 10:00:00 +00:00", url: "https://adstransparency.google.com/a", preview_image: { url: "https://x.com/a.png" } },
            { type: "ads_search", first_shown: "2026-08-01 10:00:00 +00:00", last_shown: "2026-10-13 10:00:00 +00:00", url: "https://adstransparency.google.com/b" },
          ],
        },
      ],
    };
  };

  it("revisa cada competidor, compara con la anterior y suma el costo", async () => {
    dfs.post.mockImplementation(async (path: string, body: Record<string, unknown>) => answer(path, body));
    const previous = readWatchReport({ country: "US", competitors: [{ ...snap(), changes: [], first: true }], auto: true, notes: [], cost: 0, createdAt: "2026-10-07T00:00:00.000Z" });
    const r = await runWatch({ domains: ["rival.com", "caido.com"], zone: { code: 1015116, name: "Miami,Florida,United States" }, language: "es", previous, auto: true, now: new Date("2026-10-14T12:00:00Z") });
    expect(dfs.post).toHaveBeenCalledTimes(8);
    const [rival, caido] = r.competitors;
    expect(rival).toMatchObject({ domain: "rival.com", traffic: 1500, keywordsCount: 320, paidKeywords: 12, pages: ["/", "/techos"], adsRunning: 2, adsNew: 1, ok: true, first: false });
    expect(rival.changes.map((c) => c.kind)).toEqual(["new-keywords", "traffic", "ads"]);
    expect(caido).toMatchObject({ domain: "caido.com", ok: false, first: true, changes: [] });
    expect(r.notes).toEqual([{ es: "No se pudo revisar caido.com esta vez.", en: "Couldn't check caido.com this time." }]);
    expect(r.cost).toBe(0.0449);
    expect(r.country).toBe("United States");
  });

  it("sin competidores o si ninguno se pudo revisar, avisa con un error claro", async () => {
    await expect(runWatch({ domains: [], zone: { code: 1, name: "x" }, language: "es", previous: null, auto: false })).rejects.toThrow(/competencia/);
    dfs.post.mockRejectedValue(new Error("down"));
    await expect(runWatch({ domains: ["a.com"], zone: { code: 1, name: "x" }, language: "es", previous: null, auto: false })).rejects.toThrow(/DataForSEO/);
  });
});
