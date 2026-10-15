import { describe, expect, it } from "vitest";
import { directoryOf, listingUpdate, phoneInSnippet, phoneQuery, phonesIn, readScanReport, scanCostEstimate, scanHits } from "@/lib/listings-scan";
import type { SerpResult } from "@/lib/seo/rank";

const DIRS = [
  { id: "google", name: "Google Business Profile", domain: "google.com" },
  { id: "yelp", name: "Yelp", domain: "yelp.com" },
  { id: "bbb", name: "BBB", domain: "bbb.org" },
  { id: "facebook", name: "Facebook", domain: "facebook.com" },
  { id: "chamber", name: "Cámara de Comercio", domain: "chamber" },
];

const serp = (items: Record<string, unknown>[]) => ({ items: items.map((i) => ({ type: "organic", ...i })) }) as unknown as SerpResult;

describe("Buscar mis fichas", () => {
  it("reconoce el directorio por el dominio", () => {
    expect(directoryOf("https://m.yelp.com/biz/joes-roofing-miami", DIRS)).toBe("yelp");
    expect(directoryOf("https://www.miamichamber.com/list/member/joes", DIRS)).toBe("chamber");
    expect(directoryOf("https://notyelp.com/x", DIRS)).toBeNull();
    expect(directoryOf("nada", DIRS)).toBeNull();
  });

  it("arma la búsqueda del teléfono", () => {
    expect(phoneQuery("(305) 394-8090")).toBe('"305-394-8090"');
    expect(phoneQuery("+1 305 394 8090")).toBe('"305-394-8090"');
    expect(phoneQuery("+505 8888 8888")).toBe('"+505 8888 8888"');
    expect(phoneQuery("123")).toBe("");
  });

  it("encuentra teléfonos en el texto de Google y los compara", () => {
    expect(phonesIn("Llámanos al (305) 394-8090 o 305.111.2222. Abierto 24/7 desde 2015")).toEqual(["(305) 394-8090", "305.111.2222"]);
    expect(phoneInSnippet("Call (305) 394-8090 today", "305-394-8090")).toBe("ok");
    expect(phoneInSnippet("Call (786) 000-1111 today", "305-394-8090")).toBe("different");
    expect(phoneInSnippet("Best roofers in town", "305-394-8090")).toBe("unknown");
    expect(phoneInSnippet("Call (305) 394-8090", "")).toBe("unknown");
  });

  it("solo cuenta fichas que nombran al negocio, o que tienen su teléfono", () => {
    const hits = scanHits({
      byName: serp([
        { url: "https://www.yelp.com/search?find_desc=roofers", title: "Top 10 Best Roofers in Miami" },
        { url: "https://www.yelp.com/biz/joes-roofing-miami", title: "Joe's Roofing LLC - Miami, FL - Yelp", description: "Call (786) 000-1111" },
        { url: "https://www.bbb.org/us/fl/miami/profile/roofing/joes-roofing", title: "Joe's Roofing | BBB Business Profile" },
        { url: "https://business.google.com/x", title: "Joe's Roofing" },
        { url: "https://joesroofing.com", title: "Joe's Roofing" },
      ]),
      byPhone: serp([
        { url: "https://www.bbb.org/us/fl/miami/profile/roofing/joes-roofing", title: "BBB" },
        { url: "https://www.facebook.com/joesroofingmia", title: "Roofing Miami | Facebook" },
      ]),
      dirs: DIRS,
      businessName: "Joe's Roofing",
      phone: "(305) 394-8090",
    });
    expect(hits.map((h) => [h.id, h.phone, h.url])).toEqual([
      ["yelp", "different", "https://www.yelp.com/biz/joes-roofing-miami"],
      ["bbb", "ok", "https://www.bbb.org/us/fl/miami/profile/roofing/joes-roofing"],
      ["facebook", "ok", "https://www.facebook.com/joesroofingmia"],
    ]);
  });

  it("solo anota sola una ficha que estaba «por hacer»", () => {
    const hit = { id: "yelp", name: "Yelp", url: "https://yelp.com/biz/x", title: "x", phone: "different" as const };
    expect(listingUpdate(hit, undefined, "2026-10-14T00:00:00.000Z")).toEqual({ status: "listed", url: "https://yelp.com/biz/x", napOk: false, notes: "Encontrada por la revisión automática (2026-10-14). El teléfono no coincide." });
    expect(listingUpdate({ ...hit, phone: "ok" }, { status: "todo", napOk: null }, "2026-10-14")?.napOk).toBe(true);
    expect(listingUpdate(hit, { status: "claimed", napOk: true }, "2026-10-14")).toBeNull();
    expect(listingUpdate(hit, { status: "skip", napOk: null }, "2026-10-14")).toBeNull();
  });

  it("guarda la revisión y dice lo que cuesta", () => {
    const r = { query: '"Joe" Miami', phoneQuery: "", hits: [{ id: "yelp", name: "Yelp", url: "https://yelp.com/biz/x", title: "x", phone: "ok" }, { id: "x", url: "javascript:alert(1)" }], missing: ["bbb"], marked: 1, cost: 0.013, createdAt: "2026-10-14T00:00:00.000Z" };
    expect(readScanReport(r)?.hits).toEqual([{ id: "yelp", name: "Yelp", url: "https://yelp.com/biz/x", title: "x", phone: "ok" }]);
    expect(readScanReport({})).toBeNull();
    expect(scanCostEstimate(true)).toBe(0.013);
    expect(scanCostEstimate(false)).toBe(0.008);
  });
});

describe("teléfonos que no son", () => {
  it("una lista de años no es un teléfono", () => {
    expect(phonesIn("Premios 2005 2010 2015 y 2020")).toEqual([]);
  });
});
