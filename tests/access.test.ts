import { describe, expect, it } from "vitest";
import { gate } from "@/lib/access";
import { config } from "@/middleware";

describe("who can open what without signing in", () => {
  it("lets a signed-in person do anything", () => {
    expect(gate("/b/x/inicio", "GET", true)).toBe("pass");
    expect(gate("/login", "POST", true)).toBe("pass");
    expect(gate("/b/x/publicar", "POST", true)).toBe("pass");
  });

  it("opens only the public pages and files for reading", () => {
    for (const p of ["/login", "/api/auth/google/start", "/api/auth/google/callback", "/api/cron", "/subir/tok", "/media/a.png", "/manifest.webmanifest", "/icons/192", "/icon", "/apple-icon", "/favicon.ico"]) {
      expect(gate(p, "GET", false)).toBe("pass");
    }
    expect(gate("/login", "HEAD", false)).toBe("pass");
  });

  it("sends everything else to the login page", () => {
    for (const p of ["/", "/b/x/inicio", "/negocios/nuevo", "/api/google/callback", "/api/google/start", "/api/auth/google", "/api/auth/googlex/start", "/loginx", "/iconx", "/api/cron/x", "/subir", "/media"]) {
      expect(gate(p, "GET", false)).toBe("login");
    }
  });

  it("never runs a server action without a session, not even from the public login page", () => {
    for (const p of ["/login", "/subir/tok", "/media/a.png", "/api/auth/google/callback", "/api/cron", "/", "/b/x/inicio"]) {
      expect(gate(p, "POST", false)).toBe("deny");
    }
    expect(gate("/login", "PUT", false)).toBe("deny");
  });

  it("accepts sends only where the route checks its own permission", () => {
    expect(gate("/api/auth/login", "POST", false)).toBe("pass");
    expect(gate("/api/subir/tok/firmar", "POST", false)).toBe("pass");
    expect(gate("/api/subir/tok/listo", "POST", false)).toBe("pass");
    expect(gate("/api/auth/login/x", "POST", false)).toBe("deny");
  });

  it("runs the middleware on every route except Next's own files", () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/login")).toBe(true);
    expect(re.test("/subir/tok")).toBe(true);
    expect(re.test("/b/x/inicio")).toBe(true);
    expect(re.test("/_next/static/chunks/a.js")).toBe(false);
  });
});
