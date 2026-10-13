import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));

import { GET } from "@/app/api/auth/google/start/route";

const TOKEN = "A".repeat(43);
const start = (headers: Record<string, string> = {}, query = `?invitacion=${TOKEN}`) =>
  GET(new Request(`https://app.example/api/auth/google/start${query}`, { headers }));

beforeEach(() => {
  jar.set.mockClear();
  vi.stubEnv("PUBLIC_BASE_URL", "https://app.example");
  vi.stubEnv("GOOGLE_CLIENT_ID", "client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  vi.stubEnv("LOGIN_EMAILS", "owner@gmail.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("Sign in with Google from an invitation", () => {
  it("accepts only from the invitation page: a direct link goes to the invitation first", async () => {
    const cases: Record<string, string>[] = [{ "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "none" }, { "sec-fetch-site": "same-site" }, {}, { referer: "https://evil.example/x" }];
    for (const headers of cases) {
      const res = await start(headers);
      expect(res.headers.get("location")).toBe(`https://app.example/invitacion/${TOKEN}`);
      expect(jar.set).not.toHaveBeenCalled();
    }
  });

  it("from the invitation page (or an old browser with our Referer) it goes to Google with the invitation saved", async () => {
    const cases: Record<string, string>[] = [{ "sec-fetch-site": "same-origin" }, { referer: `https://app.example/invitacion/${TOKEN}` }];
    for (const headers of cases) {
      jar.set.mockClear();
      const res = await start(headers);
      expect(res.headers.get("location")).toMatch(/^https:\/\/accounts\.google\.com\//);
      expect(jar.set.mock.calls[0][1]).toMatch(new RegExp(`\\.${TOKEN}$`));
    }
  });

  it("a plain sign-in (no invitation) works from anywhere", async () => {
    const res = await start({ "sec-fetch-site": "cross-site" }, "");
    expect(res.headers.get("location")).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(jar.set.mock.calls[0][1].split(".")).toHaveLength(2);
  });
});
