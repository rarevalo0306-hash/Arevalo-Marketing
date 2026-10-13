import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { readBrandIdentity } from "@/lib/brand-identity-shape";
import { renderDesign, samplePhoto } from "@/lib/design";
import { BUILTIN_TEMPLATES } from "@/lib/design-shapes";
import { DESIGN_STYLES, designStyleOf, inferDesignStyle, STYLE_INFO, styleTokens } from "@/lib/design-style";

describe("estilo de los diseños según el negocio", () => {
  it("lo saca de lo que hace el negocio", () => {
    expect(inferDesignStyle({ text: "Ricardo Public Adjusters. Ajustador público: te ayudamos con tu reclamación a la aseguradora." })).toBe("profesional");
    expect(inferDesignStyle({ text: "Studio Bella, salón de belleza: color, cortes y uñas." })).toBe("elegante");
    expect(inferDesignStyle({ text: "Sonrisa Dental, clínica dental familiar." })).toBe("fresco");
    expect(inferDesignStyle({ text: "Techos y remodelaciones: reparamos tu techo después de la tormenta." })).toBe("audaz");
    expect(inferDesignStyle({ text: "Cortinas metálicas para comercios en Managua." })).toBe("audaz");
  });

  it("no se confunde con palabras parecidas", () => {
    // «Spanish» no es un spa, «modalidad» no es moda y «seguro» (adjetivo) no es una aseguradora.
    expect(inferDesignStyle({ text: "We serve Spanish-speaking families in every modalidad, de forma segura." })).toBe("profesional");
  });

  it("sin pistas en el texto: por las letras, luego por el tono, y si no profesional", () => {
    expect(inferDesignStyle({ text: "Mi negocio", fontHeading: "playfair-display" })).toBe("elegante");
    expect(inferDesignStyle({ text: "Mi negocio", fontHeading: "oswald" })).toBe("audaz");
    expect(inferDesignStyle({ text: "Mi negocio", tones: ["directo"] })).toBe("audaz");
    expect(inferDesignStyle({ text: "Mi negocio", tones: ["cercano", "alegre"] })).toBe("fresco");
    expect(inferDesignStyle({ text: "" })).toBe("profesional");
  });

  it("lo que eligió el dueño gana; si no, lo decide la app", () => {
    const b = { name: "Studio Bella", aiProfile: "Salón de belleza", fontHeading: "poppins" };
    expect(designStyleOf(b)).toEqual({ style: "elegante", by: "app" });
    expect(designStyleOf({ ...b, brandIdentity: { designStyle: "audaz" } })).toEqual({ style: "audaz", by: "owner" });
    expect(designStyleOf({ ...b, brandIdentity: { designStyle: "otro", tones: ["directo"] }, aiProfile: "", name: "X" })).toEqual({ style: "audaz", by: "app" });
  });

  it("se guarda en la identidad solo si es un estilo válido", () => {
    expect(readBrandIdentity({ designStyle: "fresco" }).designStyle).toBe("fresco");
    expect(readBrandIdentity({ designStyle: "barato" }).designStyle).toBe("");
    expect(readBrandIdentity(null).designStyle).toBe("");
  });

  it("cada estilo tiene nombre, explicación y medidas", () => {
    for (const x of DESIGN_STYLES) {
      expect(STYLE_INFO[x].name.es).toBeTruthy();
      expect(styleTokens(x)).toBeTruthy();
    }
    expect(styleTokens("")).toEqual(styleTokens("profesional"));
  });
});

describe("cada estilo dibuja las plantillas", () => {
  it("con logo transparente, foto y pasos, en su medida exacta", async () => {
    // Logo de dos colores con fondo transparente: sobre la foto se usa su versión blanca, no una placa.
    const logo = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><rect x="10" y="20" width="120" height="80" fill="#126bbc"/><text x="150" y="85" font-size="60" fill="#58595b">LOGO</text></svg>`)).png().toBuffer();
    const brand = { name: "Ricardo", color: "#126bbc", color2: "#3dbab3", color3: "#58595b", logoUrl: `data:image/png;base64,${logo.toString("base64")}`, phone: "305-394-8090", website: "https://ricardopa.com" };
    const photoUrl = await samplePhoto("#126bbc");
    const pick = [BUILTIN_TEMPLATES[0], { ...BUILTIN_TEMPLATES[0], logoPosition: "abajo-derecha" as const }, BUILTIN_TEMPLATES[1], BUILTIN_TEMPLATES[5]];
    for (const style of DESIGN_STYLES) {
      for (const template of pick) {
        const jpg = await renderDesign({ brand: { ...brand, style }, template, headline: "¿Tu techo sufrió daños por la tormenta de anoche?", sub: "Te ayudamos a reclamar lo justo.", cta: "Inspección gratis", steps: ["Llámanos", "Revisamos tu póliza", "Negociamos por ti"], photoUrl, shape: "square" });
        const m = await sharp(jpg).metadata();
        expect([m.width, m.height]).toEqual([1080, 1080]);
      }
    }
  }, 120000);
});
