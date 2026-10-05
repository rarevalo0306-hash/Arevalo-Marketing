import { describe, expect, it } from "vitest";
import { stormSchedule } from "../src/lib/storm";

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
