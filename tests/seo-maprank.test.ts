import { describe, expect, it } from "vitest";
import { BiError } from "@/lib/i18n";
import type { DfsResult } from "@/lib/seo/dataforseo";
import {
  coordinate,
  distanceKm,
  findMapPlaces,
  findRank,
  gridPoints,
  isMapSize,
  isMapSpacing,
  MAP_COST_PER_POINT,
  mapCostEstimate,
  mapTiles,
  type MapItem,
  type MapPlace,
  type MapPoint,
  type MapsResult,
  NOT_FOUND_RANK,
  ownDomain,
  parseMapsItems,
  rankBand,
  readMapPlace,
  readMapReport,
  runMapGrid,
  summarizeMap,
  zoomFor,
} from "@/lib/seo/maprank";

const MANAGUA = { lat: 12.1364, lng: -86.2514 };
const MIAMI = { lat: 25.7617, lng: -80.1918 };

const fameseg: MapPlace = {
  title: "Fameseg S.A.",
  cid: "1234567890123456789",
  placeId: "ChIJfameseg",
  featureId: "0x8f71:0xabc",
  address: "Km 5 Carretera Norte, Managua",
  lat: MANAGUA.lat,
  lng: MANAGUA.lng,
  domain: "fameseg.com.ni",
  rating: 4.7,
  reviews: 58,
};

const item = (rank: number, title: string, extra: Partial<MapItem> = {}): MapItem => ({
  rank,
  title,
  cid: `cid-${rank}`,
  placeId: `place-${rank}`,
  featureId: `feat-${rank}`,
  address: "",
  lat: 0,
  lng: 0,
  domain: "",
  url: "",
  category: "",
  rating: null,
  reviews: null,
  ...extra,
});

// Respuesta con la forma de la documentación (tasks[0].result[0]) de /serp/google/maps/live/advanced.
const fixture: MapsResult = {
  keyword: "cortinas metalicas managua",
  items: [
    {
      type: "maps_search",
      rank_group: 1,
      rank_absolute: 1,
      title: "Cortinas Metálicas Nicaragua",
      domain: "cortinasni.com",
      url: "https://cortinasni.com/",
      cid: "9988776655",
      place_id: "ChIJcortinas",
      feature_id: "0x1:0x2",
      category: "Fabricante de puertas",
      address: "Bello Horizonte, Managua",
      latitude: 12.14,
      longitude: -86.23,
      rating: { value: 4.5, votes_count: 120 },
    },
    {
      type: "maps_search",
      rank_group: 2,
      rank_absolute: 2,
      title: "FAMESEG",
      domain: "www.fameseg.com.ni",
      url: "https://www.fameseg.com.ni/",
      cid: "1234567890123456789",
      place_id: "ChIJfameseg",
      feature_id: "0x8f71:0xabc",
      category: "Proveedor de puertas",
      address: "Km 5 Carretera Norte, Managua",
      latitude: 12.1364,
      longitude: -86.2514,
      rating: { value: 4.7, votes_count: 58 },
    },
    // Lo que no es un negocio se ignora.
    { type: "something_else", rank_group: 3, title: "Anuncio" },
    { type: "maps_search", rank_group: 3, rank_absolute: 3, title: "Portones Sandino", cid: 555 as unknown as string, latitude: 12.13, longitude: -86.26, rating: null },
    { type: "maps_search", title: "Sin lugar" },
  ],
};

