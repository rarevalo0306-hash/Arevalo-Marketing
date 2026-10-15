import { describe, expect, it } from "vitest";
import { buildZoneReports, deviceGap, readRankReport } from "@/lib/seo/rank";

describe("Posiciones en computadora", () => {
  it("compara la computadora con el celular", () => {
    expect(deviceGap(5, 3)).toEqual({ kind: "better", delta: 2 });
    expect(deviceGap(3, 7)).toEqual({ kind: "worse", delta: 4 });
    expect(deviceGap(4, 4)).toEqual({ kind: "same", delta: 0 });
    expect(deviceGap(null, 4)).toEqual({ kind: "only-desktop", delta: null });
    expect(deviceGap(4, null)).toEqual({ kind: "only-mobile", delta: null });
    expect(deviceGap(undefined, null)).toEqual({ kind: "none", delta: null });
  });

  it("guarda el aparato en el reporte (celular por defecto)", () => {
    const zone = { code: 1015116, name: "Miami" };
    const row = { keyword: "roof repair", position: 3, url: null, localPack: null, top: [], features: [] };
    const mobile = buildZoneReports([zone], "en", [{ zoneCode: zone.code, row, cost: 0.0035 }], "2026-10-01T00:00:00.000Z");
    expect(mobile.reports[0].device).toBe("mobile");
    const desk = buildZoneReports([zone], "en", [{ zoneCode: zone.code, row, cost: 0.0035 }], "2026-10-01T00:00:00.000Z", "desktop");
    expect(desk.reports[0].device).toBe("desktop");
    expect(readRankReport(JSON.parse(JSON.stringify(desk.reports[0])))?.device).toBe("desktop");
  });
});
