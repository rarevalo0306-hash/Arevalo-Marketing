import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/publishers", () => ({ PUBLISHERS: {} }));

import { audienceGap } from "@/lib/publish";

const c = (email: string, emailOptIn: boolean, phone = "", smsOptIn = false) => ({ email, phone, emailOptIn, smsOptIn });

describe("email y SMS sin contactos se saltan (no fallan)", () => {
  it("email sin nadie que haya aceptado", () => {
    expect(audienceGap("email", [])).toMatch(/No tienes contactos que hayan aceptado recibir correos/);
    expect(audienceGap("email", [c("a@b.com", false), c("sin-arroba", true)])).not.toBe("");
    expect(audienceGap("email", [c("a@b.com", true)])).toBe("");
  });
  it("SMS sin nadie que haya aceptado", () => {
    expect(audienceGap("sms", [c("", false, "+1305", false)])).toMatch(/recibir textos/);
    expect(audienceGap("sms", [c("", false, "+1305", true)])).toBe("");
  });
  it("los demás canales no dependen de contactos", () => {
    expect(audienceGap("facebook", [])).toBe("");
  });
});
