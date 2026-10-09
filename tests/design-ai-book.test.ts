import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BOOK_SYSTEM, isSocialAsset, itemPriority, mergeGridCells, parseBookReply, pieceOfRatio, sortByPriority, splitGrid, type BookItem } from "@/lib/brand-book-extract";
import {
  CLEAN_PROMPT,
  DESIGN_MODELS,
  editModels,
  falEditRequest,
  falRequest,
  ideogramEditRequest,
  inkFromColor,
  masterPrompt,
  nearestShape,
  resolveBookAreas,
  submitEdit,
  textPatches,
  type MasterBrief,
} from "@/lib/design-ai";
import { isMaster, customBase, pickTemplate } from "@/lib/design-shapes";

const model = (id: string) => DESIGN_MODELS.find((m) => m.id === id)!;
const brief: MasterBrief = { name: "Ricardo Public Adjusters", about: "Public adjusters in Florida.", color: "#1d4ed8", color2: "#0ea5b7" };
afterEach(() => vi.unstubAllGlobals());

describe("manual: plantillas de redes como pieza propia", () => {
  it("el pedido a Gemini busca los posts de redes y no los salta por tener texto", () => {
    expect(BOOK_SYSTEM).toMatch(/SOCIAL MEDIA pieces/);
    expect(BOOK_SYSTEM).toMatch(/EACH post separately/);
    expect(BOOK_SYSTEM).toMatch(/never skip finished social media posts/);
    expect(BOOK_SYSTEM).not.toMatch(/pages that only have text\./);
  });
  it("lee la pieza (solo en template) y lo desconocido queda como other", () => {
    const box = [100, 100, 400, 400];
    const out = parseBookReply({
      items: [
        { kind: "template", piece: "story", box_2d: box, label: { es: "Historia", en: "Story" }, confidence: 0.8 },
        { kind: "template", piece: "rocket", box_2d: [500, 500, 900, 900], label: { es: "X", en: "X" }, confidence: 0.8 },
        { kind: "logo", piece: "social-post", box_2d: [0, 0, 100, 300], label: { es: "Logo", en: "Logo" }, confidence: 0.9 },
      ],
    });
    expect(out.find((i) => i.label.es === "Historia")?.piece).toBe("story");
    expect(out.find((i) => i.label.es === "X")?.piece).toBe("other");
    expect(out.find((i) => i.kind === "logo")?.piece).toBeUndefined();
  });
  it("las plantillas de redes van primero, las tarjetas al final", () => {
    const list = sortByPriority([
      { kind: "template", piece: "business-card", confidence: 0.99 },
      { kind: "logo", confidence: 0.7 },
      { kind: "template", piece: "social-post", confidence: 0.5 },
      { kind: "pattern", confidence: 0.95 },
    ]);
    expect(list.map((i) => i.piece ?? i.kind)).toEqual(["social-post", "logo", "pattern", "business-card"]);
    expect(itemPriority({ kind: "template", piece: "story", confidence: 0 })).toBeGreaterThan(itemPriority({ kind: "logo", confidence: 1 }));
  });
  it("solo las piezas de redes se convierten en plantillas (también las viejas sin dato, por su forma)", () => {
    expect(isSocialAsset({ kind: "template", format: "social-post", w: 800, h: 800 })).toBe(true);
    expect(isSocialAsset({ kind: "template", format: "business-card", w: 800, h: 800 })).toBe(false);
    expect(isSocialAsset({ kind: "template", w: 1000, h: 1000 })).toBe(true);
    expect(isSocialAsset({ kind: "template", w: 1750, h: 1000 })).toBe(false);
    expect(isSocialAsset({ kind: "template", w: 707, h: 1000 })).toBe(false);
    expect(isSocialAsset({ kind: "photo", w: 1000, h: 1000 })).toBe(false);
    expect(pieceOfRatio(1080, 1920)).toBe("story");
    expect(pieceOfRatio(1200, 630)).toBe("cover");
  });
});

