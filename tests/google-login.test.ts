import { afterEach, describe, expect, it, vi } from "vitest";
import { checkGoogleLogin, googleLoginEnabled, googleLoginRedirectUri, googleLoginUrl, idTokenClaims, loginEmails, newLoginFlow, readLoginFlow } from "@/lib/google-login";

const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const good = { iss: "https://accounts.google.com", aud: "cid", exp: 2_000, nonce: "n1", email: "Owner@Gmail.com", email_verified: true };
const opts = { clientId: "cid", nonce: "n1", nowSec: 1_000, allowed: ["owner@gmail.com", "ana@empresa.com", "ex@otro.com"] };

afterEach(() => vi.unstubAllEnvs());

describe("sign in with Google", () => {
  it("reads the allowed emails", () => {
    expect(loginEmails(" A@x.com, b@y.com;c@z.com  d@w.com ,nope")).toEqual(["a@x.com", "b@y.com", "c@z.com", "d@w.com"]);
    expect(loginEmails("")).toEqual([]);
    expect(loginEmails(undefined)).toEqual([]);
  });

  it("shows the button only with a Google client and at least one allowed email", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "sec");
    vi.stubEnv("LOGIN_EMAILS", "");
    expect(googleLoginEnabled()).toBe(false);
    vi.stubEnv("LOGIN_EMAILS", "owner@example.com");
    expect(googleLoginEnabled()).toBe(true);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(googleLoginEnabled()).toBe(false);
  });

  it("asks Google only for the verified email, on its own return address", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("PUBLIC_BASE_URL", "https://app.matya.app/");
    expect(googleLoginRedirectUri()).toBe("https://app.matya.app/api/auth/google/callback");
    const u = new URL(googleLoginUrl("st", "no"));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: "cid",
      redirect_uri: "https://app.matya.app/api/auth/google/callback",
      response_type: "code",
      scope: "openid email",
      state: "st",
      nonce: "no",
      prompt: "select_account",
    });
  });

  it("keeps a fresh state and nonce per attempt in one cookie", () => {
    const a = newLoginFlow();
    const b = newLoginFlow();
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(a.state);
    expect(readLoginFlow(a.cookie)).toEqual({ state: a.state, nonce: a.nonce });
    expect(readLoginFlow(undefined)).toBeNull();
    expect(readLoginFlow("only")).toBeNull();
    expect(readLoginFlow("a.b.c")).toBeNull();
  });

  it("reads the id_token claims", () => {
    expect(idTokenClaims(jwt(good))).toEqual(good);
    expect(idTokenClaims("")).toBeNull();
    expect(idTokenClaims("a.%%%.c")).toBeNull();
  });

  it("lets in only a current Google token for this client, this attempt and an allowed verified email", () => {
    expect(checkGoogleLogin(good, opts)).toEqual({ ok: true, email: "owner@gmail.com" });
    expect(checkGoogleLogin({ ...good, iss: "accounts.google.com", aud: ["other", "cid"] }, opts)).toEqual({ ok: true, email: "owner@gmail.com" });
    expect(checkGoogleLogin(null, opts)).toEqual({ ok: false, reason: "token" });
    expect(checkGoogleLogin({ ...good, iss: "https://evil.example" }, opts)).toEqual({ ok: false, reason: "token" });
    expect(checkGoogleLogin({ ...good, aud: "other" }, opts)).toEqual({ ok: false, reason: "token" });
    expect(checkGoogleLogin({ ...good, exp: 1_000 }, opts)).toEqual({ ok: false, reason: "token" });
    expect(checkGoogleLogin({ ...good, nonce: "n2" }, opts)).toEqual({ ok: false, reason: "token" });
    expect(checkGoogleLogin({ ...good, nonce: undefined }, opts)).toEqual({ ok: false, reason: "token" });
    expect(checkGoogleLogin({ ...good, email_verified: false }, opts)).toEqual({ ok: false, reason: "notAllowed" });
    expect(checkGoogleLogin({ ...good, email: "someone@else.com" }, opts)).toEqual({ ok: false, reason: "notAllowed" });
    expect(checkGoogleLogin(good, { ...opts, allowed: [] })).toEqual({ ok: false, reason: "notAllowed" });
    expect(checkGoogleLogin(good, { ...opts, clientId: "" })).toEqual({ ok: false, reason: "token" });
  });

  it("trusts only addresses Google vouches for: Gmail, or a Google Workspace account", () => {
    expect(checkGoogleLogin({ ...good, email: "ana@empresa.com", hd: "empresa.com" }, opts)).toEqual({ ok: true, email: "ana@empresa.com" });
    expect(checkGoogleLogin({ ...good, email: "ex@otro.com" }, opts)).toEqual({ ok: false, reason: "notAllowed" });
    expect(checkGoogleLogin({ ...good, email: "ex@otro.com", hd: "" }, opts)).toEqual({ ok: false, reason: "notAllowed" });
  });
});
