import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { expandedName, expandLayout, EXPANDED_SOURCE, expandWithAi, keptFraction, worthExpanding } from "@/lib/photo-expand";

const logAiAction = vi.fn();
vi.mock("@/lib/ai-actions", () => ({ logAiAction: (...a: unknown[]) => logAiAction(...a) }));

describe("extender fotos con IA", () => {
  it("la foto entera va centrada, lo más grande que quepa", () => {
    expect(expandLayout(1600, 900, 1080, 1920)).toEqual({ canvas: [1080, 1920], size: [1080, 608], at: [0, 656] });
    expect(expandLayout(900, 1600, 1080, 1080)).toEqual({ canvas: [1080, 1080], size: [608, 1080], at: [236, 0] });
  });

  it("solo se extiende si recortar perdería mucho", () => {
    expect(keptFraction(16 / 9, 9 / 16)).toBeCloseTo(0.316, 2);
    expect(worthExpanding(16 / 9, 9 / 16)).toBe(true);
    expect(worthExpanding(4 / 5, 9 / 16)).toBe(false);
  });

  it("la misma foto en la misma forma tiene un solo nombre (se paga una vez)", () => {
    const a = expandedName("/media/aaaaaaaaaaaaaaaaaaaaaaaa.jpg", 1080, 1920);
    expect(a).toBe(expandedName("/media/aaaaaaaaaaaaaaaaaaaaaaaa.jpg", 1080, 1920));
    expect(a).not.toBe(expandedName("/media/aaaaaaaaaaaaaaaaaaaaaaaa.jpg", 1080, 1350));
    expect(a).toMatch(/^ia-extendida-[a-f0-9]{12}\.jpg$/);
  });

  it("sin clave o sin dirección pública no llama a nadie", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    vi.stubEnv("FAL_KEY", "");
    await expect(expandWithAi("https://x.supabase.co/a.jpg", 1600, 900, 1080, 1920)).rejects.toThrow(/FAL_KEY/);
    vi.stubEnv("FAL_KEY", "k");
    await expect(expandWithAi("/media/a.jpg", 1600, 900, 1080, 1920)).rejects.toThrow(/internet/);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    fetch.mockRestore();
  });
});

describe("historias con fotos horizontales", () => {
  let dir = "";
  const photo = "/media/bbbbbbbbbbbbbbbbbbbbbbbb.jpg";
  const note = { v: 1 as const, kind: "photo" as const, ai: false };
  const color = async (buf: Buffer) => [...(await sharp(buf).resize(1, 1).raw().toBuffer())];

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "expand-"));
    vi.stubEnv("UPLOAD_DIR", dir);
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("PUBLIC_BASE_URL", "https://app.ejemplo.com");
    await writeFile(path.join(dir, "bbbbbbbbbbbbbbbbbbbbbbbb.jpg"), await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#3366cc" } }).jpeg().toBuffer());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    logAiAction.mockReset();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it("la vista previa nunca gasta: sin extendida guardada, el fondo desenfocado de siempre", async () => {
    const { imageForChannel } = await import("@/lib/media-formats");
    vi.stubEnv("FAL_KEY", "k");
    const fetch = vi.spyOn(globalThis, "fetch");
    const made = await imageForChannel(photo, "instagram:story", note, { focus: null, exact: true, expand: { businessId: "b1", cachedOnly: true } });
    expect(fetch).not.toHaveBeenCalled();
    expect(made?.keep.digitalSourceType).toBeUndefined();
  });

  it("al publicar se extiende una vez, se marca como editada con IA y se anota el costo", async () => {
    const { imageForChannel } = await import("@/lib/media-formats");
    vi.stubEnv("FAL_KEY", "k");
    const wide = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#cc3333" } }).png().toBuffer();
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).startsWith("https://fal.run/fal-ai/bria/expand")) {
        const body = JSON.parse(String(init?.body));
        expect(body.image_url).toBe(`https://app.ejemplo.com${photo}`);
        expect(body).toMatchObject({ canvas_size: [1080, 1920], original_image_size: [1080, 608], original_image_location: [0, 656] });
        return new Response(JSON.stringify({ image: { url: "https://fal.media/files/x.png" } }));
      }
      return new Response(new Uint8Array(wide));
    });
    const first = await imageForChannel(photo, "instagram:story", note, { focus: null, exact: true, expand: { businessId: "b1", postId: "p1" } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(first?.keep.digitalSourceType).toBe(EXPANDED_SOURCE);
    const m = await sharp(first!.out).metadata();
    expect([m.width, m.height]).toEqual([1080, 1920]);
    expect((await color(first!.out))[0]).toBeGreaterThan(150);
    expect(logAiAction).toHaveBeenCalledWith(expect.objectContaining({ kind: "photo.expand", costCents: 4, postId: "p1" }));
    // La segunda vez (u otra red con la misma forma) se reutiliza: no se paga de nuevo.
    fetch.mockClear();
    const again = await imageForChannel(photo, "facebook:story", note, { focus: null, exact: true, expand: { businessId: "b1", cachedOnly: true } });
    expect(fetch).not.toHaveBeenCalled();
    expect((await color(again!.out))[0]).toBeGreaterThan(150);
  });

  it("si la IA falla, la historia sale igual con el fondo desenfocado", async () => {
    const { imageForChannel } = await import("@/lib/media-formats");
    vi.stubEnv("FAL_KEY", "k");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("caída", { status: 500 }));
    const other = "/media/cccccccccccccccccccccccc.jpg";
    await writeFile(path.join(dir, "cccccccccccccccccccccccc.jpg"), await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#3366cc" } }).jpeg().toBuffer());
    const made = await imageForChannel(other, "instagram:story", note, { focus: null, exact: true, expand: { businessId: "b1" } });
    const m = await sharp(made!.out).metadata();
    expect([m.width, m.height]).toEqual([1080, 1920]);
    expect(made?.keep.digitalSourceType).toBeUndefined();
    expect(logAiAction).not.toHaveBeenCalled();
  });
});
