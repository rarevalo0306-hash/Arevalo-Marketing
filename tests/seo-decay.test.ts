import { describe, expect, it } from "vitest";
import { translator } from "@/lib/i18n";
import {
  buildDecay,
  classify,
  compareDecay,
  DECAY_LIMIT,
  decayActions,
  decayRanges,
  type DecayPeriod,
  isDecaying,
  isEligible,
  lostQueries,
  mergePages,
  pageKey,
  type PageStat,
  readDecayReport,
  reasonLabel,
  reasonWhy,
  shortPath,
} from "@/lib/seo/decay";
import type { GscPageQuery, GscRow } from "@/lib/seo/gsc";

const es = translator("es");
const en = translator("en");
const SITE = "https://fameseg.com";

const page = (path: string, clicks: number, impressions: number, position: number): GscRow => ({
  key: path.startsWith("http") ? path : `${SITE}${path}`,
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
});
const pq = (path: string, query: string, clicks: number, impressions: number, position: number): GscPageQuery => ({
  page: path.startsWith("http") ? path : `${SITE}${path}`,
  query,
  clicks,
  impressions,
  position,
});
const st = (clicks: number, impressions: number, position: number): PageStat => ({ clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });

const MANAGUA = "/cobertura/managua";
const PRECIOS = "/blog/cuanto-cuesta-una-cortina-metalica-en-nicaragua";
const CORTINAS = "/servicios/cortinas-metalicas";
const PORTONES = "/servicios/portones-automaticos";
const PROMO = "/promociones";
const MANT = "/servicios/mantenimiento-de-cortinas-metalicas";
const ENGRASAR = "/blog/engrasar-cortina-metalica";

// Los 28 días anteriores (Search Console de Fameseg, recortado y ajustado para cubrir cada motivo).
const previous: DecayPeriod = {
  pages: [
    page("/", 120, 2400, 3.1),
    page(MANAGUA, 36, 860, 4.1),
    // La misma página con www y barra final (Google a veces las separa): se suma.
    page(`https://www.fameseg.com${MANAGUA}/`, 4, 40, 4.0),
    page(PRECIOS, 30, 1500, 5.0),
    page(CORTINAS, 25, 600, 3.2),
    page(PORTONES, 20, 400, 6.0),
    page(PROMO, 12, 250, 7.5),
    page(MANT, 22, 480, 5.5),
    page(ENGRASAR, 6, 150, 9.0), // muy chica: no cuenta
    page("/contacto", 15, 300, 2.5),
  ],
  pairs: [
    pq(MANAGUA, "cortinas metalicas managua", 25, 500, 3.5),
    pq(MANAGUA, "cortinas metálicas en managua", 8, 160, 4.4),
    pq(MANAGUA, "cortinas enrollables managua", 3, 90, 6.0),
    pq(MANAGUA, "fameseg managua", 4, 20, 1.0),
    pq(PRECIOS, "precio cortina metalica nicaragua", 18, 900, 4.8),
    pq(PRECIOS, "cuanto cuesta una cortina metalica", 12, 600, 5.3),
    pq(CORTINAS, "cortinas metálicas", 20, 450, 3.0),
    pq(PORTONES, "portones automáticos nicaragua", 12, 220, 5.5),
    pq(PORTONES, "portones tipo americano nicaragua", 8, 180, 6.6),
    pq(PROMO, "cortinas metalicas oferta", 12, 250, 7.5),
  ],
};

// Los últimos 28 días.
const now: DecayPeriod = {
  pages: [
    page("/", 118, 2450, 3.0), // estable
    page(MANAGUA, 18, 820, 7.3), // bajó de posición (4,1 → 7,3) con impresiones estables
    page(PRECIOS, 15, 700, 5.3), // menos gente lo busca: la mitad de impresiones, misma posición
    page(CORTINAS, 10, 650, 3.4), // te ven igual pero el CTR cayó de 4,2 % a 1,5 %
    page(PORTONES, 15, 320, 6.8), // perdió búsquedas clave
    // /promociones ya no aparece
    page(MANT, 20, 470, 5.6), // vs. el mes anterior casi igual; vs. hace 3 meses bajó
    page(ENGRASAR, 0, 40, 12),
    page("/contacto", 25, 380, 2.2), // subió
  ],
  pairs: [
    pq(MANAGUA, "cortinas metalicas managua", 10, 480, 7.0),
    pq(MANAGUA, "cortinas metálicas en managua", 5, 150, 7.9),
    pq(MANAGUA, "fameseg managua", 3, 18, 1.0),
    pq(PRECIOS, "precio cortina metalica nicaragua", 9, 420, 5.2),
    pq(PRECIOS, "cuanto cuesta una cortina metalica", 6, 280, 5.4),
    pq(CORTINAS, "cortinas metálicas", 8, 500, 3.2),
    pq(PORTONES, "portones automáticos nicaragua", 12, 230, 5.4),
    pq(PORTONES, "portones tipo americano nicaragua", 3, 90, 8.4),
  ],
};

