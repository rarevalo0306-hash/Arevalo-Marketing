import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOwnerEmail, looksLikeEmail, normalizeEmail } from "@/lib/accounts";
import { googleIdentity } from "@/lib/google-login";
import { asRole, roleAllows } from "@/lib/roles";
import { createSession, readSession } from "@/lib/session";

vi.mock("@/lib/db", () => ({ db: {} }));

const NOW = 1_800_000_000;

beforeEach(() => {
  vi.stubEnv("APP_PASSWORD", "pass");
  vi.stubEnv("APP_SECRET", "secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("signed session cookie", () => {
  it("says which person signed in, for 30 days", async () => {
    const cookie = await createSession("ckuser123", 2, NOW);
    expect(cookie.split(".")).toHaveLength(5);
    expect(await readSession(cookie, NOW + 1)).toEqual({ userId: "ckuser123", version: 2, exp: NOW + 30 * 86400 });
    expect(await readSession(cookie, NOW + 30 * 86400)).toBeNull();
  });

  it("rejects a cookie someone changed", async () => {
    const cookie = await createSession("ckuser123", 0, NOW);
    const [v, , ver, exp, sig] = cookie.split(".");
    expect(await readSession([v, "ckother456", ver, exp, sig].join("."), NOW)).toBeNull();
    expect(await readSession([v, "ckuser123", "1", exp, sig].join("."), NOW)).toBeNull();
    expect(await readSession([v, "ckuser123", ver, String(NOW + 99 * 86400), sig].join("."), NOW)).toBeNull();
    expect(await readSession(cookie.slice(0, -2) + (cookie.endsWith("AA") ? "BB" : "AA"), NOW)).toBeNull();
  });

  it("stops working when the password or the secret changes", async () => {
    const cookie = await createSession("ckuser123", 0, NOW);
    vi.stubEnv("APP_PASSWORD", "new-pass");
    expect(await readSession(cookie, NOW)).toBeNull();
    vi.stubEnv("APP_PASSWORD", "pass");
    vi.stubEnv("APP_SECRET", "other");
    expect(await readSession(cookie, NOW)).toBeNull();
  });

  it("never accepts the old shared-password cookie or junk", async () => {
    for (const junk of [undefined, "", "a".repeat(64), "v2.a.b.c.d", "v1.ckuser123.0.1900000000.sig", "v2.ck.user.0.1900000000.sig", "v2..0.1900000000.sig"]) {
      expect(await readSession(junk, NOW)).toBeNull();
    }
  });

  it("does not sign without both secrets", async () => {
    vi.stubEnv("APP_SECRET", "");
    await expect(createSession("ckuser123", 0, NOW)).rejects.toThrow();
    expect(await readSession("v2.ckuser123.0.1900000000.sig", NOW)).toBeNull();
  });

  it("refuses ids that could break the cookie format", async () => {
    await expect(createSession("a.b", 0, NOW)).rejects.toThrow();
    await expect(createSession("ok", -1, NOW)).rejects.toThrow();
  });
});

describe("roles", () => {
  it("Administrator can do everything, Can publish creates and spends, View only just looks", () => {
    expect([roleAllows("admin", "view"), roleAllows("admin", "publish"), roleAllows("admin", "admin")]).toEqual([true, true, true]);
    expect([roleAllows("publisher", "view"), roleAllows("publisher", "publish"), roleAllows("publisher", "admin")]).toEqual([true, true, false]);
    expect([roleAllows("viewer", "view"), roleAllows("viewer", "publish"), roleAllows("viewer", "admin")]).toEqual([true, false, false]);
  });

  it("an unknown role allows nothing", () => {
    expect(roleAllows("owner", "view")).toBe(false);
    expect(roleAllows("", "view")).toBe(false);
    expect(asRole("Admin")).toBeNull();
  });
});

describe("who may sign in", () => {
  it("owners are the LOGIN_EMAILS addresses, in any case", () => {
    expect(isOwnerEmail(" Owner@Gmail.com ", "owner@gmail.com, b@x.com")).toBe(true);
    expect(isOwnerEmail("ana@gmail.com", "owner@gmail.com")).toBe(false);
    expect(isOwnerEmail("owner@gmail.com", "")).toBe(false);
  });

  it("normalizes and checks emails", () => {
    expect(normalizeEmail("  Ana@Empresa.COM ")).toBe("ana@empresa.com");
    expect(looksLikeEmail("ana@empresa.com")).toBe(true);
    for (const bad of ["", "ana", "ana@", "@x.com", "a b@x.com", "ana@x"]) expect(looksLikeEmail(bad)).toBe(false);
  });

  it("Google tells who it is (with the name) without checking the allowed list", () => {
    const claims = { iss: "https://accounts.google.com", aud: "cid", exp: 2_000, nonce: "n1", email: "Ana@Gmail.com", email_verified: true, name: " Ana Pérez " };
    const opts = { clientId: "cid", nonce: "n1", nowSec: 1_000 };
    expect(googleIdentity(claims, opts)).toEqual({ ok: true, email: "ana@gmail.com", name: "Ana Pérez" });
    expect(googleIdentity({ ...claims, email: "ana@empresa.com" }, opts)).toEqual({ ok: false, reason: "notAllowed" });
    expect(googleIdentity({ ...claims, nonce: "other" }, opts)).toEqual({ ok: false, reason: "token" });
  });
});
