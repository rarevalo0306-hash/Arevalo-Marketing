import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const askGemini = vi.fn();
const readMedia = vi.fn();
vi.mock("@/lib/ai", () => ({ askGemini: (...a: unknown[]) => askGemini(...a) }));
vi.mock("@/lib/media", () => ({ readMedia: (...a: unknown[]) => readMedia(...a) }));

const { detectLogoType, LOGO_TYPE_PROMPT, logoOnBackground } = await import("@/lib/logo-type");

/** Un logo de 200×100 con fondo transparente y un rectángulo del color dado. */
const logo = (fill: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect x="20" y="20" width="160" height="60" fill="${fill}"/></svg>`)).png().toBuffer();
const corner = async (png: Buffer) => [...(await sharp(png).raw().toBuffer()).subarray(0, 3)];

describe("tipo de logo que ve la IA", () => {
  const key = process.env.GEMINI_API_KEY;
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "x";
    askGemini.mockReset();
    readMedia.mockReset();
  });
  afterEach(() => {
    if (key === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = key;
  });

  it("le pregunta a la IA y devuelve el tipo", async () => {
    readMedia.mockResolvedValue(await logo("#126bbc"));
    askGemini.mockResolvedValue({ type: "isologo", why: "El nombre está dentro del dibujo." });
    expect(await detectLogoType("https://x.supabase.co/logo.png")).toBe("isologo");
    expect(LOGO_TYPE_PROMPT).toMatch(/isologo/);
    expect(askGemini.mock.calls[0][4][0].inlineData.mimeType).toBe("image/png");
  });

  it("si no hay IA o falla, no inventa: devuelve null", async () => {
    readMedia.mockResolvedValue(await logo("#126bbc"));
    askGemini.mockRejectedValue(new Error("caída"));
    expect(await detectLogoType("https://x.supabase.co/logo.png")).toBeNull();
    delete process.env.GEMINI_API_KEY;
    askGemini.mockReset();
    expect(await detectLogoType("https://x.supabase.co/logo.png")).toBeNull();
    expect(await detectLogoType("")).toBeNull();
    expect(askGemini).not.toHaveBeenCalled();
  });

  it("muestra el logo sobre un fondo donde se vea", async () => {
    expect(await corner(await logoOnBackground(await logo("#126bbc")))).toEqual([255, 255, 255]);
    // La versión blanca sobre blanco no se vería: va sobre oscuro.
    expect(await corner(await logoOnBackground(await logo("#ffffff")))).toEqual([0x1f, 0x29, 0x37]);
  });
});
