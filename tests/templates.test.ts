import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATES, pickTemplate, TemplateSpec } from "@/lib/design-shapes";

describe("plantillas", () => {
  it("las de fábrica son válidas", () => {
    for (const t of BUILTIN_TEMPLATES) expect(TemplateSpec.safeParse(t).success).toBe(true);
  });
  it("en automático usa lista si hay pasos y color si es pregunta", () => {
    expect(pickTemplate([], -1, { headline: "Después de la tormenta", steps: ["a", "b"], hasPhoto: true }).layout).toBe("lista");
    expect(pickTemplate([], -1, { headline: "¿Sabías esto?", hasPhoto: true }).layout).toBe("color-solido");
    expect(pickTemplate([], -1, { headline: "Consejo", hasPhoto: true }).layout).not.toBe("color-solido");
  });
  it("no usa una plantilla con foto si no hay foto", () => {
    expect(pickTemplate([], 0, { headline: "Hola", hasPhoto: false }).layout).toBe("color-solido");
  });
});