/** Página sintética: un título arriba, 2 filas × 3 posts y una fila de íconos chicos abajo. */
function gridPage(): { data: Uint8Array; w: number; h: number; posts: { x0: number; y0: number; x1: number; y1: number }[] } {
  const w = 620;
  const h = 560;
  const data = new Uint8Array(w * h * 3).fill(248);
  const fill = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set(c, (y * w + x) * 3);
  };
  fill(20, 10, 400, 30, [30, 60, 160]); // título
  const posts = [];
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++) {
      const x0 = 20 + c * 200;
      const y0 = 50 + r * 200;
      fill(x0, y0, x0 + 180, y0 + 180, [20, 60, 150]);
      fill(x0 + 10, y0 + 10, x0 + 170, y0 + 100, [200, 140, 90]); // la foto de ejemplo
      fill(x0, y0 + 150, x0 + 180, y0 + 180, [255, 255, 255]); // pie blanco del post
      fill(x0 + 10, y0 + 160, x0 + 60, y0 + 172, [30, 60, 160]); // logo
      posts.push({ x0: x0 / w, y0: y0 / h, x1: (x0 + 180) / w, y1: (y0 + 180) / h });
    }
  for (let i = 0; i < 6; i++) fill(30 + i * 60, 470, 60 + i * 60, 500, [30, 60, 160]); // íconos de formatos
  return { data, w, h, posts };
}

describe("cuadrícula de posts", () => {
  it("parte la página en los posts exactos e ignora título e íconos", () => {
    const g = gridPage();
    const cells = splitGrid(g.data, g.w, g.h);
    expect(cells).toHaveLength(6);
    for (const [i, c] of cells.entries()) {
      expect(c.x0).toBeCloseTo(g.posts[i].x0, 2);
      expect(c.y0).toBeCloseTo(g.posts[i].y0, 2);
      expect(c.x1).toBeCloseTo(g.posts[i].x1, 2);
      // El borde blanco de abajo del post puede quedar en la canaleta (unos píxeles).
      expect(Math.abs(c.y1 - g.posts[i].y1)).toBeLessThan(0.02);
    }
    expect(splitGrid(new Uint8Array(100 * 100 * 3).fill(250), 100, 100)).toEqual([]);
  });
  it("las celdas reemplazan una caja de la IA que abarca toda la cuadrícula, y suman las que no vio", () => {
    const g = gridPage();
    const cells = splitGrid(g.data, g.w, g.h);
    const ai: BookItem[] = [
      { kind: "template", piece: "social-post", box: { x0: 0.02, y0: 0.08, x1: 0.98, y1: 0.8 }, label: { es: "Plantillas", en: "Templates" }, confidence: 0.9 },
      { kind: "template", piece: "social-post", box: { ...cells[0], x1: cells[0].x1 + 0.01 }, label: { es: "Daños", en: "Damage" }, confidence: 0.8 },
      { kind: "logo", box: { x0: 0.03, y0: 0.01, x1: 0.3, y1: 0.06 }, label: { es: "Logo", en: "Logo" }, confidence: 0.9 },
    ];
    const out = mergeGridCells(ai, cells, g.w, g.h);
    const posts = out.filter((i) => i.kind === "template");
    expect(posts).toHaveLength(6);
    expect(posts.find((p) => p.label.es === "Daños")?.box).toEqual(cells[0]);
    expect(posts.some((p) => p.label.es === "Plantillas")).toBe(false);
    expect(out.some((i) => i.kind === "logo")).toBe(true);
    // Sin ninguna pieza de redes de la IA, no se inventan plantillas.
    expect(mergeGridCells([ai[2]], cells, g.w, g.h)).toEqual([ai[2]]);
  });
});

