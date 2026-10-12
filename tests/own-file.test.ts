import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOwnFile } from "@/lib/media";

const BASE = "https://x.supabase.co/storage/v1/object/public/media";

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://x.supabase.co/");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "key");
});
afterEach(() => vi.unstubAllEnvs());

describe("a file belongs to the business only inside its own folder", () => {
  it("accepts files in the business folder", () => {
    expect(isOwnFile(`${BASE}/bizA/abc123.jpg`, "bizA")).toBe(true);
    expect(isOwnFile(`${BASE}/bizA/sub/abc123.pdf`, "bizA")).toBe(true);
  });

  it("rejects other folders and ways out of the folder, also when encoded", () => {
    for (const url of [
      `${BASE}/bizB/abc123.jpg`,
      `${BASE}/bizAB/abc123.jpg`,
      `${BASE}/bizA/../bizB/abc123.jpg`,
      `${BASE}/bizA/%2e%2e/bizB/abc123.jpg`,
      `${BASE}/bizA/%2E%2E/bizB/abc123.jpg`,
      `${BASE}/bizA/.%2e/bizB/abc123.jpg`,
      `${BASE}/bizA/..%2fbizB%2fabc123.jpg`,
      `${BASE}/bizA/..%5cbizB/abc123.jpg`,
      `${BASE}/bizA/..\\bizB/abc123.jpg`,
      `https://evil.com/storage/v1/object/public/media/bizA/abc123.jpg`,
    ]) {
      expect(isOwnFile(url, "bizA"), url).toBe(false);
    }
  });

  it("without storage configured, nothing is own", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(isOwnFile(`${BASE}/bizA/abc123.jpg`, "bizA")).toBe(false);
  });
});