// Los mismos 28 días de hace 3 meses.
const quarter: DecayPeriod = {
  pages: [
    page("/", 110, 2300, 3.3),
    page(MANAGUA, 30, 700, 4.5),
    page(PRECIOS, 20, 1000, 5.1),
    page(CORTINAS, 12, 500, 3.8),
    page(PORTONES, 14, 300, 6.1),
    page(MANT, 35, 520, 5.2),
    page("/contacto", 14, 290, 2.6),
  ],
  pairs: [pq(MANT, "mantenimiento de cortinas metálicas", 20, 260, 4.8), pq(MANT, "mantenimiento cortinas metalicas", 15, 260, 5.6)],
};

const meta = {
  siteUrl: "sc-domain:fameseg.com",
  fetchedAt: "2026-10-06T08:00:00.000Z",
  ...decayRanges(new Date("2026-10-06T12:00:00Z")),
};

describe("decayRanges", () => {
  it("usa los 28 días con 3 de retraso, los 28 anteriores y los mismos días de hace 13 semanas", () => {
    const r = decayRanges(new Date("2026-10-06T12:00:00Z"));
    expect(r.range).toEqual({ start: "2026-09-06", end: "2026-10-03" });
    expect(r.previousRange).toEqual({ start: "2026-08-09", end: "2026-09-05" });
    expect(r.quarterRange).toEqual({ start: "2026-06-07", end: "2026-07-04" });
    // Mismo día de la semana que el periodo actual.
    expect(new Date(`${r.quarterRange.start}T00:00:00Z`).getUTCDay()).toBe(new Date(`${r.range.start}T00:00:00Z`).getUTCDay());
  });
});

describe("pageKey / mergePages / shortPath", () => {
  it("trata como la misma página https/http, www, barra final, utm y #sección", () => {
    const k = pageKey(`${SITE}${MANAGUA}`);
    expect(pageKey(`http://www.fameseg.com${MANAGUA}/`)).toBe(k);
    expect(pageKey(`${SITE}${MANAGUA}?utm_source=facebook#precios`)).toBe(k);
    expect(pageKey(`${SITE}${MANAGUA}?zona=norte`)).not.toBe(k);
    expect(pageKey(`${SITE}/`)).toBe(pageKey("https://www.fameseg.com"));
  });

  it("suma clics e impresiones y promedia la posición por impresiones", () => {
    const m = mergePages(previous.pages);
    const managua = m.get(pageKey(`${SITE}${MANAGUA}`))!;
    expect(managua.clicks).toBe(40);
    expect(managua.impressions).toBe(900);
    expect(managua.position).toBeCloseTo((4.1 * 860 + 4.0 * 40) / 900, 5);
    expect(managua.ctr).toBeCloseTo(40 / 900, 5);
    // Se queda con la dirección que más clics traía.
    expect(managua.url).toBe(`${SITE}${MANAGUA}`);
  });

  it("muestra la ruta corta y decodificada", () => {
    expect(shortPath(`${SITE}/blog/cortinas-met%C3%A1licas?x=1`)).toBe("/blog/cortinas-metálicas?x=1");
    expect(shortPath(SITE)).toBe("/");
    expect(shortPath("no es url")).toBe("no es url");
  });
});

describe("umbrales", () => {
  it("solo revisa páginas con ≥ 10 clics o ≥ 200 impresiones antes", () => {
    expect(isEligible(st(10, 50, 5))).toBe(true);
    expect(isEligible(st(2, 200, 9))).toBe(true);
    expect(isEligible(st(9, 199, 5))).toBe(false);
  });

  it("cuenta como baja ≥ 3 clics y ≥ 20 %, o muchas menos impresiones si casi no tenía clics", () => {
    expect(isDecaying(st(10, 300, 5), st(7, 300, 5))).toBe(true); // −3 (30 %)
    expect(isDecaying(st(10, 300, 5), st(8, 300, 5))).toBe(false); // −2
    expect(isDecaying(st(40, 900, 4), st(37, 900, 4))).toBe(false); // −3 pero solo 7,5 %
    expect(isDecaying(st(9, 199, 5), st(0, 0, 0))).toBe(false); // muy chica
    expect(isDecaying(st(2, 400, 12), st(1, 250, 13))).toBe(true); // −150 impresiones (37 %)
    expect(isDecaying(st(2, 400, 12), st(3, 250, 13))).toBe(false); // ganó clics
    expect(isDecaying(st(2, 400, 12), st(2, 330, 12))).toBe(false); // −70 impresiones
  });
});

