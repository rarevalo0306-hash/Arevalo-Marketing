import { describe, expect, it } from "vitest";
import { ideasFor } from "@/lib/ideas";

describe("ideas del Inicio", () => {
  it("para un ajustador público en temporada de huracanes", () => {
    const ideas = ideasFor("Ajustadores públicos con licencia en Florida", "Ricardo PA", 8);
    expect(ideas[0]).toMatch(/huracanes/i);
    expect(ideas).toHaveLength(5);
  });
  it("ideas generales para otros negocios", () => {
    expect(ideasFor("Barbería en Coral Way", "Barbershop", 8).join(" ")).not.toMatch(/reclamo|huracán/i);
  });
});
