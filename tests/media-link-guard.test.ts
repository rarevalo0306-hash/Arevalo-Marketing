import { lookup } from "dns/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Lo que la acción necesita alrededor, sin base de datos ni red.
const state = vi.hoisted(() => ({ startVideo: vi.fn(async () => ({ statusUrl: "s", responseUrl: "r", provider: "veo", etaSec: 60, startedAt: 0 })) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, delete: vi.fn(), set: vi.fn() }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw Object.assign(new Error(`redirect:${to}`), { to }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireBusiness: vi.fn(async () => undefined), deniedText: vi.fn(), hasBusiness: vi.fn(), newBusinessOrganizationId: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { business: { findUnique: async () => ({ id: "biz1", name: "Fameseg" }) }, post: { create: vi.fn() } } }));
vi.mock("@/lib/i18n-server", () => ({ getT: async () => ({ lang: "es", t: (es: string) => es }) }));
vi.mock("@/lib/fal", () => ({ startVideo: state.startVideo, videoEnabled: () => true, videoResult: vi.fn() }));
// DNS de mentira: "inside.example.com" apunta a la red interna, todo lo demás a internet.
vi.mock("dns/promises", () => ({
  lookup: vi.fn(async (host: string) => [{ address: host === "inside.example.com" ? "10.0.0.5" : "93.184.215.14", family: 4 }]),
}));

import { aiVideoStart, createPost } from "@/app/actions";
import { db } from "@/lib/db";

const OWN = "https://x.supabase.co/storage/v1/object/public/media/biz1/a1b2c3d4e5f6a1b2c3d4e5f6.jpg";

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://x.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "key");
  state.startVideo.mockClear();
  vi.mocked(lookup).mockClear();
});

describe("photo → video only starts from an own file or a public address", () => {
  it("refuses internal addresses before anything downloads the photo", async () => {
    for (const url of ["https://inside.example.com/a.jpg", "https://169.254.169.254/latest/meta-data", "https://[::ffff:7f00:1]/a.jpg", "https://x.supabase.co:8443/a.jpg"]) {
      expect(await aiVideoStart("biz1", url, "push-in"), url).toEqual({ ok: false, error: "La foto del video debe estar en una dirección pública de internet." });
    }
    expect(state.startVideo).not.toHaveBeenCalled();
  });

  it("accepts the business's own file (without asking DNS) and a public address", async () => {
    expect(await aiVideoStart("biz1", OWN, "push-in")).toMatchObject({ ok: true });
    expect(lookup).not.toHaveBeenCalled();
    expect(await aiVideoStart("biz1", "https://cdn.example.com/a.jpg", "push-in")).toMatchObject({ ok: true });
    expect(state.startVideo).toHaveBeenCalledTimes(2);
  });
});

describe("a post's typed media link is never an internal address", () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ text: "Hola", channels: "facebook", ...fields })) f.set(k, v);
    return f;
  };

  it("refuses an internal photo or video link and saves nothing", async () => {
    for (const mediaLink of ["https://inside.example.com/a.jpg", "http://169.254.169.254/latest/meta-data", "http://localhost:3000/a.mp4"]) {
      await expect(createPost("biz1", form({ mediaType: "photo", mediaLink })), mediaLink).rejects.toThrow("dirección pública de internet");
    }
    await expect(createPost("biz1", form({ kind: "carousel", mediaType: "photo", media: JSON.stringify([{ url: OWN }, { url: "https://inside.example.com/b.jpg" }]) }))).rejects.toThrow("direcciones públicas de internet");
    expect(db.post.create).not.toHaveBeenCalled();
  });
});
