import { beforeEach, describe, expect, it, vi } from "vitest";

const stored: string[] = [];
const storeAiPhoto = vi.fn(async () => {
  const url = `https://x.supabase.co/b1/foto-${stored.length + 1}.jpg`;
  stored.push(url);
  return url;
});
const recordAiMedia = vi.fn();
const logAiAction = vi.fn();
const aiPhotoProblems = vi.fn();
const fixAiPhoto = vi.fn();

vi.mock("@/lib/fal", () => ({ generateImage: async () => "https://fal.media/hecha.jpg", PHOTO_STYLE: "" }));
vi.mock("@/lib/media-formats", () => ({ storeAiPhoto: (...a: unknown[]) => storeAiPhoto(...(a as [])) }));
vi.mock("@/lib/library", () => ({ recordAiMedia: (...a: unknown[]) => recordAiMedia(...a) }));
vi.mock("@/lib/ai-actions", () => ({ logAiAction: (...a: unknown[]) => logAiAction(...a) }));
vi.mock("@/lib/media", () => ({ readMedia: async () => Buffer.from([1]), publicMediaUrl: (u: string) => u }));
vi.mock("@/lib/photo-tools", () => ({
  aiImageEdit: vi.fn(),
  aiPhotoProblems: (...a: unknown[]) => aiPhotoProblems(...a),
  fixAiPhoto: (...a: unknown[]) => fixAiPhoto(...a),
  fixEnabled: () => true,
  FIX_CENTS: 4,
}));

const { createImage } = await import("@/lib/imagegen");

describe("las fotos de IA se revisan antes de usarlas", () => {
  beforeEach(() => {
    vi.stubEnv("FAL_KEY", "k");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([9, 9]), { headers: { "content-type": "image/jpeg" } }));
    stored.length = 0;
    for (const f of [storeAiPhoto, recordAiMedia, logAiAction, aiPhotoProblems, fixAiPhoto]) f.mockClear();
  });

  it("si está bien, se usa tal cual (sin gastar en arreglarla)", async () => {
    aiPhotoProblems.mockResolvedValue([]);
    expect(await createImage("flux", "a roof after a storm", "square", "b1")).toBe(stored[0]);
    expect(fixAiPhoto).not.toHaveBeenCalled();
    expect(logAiAction).not.toHaveBeenCalled();
  });

  it("si tiene errores, se arregla una vez, se anota el costo y se guarda la arreglada", async () => {
    aiPhotoProblems.mockResolvedValue(["sign text is garbled"]);
    fixAiPhoto.mockResolvedValue({ data: Buffer.from([7]), type: "image/jpeg" });
    const url = await createImage("flux", "a roof after a storm", "square", "b1");
    expect(url).toBe(stored[1]);
    expect(fixAiPhoto).toHaveBeenCalledWith(expect.objectContaining({ url: stored[0] }), ["sign text is garbled"]);
    expect(logAiAction).toHaveBeenCalledWith(expect.objectContaining({ kind: "photo.fix", costCents: 4, businessId: "b1" }));
    expect(recordAiMedia).toHaveBeenCalledWith("b1", stored[1], expect.anything());
  });

  it("si la revisión falla, la foto sale igual", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    aiPhotoProblems.mockRejectedValue(new Error("Gemini caído"));
    expect(await createImage("flux", "a roof after a storm", "square", "b1")).toBe(stored[0]);
  });
});
