import { describe, expect, it } from "vitest";
import { businessDay, businessTzLabel, fmtDate, fmtDateTime, fmtFriendly, fmtTime, fmtWhen, localToUtc } from "@/lib/time";

// 6 oct 2026, 06:35 UTC = 2:35 a.m. en Miami (horario de verano, UTC-4).
const d = new Date("2026-10-06T06:35:00Z");
const TZ = "America/New_York";

describe("fechas en la hora del negocio (Miami)", () => {
  it("muestra la hora de Miami aunque el servidor esté en UTC", () => {
    expect(fmtDateTime(d, "es", TZ)).toMatch(/6 oct 2026/);
    expect(fmtDateTime(d, "es", TZ)).toMatch(/2:35\s?a\.\s?m\./);
    expect(fmtDateTime(d, "en", TZ)).toMatch(/Oct 6, 2026.*2:35\sAM/);
    expect(fmtTime(d, "en", TZ)).toMatch(/2:35\sAM/);
  });
  it("el día cambia según Miami, no según UTC", () => {
    // 7 oct 02:00 UTC todavía es 6 oct (10 p.m.) en Miami.
    const late = new Date("2026-10-07T02:00:00Z");
    expect(businessDay(late, TZ)).toBe("2026-10-06");
    expect(fmtDate(late, "es", TZ)).toMatch(/6 oct 2026/);
    expect(fmtTime(late, "en", TZ)).toMatch(/10:00\sPM/);
  });
  it("respeta el horario de invierno (UTC-5)", () => {
    expect(fmtTime(new Date("2026-12-01T15:00:00Z"), "en", TZ)).toMatch(/10:00\sAM/);
  });
  it("fecha inválida no rompe la pantalla", () => {
    expect(fmtDateTime("basura", "es")).toBe("—");
    expect(fmtDate(new Date(NaN), "en")).toBe("—");
  });
  it("hoy, ayer y mañana en palabras", () => {
    const now = new Date("2026-10-06T16:00:00Z"); // mediodía en Miami
    expect(fmtFriendly(d, "es", now, TZ)).toMatch(/^Hoy, 2:35/);
    expect(fmtFriendly(new Date("2026-10-05T20:00:00Z"), "en", now, TZ)).toMatch(/^Yesterday, 4:00\sPM/);
    expect(fmtFriendly(new Date("2026-10-07T14:00:00Z"), "es", now, TZ)).toMatch(/^Mañana, 10:00/);
    expect(fmtFriendly(new Date("2026-10-01T14:00:00Z"), "es", now, TZ)).toBe(fmtDateTime(new Date("2026-10-01T14:00:00Z"), "es", TZ));
  });
  it("dentro de una frase", () => {
    const now = new Date("2026-10-06T16:00:00Z");
    expect(fmtWhen(d, "es", now, TZ)).toMatch(/^hoy, 2:35/);
    expect(fmtWhen(new Date("2026-10-01T14:00:00Z"), "es", now, TZ)).toMatch(/^el 1 oct 2026/);
    expect(fmtWhen(new Date("2026-10-01T14:00:00Z"), "en", now, TZ)).toMatch(/^on Oct 1, 2026/);
  });
  it("nombre de la zona", () => {
    expect(businessTzLabel("es", TZ)).toBe("hora de Miami");
    expect(businessTzLabel("en", TZ)).toBe("Miami time");
    expect(businessTzLabel("es", "America/Managua")).toBe("hora de Managua");
  });
  it("ida y vuelta con localToUtc", () => {
    const at = localToUtc("2026-10-06", 0, "02:35", TZ);
    expect(at.toISOString()).toBe("2026-10-06T06:35:00.000Z");
    expect(fmtTime(at, "en", TZ)).toMatch(/2:35\sAM/);
  });
});
