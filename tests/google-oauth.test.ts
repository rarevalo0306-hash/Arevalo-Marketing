import { beforeEach, describe, expect, it } from "vitest";
import { googleAuthUrl, googleStatePurpose } from "@/lib/google-oauth";
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

describe("googleAuthUrl para Search Console", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "cid.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.PUBLIC_BASE_URL = "https://app.example.com/";
    process.env.APP_SECRET = "test-secret";
  });

  it("pide solo lectura de Search Console, usa el mismo regreso y marca el propósito en el state", () => {
    const u = new URL(googleAuthUrl("biz123", "gsc"));
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/webmasters.readonly");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/google/callback");
    expect(u.searchParams.get("access_type")).toBe("offline");
    const state = readState(u.searchParams.get("state")!)!;
    expect(googleStatePurpose(state)).toEqual({ purpose: "gsc", businessId: "biz123" });
  });

  it("el Perfil de Negocio sigue igual", () => {
    const state = readState(new URL(googleAuthUrl("biz123", "profile")).searchParams.get("state")!)!;
    expect(googleStatePurpose(state)).toEqual({ purpose: "profile", businessId: "biz123" });
  });
});

describe('Google revocation', () => {
  it('uses a POST body and never puts the token in the URL', async () => {
    const { vi } = await import('vitest');
    const { revokeGoogleToken } = await import('@/lib/google-oauth');
    const mock=vi.fn().mockResolvedValue(new Response('', {status:200}));vi.stubGlobal('fetch',mock);
    try { await revokeGoogleToken('private-token'); expect(mock.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/revoke'); expect(mock.mock.calls[0][1].method).toBe('POST'); expect(String(mock.mock.calls[0][1].body)).toBe('token=private-token'); } finally {vi.unstubAllGlobals();}
  });
  it('allows already revoked tokens but fails closed on server errors', async () => {
    const { vi } = await import('vitest');const { revokeGoogleToken } = await import('@/lib/google-oauth');
    const mock=vi.fn().mockResolvedValueOnce(Response.json({error:'invalid_token'},{status:400})).mockResolvedValueOnce(Response.json({error:'unavailable'},{status:503}));vi.stubGlobal('fetch',mock);
    try {await expect(revokeGoogleToken('revoked')).resolves.toBeUndefined();await expect(revokeGoogleToken('retry')).rejects.toThrow();} finally {vi.unstubAllGlobals();}
  });
});
