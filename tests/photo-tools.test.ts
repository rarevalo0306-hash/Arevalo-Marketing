import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

const askGemini = vi.fn();
vi.mock("@/lib/ai", () => ({ askGemini: (...a: unknown[]) => askGemini(...a) }));

const { aiPhotoProblems, canUpscale, cutoutPhoto, fixPrompt, removeFlatBackground, upscalePhoto } = await import("@/lib/photo-tools");
const { editedLibraryData, editedByAi, EDIT_FOLDER } = await import("@/lib/library");

/** Un logo: cuadro azul con un círculo blanco adentro (parte del dibujo), sobre fondo blanco o transparente. */
const logo = (bg: string | null, format: "png" | "jpeg" = "png") =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">${bg ? `<rect width="200" height="100" fill="${bg}"/>` : ""}<rect x="40" y="20" width="120" height="60" fill="#126bbc"/><circle cx="100" cy="50" r="15" fill="#ffffff"/></svg>`))
    [format]()
    .toBuffer();
const px = async (buf: Buffer, x: number, y: number) => [...(await sharp(buf).ensureAlpha().extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer())];

describe("quitar el fondo liso de un logo (sin IA)", () => {
  it("borra el fondo que toca el borde y deja el dibujo entero (también lo blanco de adentro)", async () => {
    for (const format of ["png", "jpeg"] as const) {
      const out = (await removeFlatBackground(await logo("#ffffff", format)))!;
      expect(out).not.toBeNull();
      expect((await px(out, 2, 2))[3]).toBe(0);
      expect((await px(out, 100, 30))[3]).toBe(255);
      // El círculo blanco está dentro del dibujo: no es fondo.
      const inner = await px(out, 100, 50);
      expect(inner[3]).toBe(255);
      expect(inner[0]).toBeGreaterThan(240);
    }
  });

  it("también quita un fondo liso de color", async () => {
    const out = (await removeFlatBackground(await logo("#222222")))!;
    expect((await px(out, 2, 2))[3]).toBe(0);
    expect((await px(out, 100, 30))[3]).toBe(255);
  });

  it("no hace nada si ya es transparente o el borde no es de un solo color", async () => {
    expect(await removeFlatBackground(await logo(null))).toBeNull();
    const noisy = await sharp(Buffer.from(Array.from({ length: 100 * 100 * 3 }, (_, i) => (i * 97) % 256)), { raw: { width: 100, height: 100, channels: 3 } }).png().toBuffer();
    expect(await removeFlatBackground(noisy)).toBeNull();
  });
});

describe("agrandar, recortar y arreglar con IA", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    askGemini.mockReset();
  });

  it("solo se agrandan las fotos chicas", () => {
    expect(canUpscale(1200, 800)).toBe(true);
    expect(canUpscale(2000, 1500)).toBe(false);
    expect(canUpscale(0, 0)).toBe(false);
  });

  it("piden a fal.ai el modelo fiel (no uno que inventa) y el recorte con licencia", async () => {
    vi.stubEnv("FAL_KEY", "k");
    const bodies: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).startsWith("https://fal.run/")) {
        bodies.push({ url: String(url), ...JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ image: { url: "https://fal.media/x.png" } }));
      }
      return new Response(new Uint8Array([1, 2, 3]));
    });
    await upscalePhoto("https://x.supabase.co/a.jpg");
    await cutoutPhoto("https://x.supabase.co/a.jpg");
    expect(bodies[0]).toMatchObject({ url: "https://fal.run/fal-ai/esrgan", scale: 2, model: "RealESRGAN_x2plus" });
    expect(bodies[1]).toMatchObject({ url: "https://fal.run/fal-ai/bria/background/remove", image_url: "https://x.supabase.co/a.jpg" });
  });

  it("sin clave o sin dirección pública no llama a nadie", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    vi.stubEnv("FAL_KEY", "");
    await expect(cutoutPhoto("https://x.supabase.co/a.jpg")).rejects.toThrow(/FAL_KEY/);
    vi.stubEnv("FAL_KEY", "k");
    await expect(upscalePhoto("/media/a.jpg")).rejects.toThrow(/internet/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("la revisión devuelve solo los errores claros; el arreglo quita letras en vez de reescribirlas", async () => {
    askGemini.mockResolvedValue({ problems: ["  left hand has six fingers ", "", "sign text is garbled"] });
    const jpg = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#888888" } }).jpeg().toBuffer();
    expect(await aiPhotoProblems(jpg)).toEqual(["left hand has six fingers", "sign text is garbled"]);
    const p = fixPrompt(["left hand has six fingers"]);
    expect(p).toContain("left hand has six fingers");
    expect(p).toMatch(/Remove any text/);
    expect(p).toMatch(/Keep everything else exactly the same/);
  });
});

describe("fotos editadas en la biblioteca", () => {
  const from = { name: "Techo en Miami", description: { es: "Techo dañado", en: "Damaged roof", scene: "before", topics: ["techo"] }, tags: ["techo"], quality: 3, privacy: ["plate"], choice: "", usable: true };

  it("heredan los avisos de privacidad y lo que eligió el dueño (editar no salta la revisión)", () => {
    const d = editedLibraryData("b1", "https://x.supabase.co/b1/a.jpg", from, "upscale", { width: 2400, height: 1600 });
    expect(d).toMatchObject({ source: "ai", folderPath: EDIT_FOLDER.upscale, name: "Agrandada: Techo en Miami", privacy: ["plate"], choice: "", quality: 3, usable: true, width: 2400, mimeType: "image/jpeg" });
    expect(editedByAi(String(d.folderPath))).toBe(true);
  });

  it("los recortes no los usa la IA sola", () => {
    const d = editedLibraryData("b1", "https://x.supabase.co/b1/a.png", from, "cutout", { width: 800, height: 600 });
    expect(d).toMatchObject({ usable: false, mimeType: "image/png", folderPath: EDIT_FOLDER.cutout });
    // Una foto de IA arreglada sigue siendo «hecha con IA».
    expect(editedByAi(EDIT_FOLDER.fix)).toBe(false);
  });
});
