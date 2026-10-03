import { beforeAll, describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "@/lib/crypto";

beforeAll(() => {
  process.env.APP_SECRET = "x".repeat(40);
});

describe("cifrado de credenciales", () => {
  it("cifra y descifra", () => {
    const enc = encryptJson({ token: "secreto" });
    expect(enc).not.toContain("secreto");
    expect(decryptJson(enc)).toEqual({ token: "secreto" });
  });
  it("detecta datos alterados", () => {
    const [iv, tag, data] = encryptJson({ a: 1 }).split(".");
    const flipped = data.slice(0, -2) + (data.endsWith("A") ? "BB" : "AA");
    expect(() => decryptJson([iv, tag, flipped].join("."))).toThrow();
  });
});