describe("gridPoints", () => {
  it("makes size × size points centered on the business", () => {
    for (const size of [3, 5, 7]) {
      const pts = gridPoints(MANAGUA, size, 1);
      expect(pts).toHaveLength(size * size);
      const mid = pts[Math.floor(pts.length / 2)];
      expect(mid.lat).toBeCloseTo(MANAGUA.lat, 6);
      expect(mid.lng).toBeCloseTo(MANAGUA.lng, 6);
    }
  });

  it("goes north to south, west to east", () => {
    const pts = gridPoints(MIAMI, 3, 2);
    expect(pts[0].lat).toBeGreaterThan(pts[8].lat);
    expect(pts[0].lng).toBeLessThan(pts[2].lng);
    expect(pts[0].lat).toBeCloseTo(pts[2].lat, 7);
  });

  it.each([
    ["Managua", MANAGUA],
    ["Miami", MIAMI],
  ])("spacing is about right in %s (longitude scaled by latitude)", (_name, center) => {
    for (const spacing of [0.5, 1, 2, 5]) {
      const pts = gridPoints(center, 5, spacing);
      const mid = pts[12];
      // Vecino al este y al norte del centro.
      expect(distanceKm(mid, pts[13])).toBeCloseTo(spacing, 1);
      expect(distanceKm(mid, pts[7])).toBeCloseTo(spacing, 1);
      expect(Math.abs(distanceKm(mid, pts[13]) - spacing) / spacing).toBeLessThan(0.01);
      expect(Math.abs(distanceKm(mid, pts[7]) - spacing) / spacing).toBeLessThan(0.01);
      // Esquina: la diagonal de 2 pasos.
      expect(distanceKm(mid, pts[0])).toBeCloseTo(2 * spacing * Math.SQRT2, 0);
    }
    // Más lejos del ecuador, un km es más grados de longitud.
    const near = gridPoints(MANAGUA, 3, 1);
    const far = gridPoints(MIAMI, 3, 1);
    expect(far[5].lng - far[4].lng).toBeGreaterThan(near[5].lng - near[4].lng);
  });

  it("keeps at most 7 decimals", () => {
    for (const p of gridPoints(MIAMI, 7, 0.5)) {
      expect(String(p.lat).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(7);
      expect(String(p.lng).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(7);
    }
  });
});

describe("zoom and coordinates", () => {
  it("picks zoom from spacing", () => {
    expect(zoomFor(0.5)).toBe(15);
    expect(zoomFor(1)).toBe(15);
    expect(zoomFor(2)).toBe(14);
    expect(zoomFor(3)).toBe(13);
    expect(zoomFor(5)).toBe(13);
  });
  it("writes lat,lng,zoom", () => {
    expect(coordinate({ lat: 12.1364, lng: -86.2514 }, 15)).toBe("12.1364,-86.2514,15z");
    expect(coordinate({ lat: 25.123456789, lng: -80.987654321 }, 25)).toBe("25.1234568,-80.9876543,21z");
  });
  it("validates options", () => {
    expect(isMapSize(5)).toBe(true);
    expect(isMapSize(4)).toBe(false);
    expect(isMapSpacing(0.5)).toBe(true);
    expect(isMapSpacing(4)).toBe(false);
  });
});

describe("parseMapsItems", () => {
  it("reads the businesses of a Maps response", () => {
    const items = parseMapsItems(fixture);
    expect(items.map((i) => i.title)).toEqual(["Cortinas Metálicas Nicaragua", "FAMESEG", "Portones Sandino"]);
    expect(items[1]).toMatchObject({
      rank: 2,
      cid: "1234567890123456789",
      placeId: "ChIJfameseg",
      featureId: "0x8f71:0xabc",
      domain: "fameseg.com.ni",
      lat: 12.1364,
      lng: -86.2514,
      rating: 4.7,
      reviews: 58,
      category: "Proveedor de puertas",
    });
    expect(items[2]).toMatchObject({ cid: "555", rating: null, reviews: null });
  });
  it("tolerates empty or broken responses", () => {
    expect(parseMapsItems(null)).toEqual([]);
    expect(parseMapsItems({ items: null })).toEqual([]);
    expect(parseMapsItems({ items: [null as never, 5 as never] })).toEqual([]);
  });
});

describe("findRank", () => {
  it("matches by cid first", () => {
    const items = [item(1, "Otro", { cid: fameseg.cid }), item(2, "Fameseg", { domain: "fameseg.com.ni" })];
    expect(findRank(items, fameseg)).toBe(1);
  });
  it("then by place_id or feature_id", () => {
    expect(findRank([item(1, "A"), item(4, "B", { placeId: fameseg.placeId })], fameseg)).toBe(4);
    expect(findRank([item(1, "A"), item(6, "B", { featureId: fameseg.featureId })], fameseg)).toBe(6);
  });
  it("then by website domain (subdomains too)", () => {
    expect(findRank([item(1, "A"), item(7, "B", { domain: "tienda.fameseg.com.ni" })], fameseg)).toBe(7);
    const noDomain = { ...fameseg, cid: "", placeId: "", featureId: "", domain: "" };
    expect(findRank([item(3, "B", { domain: "fameseg.com.ni" })], noDomain, "https://www.fameseg.com.ni")).toBe(3);
  });
  it("does not match by shared domains like facebook.com", () => {
    const fb = { ...fameseg, cid: "", placeId: "", featureId: "", title: "Puertas Lopez", domain: "facebook.com" };
    expect(findRank([item(2, "Otro negocio", { domain: "facebook.com" })], fb)).toBeNull();
    expect(ownDomain("m.facebook.com")).toBe("");
    expect(ownDomain("https://www.fameseg.com.ni/x")).toBe("fameseg.com.ni");
  });
  it("then by normalized name", () => {
    const byName = { ...fameseg, cid: "", placeId: "", featureId: "", domain: "" };
    expect(findRank([item(1, "Otro"), item(9, "FAMESEG")], byName)).toBe(9);
    expect(findRank([item(1, "Fameseg Repuestos")], byName)).toBeNull();
  });
  it("returns null when not in the results", () => {
    expect(findRank([item(1, "A"), item(2, "B")], fameseg)).toBeNull();
    expect(findRank([], fameseg)).toBeNull();
  });
  it("works with the fixture", () => {
    expect(findRank(parseMapsItems(fixture), fameseg)).toBe(2);
  });
});

describe("summarizeMap", () => {
  const top = (...t: [string, number, string?][]) => t.map(([title, rank, cid]) => ({ title, rank, ...(cid ? { cid } : {}) }));
  const pt = (rank: number | null, top3: ReturnType<typeof top>, error?: boolean): MapPoint => ({
    lat: 0,
    lng: 0,
    rank,
    top3,
    ...(error ? { error: { es: "x", en: "x" } } : {}),
  });
  const points: MapPoint[] = [
    pt(1, top(["Fameseg", 1, fameseg.cid], ["Rival A", 2, "a"], ["Rival B", 3, "b"])),
    pt(2, top(["Rival A", 1, "a"], ["Fameseg", 2, fameseg.cid], ["Rival C", 3, "c"])),
    pt(5, top(["Rival A", 1, "a"], ["Rival B", 2, "b"], ["Rival C", 3, "c"])),
    pt(null, top(["Rival A", 2, "a"], ["Rival B", 1, "b"], ["Rival D", 3])),
    pt(null, [], true),
  ];
  const s = summarizeMap(points, { title: "Fameseg", cid: fameseg.cid });

  it("averages positions with not-found as 21 and skips errors", () => {
    expect(s.avgRank).toBe(Math.round(((1 + 2 + 5 + NOT_FOUND_RANK) / 4) * 10) / 10);
  });
  it("computes top-3 share and found count", () => {
    expect(s.top3Share).toBe(50);
    expect(s.found).toBe(3);
  });
  it("ranks competitors by points in the top 3", () => {
    expect(s.competitors[0]).toEqual({ title: "Rival A", cid: "a", points: 4, avgRank: 1.5 });
    expect(s.competitors[1]).toEqual({ title: "Rival B", cid: "b", points: 3, avgRank: 2 });
    expect(s.competitors[2]).toEqual({ title: "Rival C", cid: "c", points: 2, avgRank: 3 });
    expect(s.competitors.find((c) => c.title === "Fameseg")).toBeUndefined();
    expect(s.competitors.find((c) => c.title === "Rival D")).toMatchObject({ points: 1, avgRank: 3 });
  });
  it("handles all-error maps", () => {
    expect(summarizeMap([pt(null, [], true)], { title: "x", cid: "" })).toEqual({ avgRank: null, top3Share: 0, found: 0, competitors: [] });
  });
});

describe("rankBand", () => {
  it("colors by position", () => {
    expect([1, 3, 4, 7, 8, 10, 11, 20].map((r) => rankBand(r))).toEqual(["top3", "top3", "good", "good", "mid", "mid", "low", "low"]);
    expect(rankBand(null)).toBe("none");
    expect(rankBand(2, { es: "x" })).toBe("error");
  });
});

describe("mapCostEstimate", () => {
  it("is one search per point", () => {
    expect(MAP_COST_PER_POINT).toBe(0.002);
    expect(mapCostEstimate(3)).toBe(0.018);
    expect(mapCostEstimate(5)).toBe(0.05);
    expect(mapCostEstimate(7)).toBe(0.098);
  });
});

describe("readMapPlace", () => {
  it("reads a saved place", () => {
    expect(readMapPlace({ ...fameseg, domain: "https://www.fameseg.com.ni/" })).toEqual(fameseg);
  });
  it("rejects bad data", () => {
    expect(readMapPlace(null)).toBeNull();
    expect(readMapPlace([])).toBeNull();
    expect(readMapPlace({ title: "x" })).toBeNull();
    expect(readMapPlace({ title: "", lat: 1, lng: 2 })).toBeNull();
    expect(readMapPlace({ title: "x", lat: 100, lng: 2 })).toBeNull();
    expect(readMapPlace({ title: "x", lat: 1, lng: 2, rating: "5" })).toMatchObject({ rating: null, cid: "" });
  });
});

describe("readMapReport", () => {
  it("rejects things that aren't maps", () => {
    expect(readMapReport(null)).toBeNull();
    expect(readMapReport("x")).toBeNull();
    expect(readMapReport({ keyword: "x" })).toBeNull();
    expect(readMapReport({ keyword: "", points: [{ lat: 1, lng: 1 }] })).toBeNull();
    expect(readMapReport({ keyword: "x", points: [null, { lat: "a" }] })).toBeNull();
  });
  it("tolerates broken points and recomputes the summary", () => {
    const r = readMapReport({
      keyword: "puertas",
      place: { title: "Fameseg", cid: "1" },
      points: [
        { lat: 12, lng: -86, rank: 2, top3: [{ title: "A", rank: 1 }, null, { title: "Fameseg", rank: 2, cid: "1" }, { title: "", rank: 3 }] },
        { lat: 12.01, lng: -86, rank: 0, top3: "nope" },
        { lat: 12.02, lng: -86, rank: null, error: "boom" },
        { lat: 999, lng: 0 },
      ],
      avgRank: 1,
      top3Share: 100,
      size: "big",
      cost: "x",
      createdAt: "not a date",
    });
    expect(r).not.toBeNull();
    expect(r!.points).toHaveLength(3);
    expect(r!.points[0].top3).toEqual([{ title: "A", rank: 1 }, { title: "Fameseg", rank: 2, cid: "1" }]);
    expect(r!.points[1]).toMatchObject({ rank: null, top3: [] });
    expect(r!.points[2].error).toEqual({ es: "boom", en: "boom" });
    expect(r!.avgRank).toBe(11.5);
    expect(r!.top3Share).toBe(50);
    expect(r!.found).toBe(1);
    expect(r!.size).toBe(2);
    expect(r!.cost).toBe(0);
    expect(r!.createdAt).toBe(new Date(0).toISOString());
    expect(r!.competitors).toEqual([{ title: "A", points: 1, avgRank: 1 }]);
    expect(r!.center).toEqual({ lat: 12.01, lng: -86 });
  });
});

describe("runMapGrid (no network)", () => {
  type Call = { path: string; task: Record<string, unknown> };
  const fake = (handler: (task: Record<string, unknown>, i: number) => MapsResult | Error) => {
    const calls: Call[] = [];
    const post = async <T,>(path: string, task: Record<string, unknown>): Promise<DfsResult<T>> => {
      const i = calls.length;
      calls.push({ path, task });
      const r = handler(task, i);
      if (r instanceof Error) throw r;
      return { result: [r as unknown as T], cost: 0.002 };
    };
    return { post, calls };
  };

  it("searches once per point with coordinates and saves a report", async () => {
    const { post, calls } = fake((_t, i) => (i % 2 === 0 ? fixture : { items: [] }));
    const r = await runMapGrid({ keyword: "cortinas metalicas", place: fameseg, website: "fameseg.com.ni", size: 3, spacingKm: 2, language: "es" }, post);
    expect(calls).toHaveLength(9);
    expect(calls[0].path).toBe("/serp/google/maps/live/advanced");
    expect(calls[4].task).toMatchObject({ keyword: "cortinas metalicas", location_coordinate: "12.1364,-86.2514,14z", language_code: "es", device: "mobile", depth: 20 });
    expect(r.points).toHaveLength(9);
    expect(r.points.filter((p) => p.rank === 2)).toHaveLength(5);
    expect(r.found).toBe(5);
    expect(r.cost).toBe(0.018);
    expect(r.zoom).toBe(14);
    expect(r.points[0].top3.map((t) => t.title)).toEqual(["Cortinas Metálicas Nicaragua", "FAMESEG", "Portones Sandino"]);
    expect(r.competitors[0]).toMatchObject({ title: "Cortinas Metálicas Nicaragua", points: 5, avgRank: 1 });
  });

  it("marks failed points and keeps going", async () => {
    const { post } = fake((_t, i) => (i === 3 ? new BiError("falló", "failed") : fixture));
    const r = await runMapGrid({ keyword: "k", place: fameseg, website: "", size: 3, spacingKm: 1, language: "es" }, post);
    expect(r.points.filter((p) => p.error)).toHaveLength(1);
    expect(r.points.find((p) => p.error)?.error).toEqual({ es: "falló", en: "failed" });
    expect(r.cost).toBe(0.016);
  });

  it("throws when every point fails", async () => {
    const { post } = fake(() => new BiError("sin saldo", "no funds"));
    await expect(runMapGrid({ keyword: "k", place: fameseg, website: "", size: 3, spacingKm: 1, language: "es" }, post)).rejects.toMatchObject({ message: "sin saldo", en: "no funds" });
  });

  it("stops starting new searches when time runs out", async () => {
    let clock = 0;
    const { post, calls } = fake(() => {
      clock += 100_000;
      return fixture;
    });
    const r = await runMapGrid({ keyword: "k", place: fameseg, website: "", size: 5, spacingKm: 1, language: "es" }, post, () => clock);
    expect(calls.length).toBeLessThan(25);
    expect(r.points.filter((p) => p.error).length).toBe(25 - calls.length);
  });
});

describe("findMapPlaces (no network)", () => {
  it("searches by name in the main area and flags the website match", async () => {
    const tasks: Record<string, unknown>[] = [];
    const post = async <T,>(_path: string, task: Record<string, unknown>): Promise<DfsResult<T>> => {
      tasks.push(task);
      return { result: [fixture as unknown as T], cost: 0.002 };
    };
    const r = await findMapPlaces({ query: "Fameseg", zone: { code: 2558, name: "Managua,Nicaragua" }, language: "es", website: "https://fameseg.com.ni" }, post);
    expect(tasks[0]).toMatchObject({ keyword: "Fameseg", location_code: 2558, language_code: "es" });
    expect(tasks[0].location_coordinate).toBeUndefined();
    expect(r.candidates).toHaveLength(3);
    expect(r.candidates.filter((c) => c.matchesWebsite).map((c) => c.title)).toEqual(["FAMESEG"]);
    expect(r.cost).toBe(0.002);
  });
});

describe("mapTiles", () => {
  it("uses CARTO Voyager with the key, with both attributions", () => {
    const t = mapTiles(" abc 123 ");
    expect(t.url).toBe("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=abc%20123");
    expect(t.attribution).toContain("OpenStreetMap");
    expect(t.attribution).toContain("CARTO");
    expect(t.subdomains).toBe("abcd");
  });
  it("falls back to OpenStreetMap without a key", () => {
    for (const k of [undefined, null, "", "  "]) {
      const t = mapTiles(k);
      expect(t.url).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
      expect(t.attribution).toContain("OpenStreetMap");
      expect(t.attribution).not.toContain("CARTO");
    }
  });
});