describe("classify", () => {
  it("bajó de posición cuando empeora ≥ 2 lugares", () => {
    expect(classify(st(40, 900, 4.1), st(18, 820, 7.3))).toBe("position");
    // Aunque también la vean menos (al bajar de lugar pasa).
    expect(classify(st(40, 900, 4.1), st(10, 300, 11))).toBe("position");
    expect(classify(st(40, 900, 4.1), st(30, 880, 5.9))).not.toBe("position");
  });
  it("menos gente lo busca cuando las impresiones caen y la posición está igual", () => {
    expect(classify(st(30, 1500, 5.0), st(15, 700, 5.3))).toBe("demand");
  });
  it("te ven pero no hacen clic cuando las impresiones se mantienen y el CTR cae", () => {
    expect(classify(st(25, 600, 3.2), st(10, 650, 3.4))).toBe("ctr");
  });
  it("si no, perdió búsquedas clave (también cuando ya no aparece)", () => {
    expect(classify(st(20, 400, 6.0), st(15, 320, 6.8))).toBe("queries");
    expect(classify(st(12, 250, 7.5), st(0, 0, 0))).toBe("queries");
  });
});

describe("lostQueries", () => {
  it("da las 3 búsquedas que más clics perdieron, con su posición antes y ahora", () => {
    const { pages } = compareDecay(now, previous, "previous");
    const lq = pages.get(pageKey(`${SITE}${MANAGUA}`))!.lostQueries;
    // Empate en clics perdidos (3 y 3): primero la que perdió más impresiones.
    expect(lq.map((q) => q.query)).toEqual(["cortinas metalicas managua", "cortinas enrollables managua", "cortinas metálicas en managua"]);
    expect(lq[0]).toMatchObject({ clicksBefore: 25, clicksNow: 10, positionBefore: 3.5, positionNow: 7 });
    // La que desapareció: 0 ahora y sin posición.
    expect(lq[1]).toMatchObject({ clicksBefore: 3, clicksNow: 0, impressionsNow: 0, positionNow: 0 });
  });

  it("si ninguna perdió clics, usa las que más impresiones perdieron", () => {
    const before = new Map([["cortinas tubulares managua", { clicks: 0, impressions: 120, posWeight: 120 * 9 }]]);
    const after = new Map([["cortinas tubulares managua", { clicks: 0, impressions: 30, posWeight: 30 * 14 }]]);
    expect(lostQueries(before, after)[0]).toMatchObject({ query: "cortinas tubulares managua", impressionsBefore: 120, impressionsNow: 30, positionNow: 14 });
    expect(lostQueries(undefined, after)).toEqual([]);
  });
});

