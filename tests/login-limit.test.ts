import { describe, expect, it } from "vitest";
import { attemptKey, clientIp, LOGIN_LOCK_SECONDS, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS, waitMinutes } from "@/lib/login-limit";

const bag = (h: Record<string, string>) => ({ get: (n: string) => h[n] ?? null });

describe("login limit", () => {
  it("allows 5 tries per 15 minutes and locks for 15 minutes", () => {
    expect(LOGIN_MAX_ATTEMPTS).toBe(5);
    expect(LOGIN_WINDOW_SECONDS).toBe(900);
    expect(LOGIN_LOCK_SECONDS).toBe(900);
  });

  it("reads the client IP the way Vercel sends it", () => {
    expect(clientIp(bag({ "x-real-ip": " 203.0.113.7 ", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.7");
    expect(clientIp(bag({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientIp(bag({}))).toBe("local");
  });

  it("stores a keyed fingerprint, never the IP", () => {
    const a = attemptKey("203.0.113.7", "s".repeat(32));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("203.0.113.7");
    expect(attemptKey("203.0.113.7", "s".repeat(32))).toBe(a);
    expect(attemptKey("203.0.113.8", "s".repeat(32))).not.toBe(a);
    expect(attemptKey("203.0.113.7", "t".repeat(32))).not.toBe(a);
  });

  it("shows at least one minute", () => {
    expect(waitMinutes(1)).toBe(1);
    expect(waitMinutes(60)).toBe(1);
    expect(waitMinutes(61)).toBe(2);
    expect(waitMinutes(900)).toBe(15);
  });
});
