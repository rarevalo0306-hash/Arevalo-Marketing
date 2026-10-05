import { describe, expect, it } from "vitest";
import { DESIGN_SHAPES, headlineSize } from "@/lib/design-shapes";

describe("diseño con la marca", () => {
  it("los titulares largos usan letra más chica", () => {
    expect(headlineSize("Corto", 1080)).toBeGreaterThan(headlineSize("Un titular bastante más largo que el anterior, con muchas palabras", 1080));
  });
  it("tiene los tamaños de cada red", () => {
    expect(DESIGN_SHAPES.square).toMatchObject({ w: 1080, h: 1080 });
    expect(DESIGN_SHAPES.story).toMatchObject({ w: 1080, h: 1920 });
  });
});