describe("buildDecay", () => {
  const report = buildDecay({ now, previous, quarter }, meta);
  const byPath = (p: string) => report.pages.find((x) => shortPath(x.url) === p);

  it("encuentra cada motivo y deja fuera las páginas chicas, estables y que suben", () => {
    expect(byPath(MANAGUA)?.reason).toBe("position");
    expect(byPath(PRECIOS)?.reason).toBe("demand");
    expect(byPath(CORTINAS)?.reason).toBe("ctr");
    expect(byPath(PORTONES)?.reason).toBe("queries");
    expect(byPath(PROMO)).toMatchObject({ reason: "queries", now: { clicks: 0, impressions: 0 } });
    expect(byPath(ENGRASAR)).toBeUndefined();
    expect(byPath("/")).toBeUndefined();
    expect(byPath("/contacto")).toBeUndefined();
  });

  it("ordena de la que más clics perdió a la que menos", () => {
    const lost = report.pages.map((p) => p.clicksLost);
    expect(lost).toEqual([...lost].sort((a, b) => b - a));
    expect(shortPath(report.pages[0].url)).toBe(MANAGUA);
    expect(report.pages[0].clicksLost).toBe(22);
  });

  it("une las dos comparaciones: usa la que perdió más y avisa de la otra", () => {
    const m = byPath(MANAGUA)!;
    expect(m.compare).toBe("previous");
    expect(m.also).toEqual({ compare: "quarter", clicksBefore: 30, clicksNow: 18 });
    // Mantenimiento: casi igual que el mes pasado, pero bajó contra hace 3 meses.
    const mant = byPath(MANT)!;
    expect(mant).toMatchObject({ compare: "quarter", clicksLost: 15, also: null });
    expect(mant.lostQueries[0].query).toBe("mantenimiento de cortinas metálicas");
  });

  it("cuenta las páginas revisadas y las que bajan", () => {
    // "/", managua, precios, cortinas, portones, promociones, mantenimiento, contacto (engrasar es muy chica).
    expect(report.pagesChecked).toBe(8);
    expect(report.decaying).toBe(6);
    expect(report.range).toEqual({ start: "2026-09-06", end: "2026-10-03" });
  });

  it("se queda con las 15 que más perdieron", () => {
    const many = Array.from({ length: 20 }, (_, i) => i);
    const big = buildDecay(
      {
        previous: { pages: many.map((i) => page(`/blog/articulo-${i}`, 30 + i, 600, 5)), pairs: [] },
        now: { pages: many.map((i) => page(`/blog/articulo-${i}`, 10, 600, 5)), pairs: [] },
        quarter: { pages: [], pairs: [] },
      },
      meta,
    );
    expect(big.decaying).toBe(20);
    expect(big.pages).toHaveLength(DECAY_LIMIT);
    expect(shortPath(big.pages[0].url)).toBe("/blog/articulo-19");
    expect(big.pages.at(-1)!.clicksLost).toBe(25);
  });

  it("sin bajas: lista vacía (buenas noticias)", () => {
    const calm = buildDecay({ now: previous, previous, quarter: previous }, meta);
    expect(calm.pages).toEqual([]);
    expect(calm.decaying).toBe(0);
    expect(calm.pagesChecked).toBe(8);
  });
});

describe("palabras simples", () => {
  const report = buildDecay({ now, previous, quarter }, meta);

  it("cada motivo tiene etiqueta, explicación y 1-2 cosas para hacer en los dos idiomas", () => {
    for (const p of report.pages)
      for (const t of [es, en]) {
        expect(reasonLabel(p.reason, t)).toBeTruthy();
        expect(reasonWhy(p, t)).toBeTruthy();
        const lines = decayActions(p, t);
        expect(lines.length).toBeGreaterThanOrEqual(1);
        expect(lines.length).toBeLessThanOrEqual(2);
      }
    expect(reasonLabel("position", es)).toBe("Bajó de posición");
    expect(reasonLabel("demand", es)).toBe("Menos gente lo busca");
    expect(reasonLabel("ctr", es)).toBe("Te ven pero no hacen clic");
    expect(reasonLabel("queries", es)).toBe("Perdió búsquedas clave");
  });

  it("los consejos dicen qué hacer según el motivo", () => {
    const find = (p: string) => report.pages.find((x) => shortPath(x.url) === p)!;
    expect(decayActions(find(CORTINAS), es)[0]).toMatch(/título y la descripción/);
    expect(decayActions(find(MANAGUA), es).join(" ")).toMatch(/enlaces/);
    expect(decayActions(find(PRECIOS), es)[0]).toMatch(/temporada/);
    expect(decayActions(find(PORTONES), es)[0]).toContain("portones tipo americano nicaragua");
    expect(decayActions(find(PROMO), es)[0]).toMatch(/Ya no sale en Google/);
  });
});

describe("readDecayReport", () => {
  it("lee un reporte guardado (ida y vuelta por JSON)", () => {
    const report = buildDecay({ now, previous, quarter }, meta);
    expect(readDecayReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
  });

  it("aguanta datos viejos o rotos", () => {
    expect(readDecayReport(null)).toBeNull();
    expect(readDecayReport({ totals: {} })).toBeNull();
    const r = readDecayReport({ version: 1, pages: [{ url: `${SITE}/x`, reason: "otro", before: "?", lostQueries: [{ query: "" }, { query: "a" }], also: null }, { url: "" }] });
    expect(r?.pages).toHaveLength(1);
    expect(r?.pages[0]).toMatchObject({ reason: "queries", compare: "previous", before: { clicks: 0 }, also: null });
    expect(r?.pages[0].lostQueries.map((q) => q.query)).toEqual(["a"]);
  });
});
