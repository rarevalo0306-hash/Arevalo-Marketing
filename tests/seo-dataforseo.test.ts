import { describe, expect, it } from "vitest";
import { rankLocations, readZones, zoneLabel, type DfsLocation } from "@/lib/seo/dataforseo";

const loc = (name: string, type: string, code: number): DfsLocation => ({ code, name, type, country: "NI" });
const list = [
  loc("Somoto,Madriz,Nicaragua", "City", 1),
  loc("Managua,Managua,Managua,Nicaragua", "City", 2),
  loc("Nicaragua", "Country", 3),
  loc("Managua,Nicaragua", "Department", 4),
  loc("Masaya,Masaya,Nicaragua", "City", 5),
];

describe("rankLocations", () => {
  it("pone primero el país cuando se busca su nombre", () => {
    expect(rankLocations(list, "Nicaragua")[0].type).toBe("Country");
  });
  it("prefiere el nombre exacto y luego la zona más grande", () => {
    const r = rankLocations(list, "managua");
    expect(r.map((l) => l.code)).toEqual([4, 2]);
  });
  it("no distingue acentos ni mayúsculas", () => {
    expect(rankLocations([loc("León,León,Nicaragua", "City", 9)], "leon")).toHaveLength(1);
  });
  it("respeta el límite y no devuelve nada sin búsqueda", () => {
    expect(rankLocations(list, "nicaragua", 2)).toHaveLength(2);
    expect(rankLocations(list, "  ")).toEqual([]);
  });
});

describe("readZones", () => {
  it("lee la lista, quita repetidas e inválidas y deja máximo 5", () => {
    const z = readZones([{ code: 3, name: "Nicaragua", type: "Country" }, { code: 3, name: "otra" }, { code: "x" }, ...[10, 11, 12, 13, 14].map((code) => ({ code, name: `Z${code}` }))]);
    expect(z.map((x) => x.code)).toEqual([3, 10, 11, 12, 13]);
  });
  it("usa la zona única de antes si no hay lista", () => {
    expect(readZones(null, 1015116, "Miami,Florida,United States")).toEqual([{ code: 1015116, name: "Miami,Florida,United States" }]);
    expect(readZones(null, null, "")).toEqual([]);
  });
});

describe("zoneLabel", () => {
  it("acorta los nombres largos y quita repetidos", () => {
    expect(zoneLabel("Managua,Managua,Managua,Nicaragua")).toBe("Managua, Nicaragua");
    expect(zoneLabel("Miami,Florida,United States")).toBe("Miami, United States");
    expect(zoneLabel("Nicaragua")).toBe("Nicaragua");
  });
});
