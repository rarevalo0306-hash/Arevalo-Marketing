import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { adaptPlan, CHANNEL_FORMATS, formatFor, formatKey, STORY_FORMAT } from "@/lib/formats";
import { DESIGN_SHAPES } from "@/lib/design-shapes";
import { focusCropBox, smartCrop } from "@/lib/post-crop";

// Una foto ancha (16:9) con lo importante cerca del borde derecho.
const IW = 1600;
const IH = 900;
const SUBJECT = { x: 0.85, y: 0.5 };
const RATIOS: [string, number, number][] = [
  ["Instagram 4:5", 1080, 1350],
  ["Historia 9:16", 1080, 1920],
  ["Cuadrada 1:1", 1080, 1080],
  ["Google 4:3", 1200, 900],
  ["LinkedIn 1.91:1", 1200, 628],
  ["X 16:9", 1600, 900],
];

describe("recorte con punto importante", () => {
  for (const [name, w, h] of RATIOS) {
    it(`${name}: el punto queda dentro y el recorte no se sale de la foto`, () => {
      const b = focusCropBox(IW, IH, w, h, SUBJECT);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.left + b.width).toBeLessThanOrEqual(IW);
      expect(b.top + b.height).toBeLessThanOrEqual(IH);
      expect(Math.abs(b.width / b.height - w / h)).toBeLessThan(0.01);
      const fx = SUBJECT.x * IW;
      const fy = SUBJECT.y * IH;
      expect(fx).toBeGreaterThanOrEqual(b.left);
      expect(fx).toBeLessThanOrEqual(b.left + b.width);
      expect(fy).toBeGreaterThanOrEqual(b.top);
      expect(fy).toBeLessThanOrEqual(b.top + b.height);
    });
  }
  it("un punto en la esquina pega el recorte a ese borde", () => {
    const b = focusCropBox(IW, IH, 1080, 1920, { x: 1, y: 0 });
    expect(b.left + b.width).toBe(IW);
    expect(b.top).toBe(0);
  });
  it("el punto en el centro centra el recorte", () => {
    const b = focusCropBox(IW, IH, 1080, 1080, { x: 0.5, y: 0.5 });
    expect(b.left).toBe(Math.round((IW - 900) / 2));
  });

  it("la foto recortada sigue mostrando el sujeto (para cada forma)", async () => {
    // Fondo gris con un cuadrado rojo (el sujeto) cerca del borde derecho.
    const red = await sharp({ create: { width: 120, height: 120, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const photo = await sharp({ create: { width: IW, height: IH, channels: 3, background: "#808080" } })
      .composite([{ input: red, left: Math.round(SUBJECT.x * IW) - 60, top: Math.round(SUBJECT.y * IH) - 60 }])
      .jpeg()
      .toBuffer();
    for (const [, w, h] of RATIOS) {
      const out = await smartCrop(photo, w, h, SUBJECT);
      const meta = await sharp(out).metadata();
      expect([meta.width, meta.height]).toEqual([w, h]);
      const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
      let reds = 0;
      for (let i = 0; i < data.length; i += info.channels) if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) reds++;
      // Al menos la mitad del sujeto (escalado) sigue en la foto.
      const scale = Math.max(w / IW, h / IH);
      expect(reds).toBeGreaterThan(0.5 * (120 * scale) ** 2);
    }
  });
});

describe("tamaño de cada red", () => {
  it("Instagram 4:5, Facebook 4:5, LinkedIn 1:1, X 16:9, Google 4:3", () => {
    const size = (c: string) => DESIGN_SHAPES[CHANNEL_FORMATS[c]!.shape];
    expect(size("instagram")).toMatchObject({ w: 1080, h: 1350 });
    expect(size("facebook")).toMatchObject({ w: 1080, h: 1350 });
    expect(size("linkedin")).toMatchObject({ w: 1080, h: 1080 });
    expect(size("x")).toMatchObject({ w: 1600, h: 900 });
    expect(size("google")).toMatchObject({ w: 1200, h: 900 });
  });
  it("historias de Instagram y Facebook: 9:16 (1080×1920)", () => {
    expect(formatKey("instagram", "story")).toBe("instagram:story");
    expect(formatKey("linkedin", "story")).toBe("linkedin");
    expect(formatKey("instagram", "carousel")).toBe("instagram");
    expect(formatFor("instagram:story")).toBe(STORY_FORMAT);
    expect(formatFor("facebook:story")).toBe(STORY_FORMAT);
    expect(formatFor("x:story")).toBeNull();
    expect(DESIGN_SHAPES[STORY_FORMAT.shape]).toMatchObject({ w: 1080, h: 1920 });
  });
  it("con punto importante se recorta un poco más; sin él, se centra sobre fondo", () => {
    const ig = formatFor("instagram")!;
    // 16:9 → 4:5 deja 45% de la foto.
    expect(adaptPlan(16 / 9, ig, { hasText: false })).toBe("fit");
    expect(adaptPlan(16 / 9, ig, { hasText: false, focus: true })).toBe("crop");
    // 16:9 → 9:16 perdería demasiado: se centra sobre fondo aunque haya punto.
    expect(adaptPlan(16 / 9, STORY_FORMAT, { hasText: false, focus: true, exact: true })).toBe("fit");
    // Historias: tamaño exacto.
    expect(adaptPlan(4 / 5, STORY_FORMAT, { hasText: true, exact: true })).toBe("fit");
    expect(adaptPlan(9 / 16, STORY_FORMAT, { hasText: true, exact: true })).toBe("keep");
  });
});