describe("convertir una pieza: pedidos de edición", () => {
  it("modelos de edición: el mejor primero, solo con su clave", () => {
    expect(editModels({}).map((m) => m.id)).toEqual([]);
    expect(editModels({ FAL_KEY: "k" }).map((m) => m.id)).toEqual(["nano-banana-pro", "gpt-image-2"]);
    expect(editModels({ FAL_KEY: "k", IDEOGRAM_API_KEY: "i" })[0].id).toBe("ideogram");
  });
  it("el pedido pide quitar el texto, poner la caja gris y no tocar el logo", () => {
    expect(CLEAN_PROMPT).toMatch(/#D9D9D9/);
    expect(CLEAN_PROMPT).toMatch(/Remove all the example text/);
    expect(CLEAN_PROMPT).toMatch(/Do not change the logo/);
    const nano = falEditRequest(model("nano-banana-pro"), "https://x/p.png");
    expect(nano.endpoint).toBe("fal-ai/nano-banana-pro/edit");
    expect(nano.input).toMatchObject({ image_urls: ["https://x/p.png"], aspect_ratio: "auto", prompt: CLEAN_PROMPT });
    const gpt = falEditRequest(model("gpt-image-2"), "data:image/png;base64,AAA");
    expect(gpt.endpoint).toBe("fal-ai/gpt-image-2/image-to-image");
    expect(gpt.input).toMatchObject({ image_size: "auto", quality: "high" });
    expect(() => falEditRequest(model("recraft-v4-pro"), "x")).toThrow();
    const { url, init } = ideogramEditRequest(model("ideogram"), { data: Buffer.from([1, 2]), type: "image/png" }, "KEY");
    expect(url).toBe("https://api.ideogram.ai/v2/image/precise-edit/ideogram-4-5");
    const form = init.body as FormData;
    expect(form.get("prompt")).toBe(CLEAN_PROMPT);
    expect(form.get("async")).toBe("true");
    expect(form.get("image")).toBeInstanceOf(Blob);
    expect((init.headers as Record<string, string>)["Api-Key"]).toBe("KEY");
  });
  it("submitEdit con fetch simulado (Ideogram y fal.ai)", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(url.includes("ideogram") ? { generation_id: "gen_1" } : { status_url: "https://queue.fal.run/a/requests/1/status", response_url: "https://queue.fal.run/a/requests/1" }), { status: 200 });
    }));
    const img = { url: "https://x/p.png", data: Buffer.from([1]), type: "image/png" };
    expect(await submitEdit(model("ideogram"), img, { IDEOGRAM_API_KEY: "S" })).toEqual({ kind: "ideogram", id: "gen_1" });
    vi.stubEnv("FAL_KEY", "F");
    const job = await submitEdit(model("nano-banana-pro"), img, { FAL_KEY: "F" });
    vi.unstubAllEnvs();
    expect(job.kind).toBe("fal");
    expect(calls[1].url).toBe("https://queue.fal.run/fal-ai/nano-banana-pro/edit");
    expect(JSON.parse(String(calls[1].init?.body)).image_urls).toEqual(["https://x/p.png"]);
    await expect(submitEdit(model("ideogram"), img, {})).rejects.toThrow(/IDEOGRAM_API_KEY/);
  });
});

