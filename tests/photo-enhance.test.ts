import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  applyTone,
  blurBoxes,
  chooseRotation,
  detectTilt,
  enhancePhoto,
  inscribed,
  mapBox,
  pixelStats,
  safeTone,
  whiteBalanceGains,
  type Raw,
} from "@/lib/photo-enhance";
import { coveredFlags, costWords, hintsFromAnswer, libraryPhotoUrl, readEnhanceInfo, readHints, stepWords, type EnhanceHints } from "@/lib/photo-enhance-shape";

// ---------- Fotos de prueba hechas con sharp ----------

/** Una «cortina metálica»: fondo con degradado, franjas horizontales (las láminas) y un marco, con algo de textura. */
async function doorScene(w = 900, h = 640, tint: [number, number, number] = [1, 1, 1], light = 1): Promise<Buffer> {
  const data = Buffer.alloc(w * h * 3);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inDoor = x > w * 0.2 && x < w * 0.8 && y > h * 0.15 && y < h * 0.9;
      const slat = inDoor && Math.floor(y / 18) % 2 === 0;
      let base = inDoor ? (slat ? 170 : 120) : 60 + (y / h) * 80;
      // Un objeto de color (para que haya algo que mirar).
      const red = (x - w * 0.5) ** 2 + (y - h * 0.5) ** 2 < (h * 0.08) ** 2;
      base += (rnd() - 0.5) * 10;
      const rgb = red ? [190, 60, 50] : [base, base * 0.98, base * 0.95];
      for (let c = 0; c < 3; c++) data[(y * w + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(rgb[c] * tint[c] * light)));
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

async function raw(buf: Buffer): Promise<Raw> {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** La misma escena girada `deg` grados (a la derecha) y recortada para que no se vean esquinas negras. */
async function tilted(deg: number): Promise<Buffer> {
  const src = await doorScene(1100, 800);
  const rot = await sharp(src).rotate(deg, { background: "#000" }).toBuffer({ resolveWithObject: true });
  const size = inscribed(1100, 800, deg);
  return sharp(rot.data)
    .extract({ left: Math.round((rot.info.width - size.w) / 2), top: Math.round((rot.info.height - size.h) / 2), width: size.w, height: size.h })
    .jpeg({ quality: 92 })
    .toBuffer();
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ---------- Enderezar ----------

describe("enderezar", () => {
  it("encuentra la inclinación de las líneas y la corrige al revés", async () => {
    const t = detectTilt(await raw(await sharp(await tilted(4)).resize(480).toBuffer()));
    expect(t.confidence).toBeGreaterThan(0.3);
    expect(near(t.deg, 4, 0.3)).toBe(true);
    expect(near(chooseRotation(t, null), -4, 0.3)).toBe(true);
    const t2 = detectTilt(await raw(await sharp(await tilted(-3)).resize(480).toBuffer()));
    expect(near(t2.deg, -3, 0.3)).toBe(true);
  });

  it("una foto derecha no se gira", async () => {
    const t = detectTilt(await raw(await sharp(await doorScene()).resize(480).toBuffer()));
    expect(Math.abs(t.deg)).toBeLessThan(0.5);
    expect(chooseRotation(t, null)).toBe(0);
  });

  it("no gira si la IA y las líneas no están de acuerdo, ni por ángulos grandes", () => {
    expect(chooseRotation({ deg: 4, confidence: 0.6 }, 4)).toBe(0);
    expect(chooseRotation({ deg: 4, confidence: 0.6 }, -4.5)).toBe(-4);
    expect(chooseRotation({ deg: 12, confidence: 0.9 }, null)).toBe(0);
    expect(chooseRotation({ deg: 0.2, confidence: 0.9 }, null)).toBe(0);
    // Solo la IA, sin líneas que apunten igual: nada.
    expect(chooseRotation(null, 3)).toBe(0);
    expect(chooseRotation({ deg: 1.5, confidence: 0.05 }, -2)).toBe(0);
    // Líneas débiles que van para el mismo lado: se usa lo de la IA.
    expect(chooseRotation({ deg: -1.6, confidence: 0.2 }, 2)).toBe(2);
  });

  it("el recorte al enderezar es de la misma forma y no muy chico", () => {
    const r = inscribed(4000, 3000, 4);
    expect(near(r.w / r.h, 4 / 3, 0.01)).toBe(true);
    expect(r.w).toBeGreaterThan(4000 * 0.88);
  });
});

// ---------- Luz y color ----------

describe("luz y color", () => {
  it("una foto oscura sale con más luz, sin quemarla", async () => {
    const dark = await raw(await doorScene(600, 420, [1, 1, 1], 0.4));
    const before = pixelStats(dark);
    const { plan, after } = safeTone(dark);
    expect(after.mean).toBeGreaterThan(before.mean + 15);
    expect(after.clipHigh).toBeLessThan(0.03);
    expect(plan.gamma).toBeLessThan(1);
  });

  it("corrige un tono naranja hacia gris, sin pasarse", async () => {
    const cast = await raw(await doorScene(600, 420, [1.18, 1, 0.78]));
    const s = pixelStats(cast);
    const g = whiteBalanceGains(s);
    expect(g[0]).toBeLessThan(1);
    expect(g[2]).toBeGreaterThan(1);
    const after = pixelStats(applyTone(cast, { gains: g, lo: 0, scale: 1, base: 0, gamma: 1, vibrance: 0 }));
    const spread = (m: number[]) => Math.max(...m) - Math.min(...m);
    expect(spread(after.neutral ?? after.means)).toBeLessThan(spread(s.neutral ?? s.means) * 0.6);
    for (const x of g) expect(x).toBeGreaterThanOrEqual(0.75);
  });

  it("una foto ya buena casi no cambia", async () => {
    const good = await raw(await sharp(await doorScene()).linear(1.35, -30).toBuffer());
    const { before, after } = safeTone(good);
    expect(Math.abs(after.mean - before.mean)).toBeLessThan(25);
  });
});

// ---------- Tapar datos privados ----------

describe("tapar datos privados", () => {
  it("solo cambia dentro de la caja (y su borde suave)", async () => {
    const src = await raw(await doorScene(800, 600));
    const box = { x: 0.4, y: 0.4, w: 0.2, h: 0.1 };
    const out = await blurBoxes(src, [box]);
    expect(out.w).toBe(800);
    expect(out.h).toBe(600);
    const pad = Math.max(4, Math.round(0.08 * 160)) + 1;
    let insideDiff = 0;
    let outsideChanged = 0;
    for (let y = 0; y < 600; y++) {
      for (let x = 0; x < 800; x++) {
        const i = (y * 800 + x) * 3;
        const d = Math.abs(out.data[i] - src.data[i]) + Math.abs(out.data[i + 1] - src.data[i + 1]) + Math.abs(out.data[i + 2] - src.data[i + 2]);
        const inBox = x >= 320 && x < 480 && y >= 240 && y < 300;
        const inPad = x >= 320 - pad && x < 480 + pad && y >= 240 - pad && y < 300 + pad;
        if (inBox) insideDiff += d;
        else if (!inPad && d) outsideChanged++;
      }
    }
    expect(outsideChanged).toBe(0);
    // Las franjas (detalle) dentro de la caja desaparecen: cambió mucho.
    expect(insideDiff / (160 * 60)).toBeGreaterThan(15);
  });

  it("la caja tapada ya no tiene detalle", async () => {
    const src = await raw(await doorScene(800, 600));
    const out = await blurBoxes(src, [{ x: 0.3, y: 0.3, w: 0.3, h: 0.2 }]);
    const sd = (r: Raw) => {
      const v: number[] = [];
      for (let y = 200; y < 290; y++) for (let x = 260; x < 460; x++) v.push(r.data[(y * 800 + x) * 3]);
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
    };
    expect(sd(out)).toBeLessThan(sd(src) * 0.5);
  });
});

// ---------- Todo junto ----------

describe("enhancePhoto", () => {
  it("una foto girada sale derecha, del mismo tamaño casi, y dice lo que hizo", async () => {
    const input = await tilted(3);
    const meta = await sharp(input).metadata();
    const r = await enhancePhoto(input);
    expect(r.steps.find((s) => s.kind === "straighten")?.value).toBeCloseTo(-3, 0);
    expect(r.width).toBeGreaterThan(meta.width! * 0.85);
    expect(r.height).toBeGreaterThan(meta.height! * 0.85);
    expect(r.width).toBeLessThanOrEqual(meta.width!);
    expect(near(r.width / r.height, meta.width! / meta.height!, 0.02)).toBe(true);
    const out = await sharp(r.data).metadata();
    expect(out.format).toBe("jpeg");
    expect(out.exif).toBeUndefined();
    const thumb = await sharp(r.thumb).metadata();
    expect(Math.max(thumb.width!, thumb.height!)).toBeLessThanOrEqual(512);
  });

  it("nunca agranda y achica las muy grandes a 2560 px", async () => {
    const big = await sharp({ create: { width: 3200, height: 1800, channels: 3, background: { r: 120, g: 130, b: 140 } } }).jpeg().toBuffer();
    const r = await enhancePhoto(big);
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(2560);
    expect(r.width).toBeGreaterThan(2400);
    const small = await enhancePhoto(await doorScene(320, 240));
    expect(small.width).toBe(320);
    expect(small.height).toBe(240);
    expect(small.original).toEqual({ w: 320, h: 240 });
  });

  it("gira según la cámara (EXIF) y no deja datos de GPS", async () => {
    const src = await sharp(await doorScene(400, 300)).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const r = await enhancePhoto(src);
    expect(r.width).toBe(300);
    expect(r.height).toBe(400);
    expect(r.steps.some((s) => s.kind === "orient")).toBe(true);
    const meta = await sharp(r.data).metadata();
    expect(meta.orientation).toBeUndefined();
  });

  it("una foto oscura y con tono naranja mejora la luz y el color", async () => {
    const r = await enhancePhoto(await doorScene(800, 560, [1.15, 1, 0.8], 0.45));
    const kinds = r.steps.map((s) => s.kind);
    expect(kinds).toContain("light");
    expect(kinds).toContain("whiteBalance");
    expect(stepWords(r.steps, "es")).toContain("Más luz");
    expect(stepWords(r.steps, "es")).toContain("Colores más naturales");
  });

  it("tapa las cajas de la IA y las cuenta en la mejorada; el centro de la IA se usa", async () => {
    const hints: EnhanceHints = {
      rotate: null,
      focus: { x: 0.3, y: 0.6 },
      hide: [{ reason: "plate", box: { x: 0.6, y: 0.7, w: 0.15, h: 0.08 } }],
      from: "review",
      model: "gemini",
      at: "",
    };
    const r = await enhancePhoto(await doorScene(800, 600), { hints });
    const blur = r.steps.find((s) => s.kind === "blur");
    expect(blur?.reason).toBe("plate");
    expect(blur?.box?.x).toBeCloseTo(0.6, 2);
    expect(r.focusFrom).toBe("ai");
    expect(r.focus).toEqual({ x: 0.3, y: 0.6 });
    expect(stepWords(r.steps, "es")).toContain("Placa tapada");
  });

  it("sin IA, el centro lo encuentra sharp", async () => {
    const r = await enhancePhoto(await doorScene(800, 600));
    expect(r.focusFrom).toBe("auto");
    expect(r.focus.x).toBeGreaterThanOrEqual(0);
    expect(r.focus.x).toBeLessThanOrEqual(1);
  });

  it("quita bordes negros parejos (como una captura) pero no toca una foto normal", async () => {
    const inner = await doorScene(600, 400);
    const boxed = await sharp(inner).extend({ top: 80, bottom: 80, background: "#000" }).jpeg().toBuffer();
    const r = await enhancePhoto(boxed);
    expect(r.steps.some((s) => s.kind === "crop" && s.why === "border")).toBe(true);
    expect(r.height).toBeLessThan(420);
    expect(r.height).toBeGreaterThan(380);
    const plain = await enhancePhoto(inner);
    expect(plain.steps.some((s) => s.kind === "crop")).toBe(false);
  });
});

describe("mapBox", () => {
  it("pasa una caja al nuevo marco y la recorta a la foto", () => {
    expect(mapBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, (p) => p)).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
    expect(mapBox({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, (p) => ({ x: p.x + 0.5, y: p.y }))).toBeNull();
  });
});

// ---------- Forma guardada ----------

describe("readEnhanceInfo", () => {
  it("tolera basura y valores fuera de rango", () => {
    expect(readEnhanceInfo(null)).toBeNull();
    expect(readEnhanceInfo("x")).toBeNull();
    expect(readEnhanceInfo([])).toBeNull();
    const info = readEnhanceInfo({
      v: 1,
      at: "2026-10-08T00:00:00Z",
      steps: [
        { kind: "light", value: "12" },
        { kind: "magic" },
        { kind: "blur", reason: "plate", box: { x: 0.2, y: 0.2, w: 2, h: 0.1 } },
        { kind: "blur", reason: "aliens", box: { x: 0, y: 0, w: 0.1, h: 0.1 } },
        { kind: "blur", reason: "face" },
        "nope",
      ],
      focus: { x: 3, y: -1 },
      focusFrom: "ai",
      original: { w: 4000, h: "3000" },
      ai: { model: "gemini", costUsd: -5 },
      hints: { rotate: 99, hide: [{ reason: "plate", box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }, { reason: "x" }] },
    })!;
    expect(info.steps).toEqual([
      { kind: "light", value: 12 },
      { kind: "blur", reason: "plate", box: { x: 0.2, y: 0.2, w: 0.8, h: 0.1 } },
    ]);
    expect(info.focus).toEqual({ x: 1, y: 0 });
    expect(info.original).toEqual({ w: 4000, h: 3000 });
    expect(info.enhanced).toEqual({ w: 0, h: 0 });
    expect(info.ai).toEqual({ model: "gemini", costUsd: 0 });
    expect(info.hints?.rotate).toBe(45);
    expect(info.hints?.hide).toHaveLength(1);
    expect(info.error).toBe("");
  });

  it("readHints sin nada útil", () => {
    expect(readHints(undefined)).toBeNull();
    expect(readHints({})).toEqual({ rotate: null, focus: null, hide: [], from: "review", model: "", at: "" });
  });
});

describe("libraryPhotoUrl", () => {
  it("la mejorada si existe y el dueño no eligió la original", () => {
    expect(libraryPhotoUrl({ url: "/media/a.jpg", enhancedUrl: "/media/b.jpg", useEnhanced: true })).toBe("/media/b.jpg");
    expect(libraryPhotoUrl({ url: "/media/a.jpg", enhancedUrl: "/media/b.jpg" })).toBe("/media/b.jpg");
    expect(libraryPhotoUrl({ url: "/media/a.jpg", enhancedUrl: "/media/b.jpg", useEnhanced: false })).toBe("/media/a.jpg");
    expect(libraryPhotoUrl({ url: "/media/a.jpg", enhancedUrl: "", useEnhanced: true })).toBe("/media/a.jpg");
    expect(libraryPhotoUrl({ url: "/media/a.jpg" })).toBe("/media/a.jpg");
  });
});

describe("palabras", () => {
  it("dice lo que se hizo sin repetir", () => {
    const words = stepWords(
      [
        { kind: "straighten", value: -2.04 },
        { kind: "crop", why: "straighten" },
        { kind: "light", value: 20 },
        { kind: "blur", reason: "plate", box: { x: 0, y: 0, w: 0.1, h: 0.1 } },
        { kind: "blur", reason: "plate", box: { x: 0.5, y: 0, w: 0.1, h: 0.1 } },
      ],
      "es",
    );
    expect(words).toEqual(["Enderezada 2°", "Recortada al enderezar", "Más luz", "Placa tapada"]);
    expect(stepWords([{ kind: "whiteBalance", value: 8 }], "en")).toEqual(["More natural colors"]);
  });

  it("qué avisos de privacidad tapa la mejorada (solo para mostrar)", () => {
    const info = readEnhanceInfo({ steps: [{ kind: "blur", reason: "face", box: { x: 0, y: 0, w: 0.1, h: 0.1 } }] });
    expect(coveredFlags(["faces", "plate", "child"], info)).toEqual(["faces", "child"]);
    expect(coveredFlags(["plate"], null)).toEqual([]);
  });

  it("el costo en palabras", () => {
    expect(costWords(null, "es")).toBe("Sin IA (gratis)");
    expect(costWords({ model: "g", costUsd: 0 }, "en")).toMatch(/no extra cost/);
    expect(costWords({ model: "g", costUsd: 0.0008 }, "es")).toBe("IA ≈ US$0.0008");
  });
});

describe("hintsFromAnswer", () => {
  const at = new Date("2026-10-08T00:00:00Z");
  it("pasa las cajas de Gemini ([ymin, xmin, ymax, xmax] de 0 a 1000) a 0–1 y descarta lo raro", () => {
    const h = hintsFromAnswer(
      {
        straighten: 2.34,
        focusX: 0.4,
        focusY: 0.55,
        hide: [
          { what: "plate", box: [700, 600, 780, 750] },
          { what: "face", box: [100, 100] },
          { what: "logo", box: [0, 0, 100, 100] },
          { what: "address", box: [0, 0, 900, 900] },
          { what: "document", box: [300, 400, 200, 300] },
        ],
      },
      "review",
      "gemini-flash-latest",
      at,
    )!;
    expect(h.rotate).toBe(2.3);
    expect(h.focus).toEqual({ x: 0.4, y: 0.55 });
    expect(h.hide).toHaveLength(2);
    expect(h.hide[0].reason).toBe("plate");
    expect(h.hide[0].box.x).toBeCloseTo(0.6);
    expect(h.hide[0].box.y).toBeCloseTo(0.7);
    expect(h.hide[0].box.w).toBeCloseTo(0.15);
    expect(h.hide[0].box.h).toBeCloseTo(0.08);
    // Caja al revés: se ordena.
    expect(h.hide[1]).toMatchObject({ reason: "document", box: { x: 0.3, y: 0.2 } });
    expect(h.at).toBe(at.toISOString());
  });

  it("una respuesta sin estos campos no trae indicaciones; ángulos absurdos no se usan", () => {
    expect(hintsFromAnswer({ es: "x" }, "review", "g")).toBeNull();
    expect(hintsFromAnswer(null, "review", "g")).toBeNull();
    expect(hintsFromAnswer({ straighten: 40, focusX: 0, focusY: 0, hide: [] }, "enhance", "g")).toMatchObject({ rotate: null, focus: null, hide: [], from: "enhance" });
  });
});
