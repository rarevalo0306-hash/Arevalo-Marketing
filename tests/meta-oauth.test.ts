import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.APP_SECRET = "y".repeat(40);
  process.env.META_APP_ID = "123";
  process.env.META_APP_SECRET = "s";
  process.env.PUBLIC_BASE_URL = "https://app.example.com";
});

vi.mock("@/lib/db", () => ({ db: {} }));

describe("conectar con Facebook", () => {
  it("el state firmado devuelve el negocio", async () => {
    const { makeState, readState } = await import("@/lib/meta-oauth");
    expect(readState(makeState("biz1"))).toBe("biz1");
  });
  it("rechaza un state alterado", async () => {
    const { makeState, readState } = await import("@/lib/meta-oauth");
    const s = makeState("biz1").replace(/^biz1/, "biz2");
    expect(readState(s)).toBeNull();
    expect(readState("basura")).toBeNull();
  });
  it("arma el enlace de Facebook con los permisos y la dirección de regreso", async () => {
    const { authUrl } = await import("@/lib/meta-oauth");
    const u = new URL(authUrl("biz1"));
    expect(u.origin).toBe("https://www.facebook.com");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/meta/callback");
    expect(u.searchParams.get("scope")).toContain("instagram_content_publish");
  });
});
