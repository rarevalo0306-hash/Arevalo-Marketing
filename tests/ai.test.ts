import { describe, expect, it } from "vitest";
import { toPostFields } from "@/lib/ai";
import { localToUtc } from "@/lib/time";

describe("localToUtc", () => {
  it("convierte hora de Miami en verano (UTC-4)", () => {
    expect(localToUtc("2026-07-01", 0, "09:30", "America/New_York").toISOString()).toBe("2026-07-01T13:30:00.000Z");
  });
  it("convierte hora de Miami en invierno (UTC-5) y suma días", () => {
    expect(localToUtc("2026-12-30", 3, "18:00", "America/New_York").toISOString()).toBe("2027-01-02T23:00:00.000Z");
  });
  it("usa 10:00 si la hora no es válida", () => {
    expect(localToUtc("2026-07-01", 0, "mañana", "America/New_York").toISOString()).toBe("2026-07-01T14:00:00.000Z");
  });
});

describe("toPostFields", () => {
  it("reparte la respuesta de la IA por canal", () => {
    const f = toPostFields({
      facebook: "fb", instagram: "ig", tiktok: "tt", google: "g", sms: "s",
      emailSubject: "asunto", email: "cuerpo", seoTitle: "titulo", imageHeadline: "Titular", imageIdea: "a house",
    });
    expect(f.text).toBe("fb");
    expect(f.subject).toBe("asunto");
    expect(f.seoTitle).toBe("titulo");
    expect(f.variants).toMatchObject({ instagram: "ig", sms: "s", email: "cuerpo", seo: "fb" });
  });
});
