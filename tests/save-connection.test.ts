import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Lo que la acción necesita alrededor, sin base de datos ni red. Sin cifrar: así se ve qué se guarda.
const m = vi.hoisted(() => ({ previous: null as null | Record<string, string>, upsert: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, delete: vi.fn(), set: vi.fn() }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw Object.assign(new Error(`redirect:${to}`), { to }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireBusiness: vi.fn(async () => undefined), deniedText: vi.fn(), hasBusiness: vi.fn(), newBusinessOrganizationId: vi.fn() }));
vi.mock("@/lib/i18n-server", () => ({ getT: async () => ({ lang: "es", t: (es: string) => es }) }));
vi.mock("@/lib/crypto", () => ({ encryptJson: (v: unknown) => JSON.stringify(v), decryptJson: (s: string) => JSON.parse(s) }));
vi.mock("@/lib/db", () => ({
  db: {
    business: { findUnique: async () => ({ id: "biz1", name: "Fameseg" }) },
    connection: { findUnique: async () => (m.previous ? { secret: JSON.stringify(m.previous) } : null), upsert: m.upsert },
  },
}));

import { saveConnection } from "@/app/actions";

const APP_ID = "app-id.apps.googleusercontent.com";
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const saved = () => JSON.parse(m.upsert.mock.calls[0][0].update.secret) as Record<string, string>;

beforeEach(() => {
  m.previous = null;
  m.upsert.mockReset();
  vi.stubEnv("GOOGLE_CLIENT_ID", APP_ID);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "app-secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("guardar a mano Google o YouTube con el cliente de la app: sin copia de su clave", () => {
  it("Google con el client ID vacío: quita la copia vieja y conserva el refresh token", async () => {
    m.previous = { accountId: "1", locationId: "2", clientId: APP_ID, clientSecret: "stale", refreshToken: "RT" };
    await saveConnection("biz1", "google", form({ accountId: "1", locationId: "3", clientId: "", clientSecret: "", refreshToken: "" }));
    expect(saved()).toEqual({ accountId: "1", locationId: "3", refreshToken: "RT" });
  });

  it("YouTube con el mismo client ID de la app: no guarda la clave pegada", async () => {
    await saveConnection("biz1", "youtube", form({ clientId: ` ${APP_ID} `, clientSecret: "pasted", refreshToken: "RT" }));
    expect(saved()).toEqual({ refreshToken: "RT" });
  });

  it("con un cliente propio (otro client ID) se guardan los dos", async () => {
    await saveConnection("biz1", "youtube", form({ clientId: "own-id", clientSecret: "own-secret", refreshToken: "RT" }));
    expect(saved()).toEqual({ clientId: "own-id", clientSecret: "own-secret", refreshToken: "RT" });
    m.upsert.mockReset();
    m.previous = { accountId: "1", locationId: "2", clientId: "own-id", clientSecret: "own-secret", refreshToken: "RT" };
    await saveConnection("biz1", "google", form({ accountId: "1", locationId: "2", clientId: "own-id", clientSecret: "", refreshToken: "" }));
    expect(saved()).toEqual(m.previous);
  });

  it("otros canales no cambian", async () => {
    await saveConnection("biz1", "tiktok", form({ clientKey: "k", clientSecret: "s", refreshToken: "RT" }));
    expect(saved()).toEqual({ clientKey: "k", clientSecret: "s", refreshToken: "RT" });
  });
});
