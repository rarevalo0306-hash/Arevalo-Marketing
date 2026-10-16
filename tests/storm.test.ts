import { describe, expect, it } from "vitest";
import { stormSchedule, stormWindow } from "../src/lib/storm";

const tz = "America/New_York";
const local = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", weekday: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);

describe("stormSchedule", () => {
  // Jueves 1 de octubre de 2026, 3:00 pm en Miami.
  const event = new Date("2026-10-01T19:00:00Z");

  it("las publicaciones de ayuda pueden salir pronto, en horario de día", () => {
    expect(local(stormSchedule(event, 2, "seguridad", tz))).toBe("01 Thu, 17:00");
    // 10 horas después serían la 1 am: pasa a las 9 am.
    expect(local(stormSchedule(event, 10, "seguridad", tz))).toBe("02 Fri, 09:00");
  });

  it("las que ofrecen servicios esperan más de 48 horas", () => {
    const at = stormSchedule(event, 5, "oferta", tz);
    expect(at.getTime() - event.getTime()).toBeGreaterThan(48 * 3600000);
    expect(local(at)).toBe("03 Sat, 16:00");
  });

  it("nunca ofrecen servicios en domingo ni de noche", () => {
    // 72 horas después es domingo: pasa al lunes 9 am.
    expect(local(stormSchedule(event, 72, "oferta", tz))).toBe("05 Mon, 09:00");
    // Sábado 10 pm: el domingo no vale, pasa al lunes.
    expect(local(stormSchedule(event, 55, "oferta", tz))).toBe("05 Mon, 09:00");
  });
});

describe("stormWindow", () => {
  // Jueves 1 de octubre de 2026, 3:00 pm en Miami.
  const event = new Date("2026-10-01T19:00:00Z");

  it("deja igual un momento que ya está en horario", () => {
    const friday = new Date("2026-10-02T15:30:00Z"); // viernes 11:30 am en Miami
    expect(stormWindow(friday, "seguridad", tz)).toEqual(friday);
    expect(stormWindow(friday, "oferta", tz)).toEqual(friday);
  });

  it("de noche pasa a las 9 am, antes de las 9 am también", () => {
    // Jueves 9 pm -> viernes 9 am; viernes 6 am -> viernes 9 am.
    expect(local(stormWindow(new Date("2026-10-02T01:00:00Z"), "seguridad", tz))).toBe("02 Fri, 09:00");
    expect(local(stormWindow(new Date("2026-10-02T10:00:00Z"), "seguridad", tz))).toBe("02 Fri, 09:00");
  });

  it("solo la oferta salta el domingo", () => {
    const sunday = new Date("2026-10-04T15:00:00Z"); // domingo 11 am
    expect(stormWindow(sunday, "seguridad", tz)).toEqual(sunday);
    expect(local(stormWindow(sunday, "oferta", tz))).toBe("05 Mon, 09:00");
  });

  it("usa la zona que recibe", () => {
    // 01:30 UTC del viernes: jueves 9:30 pm en Miami, 8:30 pm en Chicago; los dos pasan al viernes 9 am de su zona.
    const at = new Date("2026-10-02T01:30:00Z");
    expect(stormWindow(at, "seguridad", tz)).toEqual(new Date("2026-10-02T13:00:00Z"));
    expect(stormWindow(at, "seguridad", "America/Chicago")).toEqual(new Date("2026-10-02T14:00:00Z"));
  });

  it("stormSchedule es el evento más sus horas, movido a un horario permitido", () => {
    for (const [hours, phase] of [[2, "seguridad"], [10, "seguridad"], [5, "oferta"], [55, "oferta"], [72, "oferta"]] as const)
      expect(stormSchedule(event, hours, phase, tz)).toEqual(
        stormWindow(new Date(event.getTime() + Math.max(phase === "oferta" ? 49 : 1, hours) * 3600000), phase, tz),
      );
  });
});
