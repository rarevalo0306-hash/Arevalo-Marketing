import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { APP_HOST, oldHostRedirects } from "@/lib/app-host";

describe("app host", () => {
  it("sends every path on matya.app and www.matya.app to the same path on app.matya.app, temporarily", () => {
    expect(APP_HOST).toBe("app.matya.app");
    expect(oldHostRedirects()).toEqual([
      { source: "/:path*", has: [{ type: "host", value: "matya.app" }], destination: "https://app.matya.app/:path*", permanent: false },
      { source: "/:path*", has: [{ type: "host", value: "www.matya.app" }], destination: "https://app.matya.app/:path*", permanent: false },
    ]);
  });

  it("never redirects the app host itself", () => {
    expect(oldHostRedirects().flatMap((r) => r.has.map((h) => h.value as string))).not.toContain(APP_HOST);
  });

  it("is wired into next.config", async () => {
    expect(await nextConfig.redirects?.()).toEqual(oldHostRedirects());
  });
});
