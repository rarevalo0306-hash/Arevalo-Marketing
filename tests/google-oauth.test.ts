import { beforeEach, describe, expect, it } from "vitest";
import { googleAuthUrl } from "@/lib/google-oauth";
import { readState } from "@/lib/meta-oauth";

describe("googleAuthUrl", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "cid.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.PUBLIC_BASE_URL = "https://app.example.com/";
    process.env.APP_SECRET = "test-secret";
  });

  it("pide permiso permanente para el Perfil de Negocio y vuelve a la app", () => {
    const u = new URL(googleAuthUrl("biz123"));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/business.manage");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/google/callback");
    expect(readState(u.searchParams.get("state")!)).toBe("biz123");
  });
});
