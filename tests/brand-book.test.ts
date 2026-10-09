import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { BookReplySchema, cropItem, cropRect, dedupe, dHash, hamming, imageHash, normalizeBox, parseBookReply, sameImage } from "@/lib/brand-book-extract";
import { splitBatches } from "@/lib/pdf-pages";

const item = (over: Record<string, unknown> = {}) => ({
  kind: "logo",
  box_2d: [100, 200, 300, 600],
  label: { es: "Logo horizontal", en: "Horizontal logo" },
  note: { es: "Versión principal", en: "Main version" },
  confidence: 0.9,
  ...over,
});

describe("manual de marca: leer la respuesta de la IA", () => {
  it("convierte [ymin, xmin, ymax, xmax] en milésimas a fracciones de la página", () => {
    const [a] = parseBookReply({ items: [item()] });
    expect(a.kind).toBe("logo");
    expect(a.box).toEqual({ x0: 0.2, y0: 0.1, x1: 0.6, y1: 0.3 });
    expect(a.label.es).toBe("Logo horizontal");
  });

  it("ordena las cajas al revés y recorta lo que se sale de la página", () => {
    expect(normalizeBox([300, 600, 100, 200])).toEqual({ x0: 0.2, y0: 0.1, x1: 0.6, y1: 0.3 });
    expect(normalizeBox([-50, -10, 1200, 1005])).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });

  it("acepta fracciones 0–1 si la IA las manda así", () => {
    expect(normalizeBox([0.1, 0.2, 0.3, 0.6])).toEqual({ x0: 0.2, y0: 0.1, x1: 0.6, y1: 0.3 });
    // Enteros 0/1 son milésimas (una caja diminuta): no sirve.
    expect(normalizeBox([0, 0, 1, 1])).toBeNull();
  });

  it("descarta cajas rotas, diminutas, de tipo desconocido o con poca seguridad", () => {
    const out = parseBookReply({
      items: [
        item({ box_2d: [1, 2, 3] }),
        item({ box_2d: [10, 10, "x", 40] }),
        item({ box_2d: [100, 100, 105, 600] }), // una raya
        item({ kind: "kit" }),
        item({ kind: "swatch" }),
        item({ confidence: 0.1 }),
        "basura",
        null,
        item({ kind: "isotype", confidence: 80 }), // en porcentaje
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "isotype", confidence: 0.8 });
  });

  it("pone un nombre si falta y deja como mucho 16 por página, las más seguras primero", () => {
    const many = Array.from({ length: 20 }, (_, i) => item({ kind: "icon", label: { es: "", en: "" }, confidence: 0.4 + i * 0.03 }));
    const out = parseBookReply({ items: many });
    expect(out).toHaveLength(16);
    expect(out[0].confidence).toBeGreaterThan(out[15].confidence);
    expect(out[0].label).toEqual({ es: "Ícono", en: "Icon" });
  });

  it("no se rompe con respuestas vacías o raras", () => {
    expect(parseBookReply(null)).toEqual([]);
    expect(parseBookReply({})).toEqual([]);
    expect(parseBookReply({ items: "no" })).toEqual([]);
  });

  it("el esquema para Gemini no incluye 'kit'", () => {
    expect(BookReplySchema.safeParse({ items: [item({ kind: "kit" })] }).success).toBe(false);
    expect(BookReplySchema.safeParse({ items: [item()] }).success).toBe(true);
  });
});

describe("manual de marca: recorte", () => {
  it("convierte la caja en píxeles con un margen pequeño", () => {
    const r = cropRect({ x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.5 }, 1600, 1200, { pad: 0.03 });
    // 800×300 px; margen = 3 % del lado largo (24) + 2 = 26.
    expect(r).toEqual({ left: 400 - 26, top: 300 - 26, width: 800 + 52, height: 300 + 52 });
  });

  it("no se sale de la imagen", () => {
    const r = cropRect({ x0: 0, y0: 0.9, x1: 0.2, y1: 1 }, 1000, 800)!;
    expect(r.left).toBe(0);
    expect(r.top + r.height).toBeLessThanOrEqual(800);
    expect(r.left + r.width).toBeLessThanOrEqual(1000);
    const full = cropRect({ x0: 0, y0: 0, x1: 1, y1: 1 }, 1000, 800)!;
    expect(full).toEqual({ left: 0, top: 0, width: 1000, height: 800 });
  });

  it("descarta lo muy chico (menos de ~120 px de lado largo, o una raya)", () => {
    expect(cropRect({ x0: 0.1, y0: 0.1, x1: 0.15, y1: 0.15 }, 1600, 1200)).toBeNull();
    expect(cropRect({ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.11 }, 1600, 1200, { pad: 0 })).toBeNull();
    expect(cropRect({ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.14 }, 1600, 1200, { pad: 0 })).not.toBeNull();
  });

  it("recorta un logo de una página y le quita el fondo blanco", async () => {
    // Página blanca de 1000×800 con un "logo" azul de 300×100 en (200, 300).
    const page = await sharp({ create: { width: 1000, height: 800, channels: 3, background: "#ffffff" } })
      .composite([{ input: await sharp({ create: { width: 300, height: 100, channels: 3, background: "#0a5bb5" } }).png().toBuffer(), left: 200, top: 300 }])
      .jpeg()
      .toBuffer();
    const crop = await cropItem(page, { kind: "logo", box: { x0: 0.2, y0: 0.375, x1: 0.5, y1: 0.5 }, label: { es: "Logo", en: "Logo" }, confidence: 0.9 });
    expect(crop).not.toBeNull();
    expect(crop!.contentType).toBe("image/png");
    expect(crop!.transparent).toBe(true);
    expect(crop!.w).toBeGreaterThanOrEqual(300);
    expect(crop!.w).toBeLessThan(360);
    // Un recorte de puro blanco no es nada.
    const blank = await cropItem(page, { kind: "pattern", box: { x0: 0.6, y0: 0.6, x1: 0.95, y1: 0.95 }, label: { es: "x", en: "x" }, confidence: 0.9 });
    expect(blank).toBeNull();
  });
});

describe("manual de marca: no repetir la misma imagen", () => {
  it("la huella tiene 16 cifras y no depende del tamaño", async () => {
    const svg = (w: number, h: number) =>
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 300 100"><rect width="300" height="100" fill="#fff"/><circle cx="60" cy="50" r="40" fill="#c00"/><rect x="120" y="30" width="160" height="40" fill="#123"/></svg>`);
    const a = await imageHash(await sharp(svg(300, 100)).png().toBuffer());
    const b = await imageHash(await sharp(svg(900, 300)).jpeg({ quality: 70 }).toBuffer());
    const other = await imageHash(
      await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="#fff"/><rect x="10" y="10" width="100" height="80" fill="#0a0"/><circle cx="240" cy="50" r="40" fill="#00c"/></svg>`))
        .png()
        .toBuffer(),
    );
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(hamming(a, b)).toBeLessThanOrEqual(6);
    expect(hamming(a, other)).toBeGreaterThan(10);
  });

  it("dHash compara cada punto con el de la derecha", () => {
    const flat = new Array(72).fill(100);
    expect(dHash(flat)).toBe("0000000000000000");
    const falling = Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 10);
    expect(dHash(falling)).toBe("ffffffffffffffff");
    expect(hamming("0000000000000000", "000000000000000f")).toBe(4);
    expect(hamming("abc", "0000000000000000")).toBe(64);
  });

  it("de varias casi iguales se queda la más grande; las aceptadas no se tocan", () => {
    const h = "0f0f0f0f0f0f0f0f";
    const near = "0f0f0f0f0f0f0f0e"; // 1 bit distinto
    const known = [
      { id: "viejo", kind: "logo", hash: h, w: 300, h: 100 },
      { id: "aceptado", kind: "isotype", hash: h, w: 400, h: 400, locked: true },
    ];
    const fresh = [
      { id: "grande", kind: "logo", hash: near, w: 600, h: 200 }, // reemplaza a "viejo"
      { id: "chico", kind: "logo", hash: h, w: 150, h: 50 }, // repetido y más chico
      { id: "iso", kind: "isotype", hash: near, w: 800, h: 800 }, // igual a uno aceptado: no se propone
      { id: "otro-tipo", kind: "logo-light", hash: h, w: 300, h: 100 }, // otro tipo: se queda
      { id: "otra-forma", kind: "logo", hash: h, w: 100, h: 300 }, // vertical: no es el mismo
    ];
    const r = dedupe(known, fresh);
    expect(r.remove).toEqual(["viejo"]);
    expect(r.add.sort()).toEqual(["grande", "otra-forma", "otro-tipo"].sort());
  });

  it("dos nuevas iguales en el mismo envío: solo la más grande", () => {
    const r = dedupe([], [
      { id: "a", kind: "pattern", hash: "ffff0000ffff0000", w: 200, h: 200 },
      { id: "b", kind: "pattern", hash: "ffff0000ffff0001", w: 500, h: 500 },
    ]);
    expect(r).toEqual({ add: ["b"], remove: [] });
    expect(sameImage({ id: "x", kind: "logo", hash: "0", w: 0, h: 0 }, { id: "y", kind: "logo", hash: "0", w: 0, h: 0 })).toBe(false);
  });
});

describe("manual de marca: envíos de a poco", () => {
  const MB = 1024 * 1024;
  it("agrupa de a 3 páginas sin pasar el límite de tamaño", () => {
    const pages = [0.5, 0.5, 0.5, 0.5, 0.5].map((m, i) => ({ page: i + 1, bytes: m * MB }));
    expect(splitBatches(pages, 3.4 * MB, 3).map((b) => b.map((p) => p.page))).toEqual([[1, 2, 3], [4, 5]]);
  });

  it("corta antes si las páginas pesan mucho", () => {
    const pages = [1.5, 1.5, 1.5, 0.2].map((m, i) => ({ page: i + 1, bytes: m * MB }));
    const out = splitBatches(pages, 3.4 * MB, 3);
    expect(out.map((b) => b.map((p) => p.page))).toEqual([[1, 2], [3, 4]]);
    for (const b of out) expect(b.reduce((n, p) => n + p.bytes, 0)).toBeLessThanOrEqual(3.4 * MB);
  });

  it("una página más grande que el límite va sola, y sin páginas no hay envíos", () => {
    const out = splitBatches([{ bytes: 5 * MB }, { bytes: 0.1 * MB }], 3.4 * MB, 3);
    expect(out.map((b) => b.length)).toEqual([1, 1]);
    expect(splitBatches([], 3.4 * MB, 3)).toEqual([]);
  });
});