describe("convertir una pieza: cajas, letras y plan sin IA de edición", () => {
  const det = {
    photos: [{ x: 0, y: 0, w: 1, h: 0.55 }],
    headline: { x: 0.06, y: 0.58, w: 0.7, h: 0.12 },
    headlineColor: "#1d4ed8",
    texts: [
      { x: 0.06, y: 0.58, w: 0.7, h: 0.12 },
      { x: 0.06, y: 0.72, w: 0.6, h: 0.05 },
      { x: 0.1, y: 0.2, w: 0.3, h: 0.05 }, // texto sobre la foto: lo tapa la foto nueva
    ],
    hasLogo: true,
    textAlign: "left" as const,
  };
  it("el titular va donde lo puso el diseñador, la foto en la caja gris, y el logo del diseñador se queda", () => {
    const cleaned = { photoBox: { x: 0.02, y: 0.02, w: 0.96, h: 0.52 }, textBox: { x: 0.1, y: 0.8, w: 0.8, h: 0.1 }, logoBox: { x: 0.7, y: 0.9, w: 0.25, h: 0.06 }, photoRadius: 0, textAlign: "izquierda" as const, by: "pixels" as const, needsAdjust: true, textInImage: [] };
    const a = resolveBookAreas({ book: det, cleaned, shape: "square" });
    expect(a.photoBox).toEqual(cleaned.photoBox);
    expect(a.textBox.y).toBeLessThan(0.58);
    expect(a.textBox.h).toBeGreaterThan(det.headline.h);
    expect(a.logoBox).toBeNull();
    expect(a.needsAdjust).toBe(false);
    const noBook = resolveBookAreas({ book: null, cleaned: null, shape: "story" });
    expect(noBook.needsAdjust).toBe(true);
    expect(noBook.logoBox).toBeNull();
    expect(resolveBookAreas({ book: { ...det, hasLogo: false }, cleaned, shape: "square" }).logoBox).not.toBeNull();
  });
  it("tapa solo el texto que no queda bajo la foto nueva", () => {
    const p = textPatches(det);
    expect(p).toHaveLength(2);
    expect(p[0].x).toBeLessThan(0.06);
    expect(textPatches(null)).toEqual([]);
  });
  it("color de letras del diseñador → el de la app", () => {
    expect(inkFromColor("#ffffff", "#1d4ed8")).toBe("claro");
    expect(inkFromColor("#1e4fd6", "#1d4ed8")).toBe("marca");
    expect(inkFromColor("#0b1b3a", "#1d4ed8")).toBe("oscuro");
    expect(inkFromColor("nope", "#1d4ed8")).toBeNull();
  });
  it("una pieza un poco aplastada se lleva a la forma de redes exacta", () => {
    expect(nearestShape(296, 331)).toEqual({ shape: "square", exact: { w: 1080, h: 1080 } });
    expect(nearestShape(1080, 1920).shape).toBe("story");
    expect(nearestShape(1200, 630).exact).toBeNull();
  });
  it("sin IA de edición: tapa el texto con el color de alrededor (liso: limpio; con dibujo: se avisa)", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const { paintPatches } = await import("@/lib/design-ai-run");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#1d4ed8"/><rect x="40" y="240" width="200" height="30" fill="#ffffff"/></svg>`;
    const flat = await sharp(Buffer.from(svg)).png().toBuffer();
    const r = await paintPatches(flat, [{ x: 0.08, y: 0.58, w: 0.56, h: 0.1 }]);
    expect(r.uneven).toBe(false);
    const { data } = await sharp(r.png).extract({ left: 100, top: 250, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).toEqual([0x1d, 0x4e, 0xd8]);
    const stripes = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${Array.from({ length: 40 }, (_, i) => `<rect x="0" y="${i * 10}" width="400" height="5" fill="${i % 2 ? "#ffffff" : "#000000"}"/>`).join("")}</svg>`;
    const busy = await paintPatches(await sharp(Buffer.from(stripes)).png().toBuffer(), [{ x: 0.1, y: 0.4, w: 0.5, h: 0.1 }]);
    expect(busy.uneven).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("estilo del manual en «Comparar modelos»", () => {
  it("manda 1-2 plantillas del manual como referencia y pide seguir su estilo sin copiar el texto", () => {
    const refs = ["https://x/a.png", "https://x/b.png", "https://x/c.png"];
    const ideo = falRequest(model("ideogram-fal"), { brief, shape: "square", styleRefUrls: refs, refKind: "book" });
    expect(ideo.input.image_urls).toEqual(refs.slice(0, 2));
    expect(String(ideo.input.prompt)).toMatch(/brand book/);
    expect(String(ideo.input.prompt)).toMatch(/without copying their text/);
    const nano = falRequest(model("nano-banana-pro"), { brief, shape: "story", styleRefUrls: refs.slice(0, 1), refKind: "book" });
    expect(nano.endpoint).toBe("fal-ai/nano-banana-pro/edit");
    const rec = falRequest(model("recraft-v4-pro"), { brief, shape: "square", styleRefUrls: refs, refKind: "book" });
    expect(rec.input).not.toHaveProperty("image_urls");
    expect(masterPrompt(brief, "square", { styleRef: "book" }).prompt).toMatch(/brand's own social media templates/);
  });
  it("las plantillas del manual también se usan primero en automático", () => {
    const book = customBase("Del manual · Post", { imageUrl: "https://x/a.png", w: 1080, h: 1080, mode: "fondo", photo: "arriba", text: "abajo", ink: "claro", photoBox: { x: 0, y: 0, w: 1, h: 0.5 }, source: "book" });
    expect(isMaster(book)).toBe(true);
    const other = customBase("Otra", { imageUrl: "https://x/b.png", w: 1080, h: 1080, mode: "fondo", photo: "arriba", text: "abajo", ink: "claro" });
    expect(pickTemplate([other, book], -1, { headline: "Hola", hasPhoto: true }).name).toBe("Del manual · Post");
  });
});

describe("el hueco de la foto (lo que tapa la foto queda encima)", () => {
  it("vuelve transparente solo el gris dentro de la caja de la foto", async () => {
    const { knockOutPlaceholder } = await import("@/lib/design-ai-run");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#0a4ea3"/><rect x="20" y="20" width="160" height="100" fill="#D9D9D9"/><rect x="70" y="30" width="60" height="20" fill="#ffffff"/></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const out = await knockOutPlaceholder(png, { x: 0.1, y: 0.1, w: 0.8, h: 0.5 });
    expect(out).not.toBeNull();
    const { data, info } = await sharp(out!).raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect(alpha(40, 100)).toBe(0); // gris → hueco
    expect(alpha(100, 40)).toBe(255); // el "logo" blanco encima de la foto se queda
    expect(alpha(5, 5)).toBe(255); // afuera no se toca
    // Sin gris en la caja: no hay hueco.
    expect(await knockOutPlaceholder(await sharp({ create: { width: 100, height: 100, channels: 3, background: "#123456" } }).png().toBuffer(), { x: 0.1, y: 0.1, w: 0.5, h: 0.5 })).toBeNull();
  });
});
