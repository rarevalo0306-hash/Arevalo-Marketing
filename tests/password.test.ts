import { describe, expect, it } from "vitest";
import { hashPassword, looksLikeToken, newLinkToken, passwordProblem, tokenHash, verifyPassword } from "@/lib/password";

describe("own passwords and one-time links", () => {
  it("stores only a salted hash and verifies it", async () => {
    const h = await hashPassword("una-clave-larga");
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(h).not.toContain("una-clave-larga");
    expect(await hashPassword("una-clave-larga")).not.toBe(h);
    expect(await verifyPassword("una-clave-larga", h)).toBe(true);
    expect(await verifyPassword("otra-clave-larga", h)).toBe(false);
  });

  it("never accepts an empty or broken hash", async () => {
    expect(await verifyPassword("anything", "")).toBe(false);
    expect(await verifyPassword("anything", "scrypt$1$8$1$AA$AA")).toBe(false);
    expect(await verifyPassword("anything", "plain-text")).toBe(false);
  });

  it("asks for at least 10 characters and the same password twice", () => {
    expect(passwordProblem("corta")).toBe("short");
    expect(passwordProblem("x".repeat(201))).toBe("long");
    expect(passwordProblem("suficiente-larga", "otra")).toBe("mismatch");
    expect(passwordProblem("suficiente-larga", "suficiente-larga")).toBeNull();
  });

  it("links carry a random token and the database only its hash", () => {
    const a = newLinkToken();
    const b = newLinkToken();
    expect(looksLikeToken(a.token)).toBe(true);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(tokenHash(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    for (const bad of ["", "short", "x".repeat(44), "a/b".repeat(15), null, { in: [] }]) expect(looksLikeToken(bad)).toBe(false);
  });
});
