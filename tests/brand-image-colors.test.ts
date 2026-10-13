import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { logoColors } from "@/lib/brand-image";

describe("colores del logo para la IA", () => {
  it("saca los colores del logo sin el fondo blanco", async () => {
    // Logo sobre fondo blanco: un bloque azul grande y uno turquesa.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#ffffff"/><rect x="20" y="20" width="240" height="160" fill="#1569bb"/><rect x="280" y="60" width="100" height="100" fill="#3dbdb5"/></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const colors = await logoColors(png);
    expect(colors[0]).toBe("#1569bb");
    expect(colors).toContain("#3dbdb5");
    expect(colors).not.toContain("#ffffff");
  });

  it("una foto (sin fondo liso) no da colores", async () => {
    const noisy = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 60 } } }).png().toBuffer();
    expect(await logoColors(noisy)).toEqual([]);
  });
});
