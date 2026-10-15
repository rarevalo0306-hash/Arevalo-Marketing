import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Lo que el regreso de Google necesita alrededor, sin base de datos ni red.
const m = vi.hoisted(() => ({
  jar: { set: vi.fn(), get: vi.fn(), delete: vi.fn() },
  upsert: vi.fn(),
  findBusiness: vi.fn(),
  listGscSites: vi.fn(),
  saveGscSite: vi.fn(),
  tryFirstGscReport: vi.fn(),
  listGa4Properties: vi.fn(),
  readGa4Connection: vi.fn(),
  writeGa4Connection: vi.fn(),
  refreshGa4: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => m.jar }));
vi.mock("@/lib/auth", () => ({ businessAccess: async () => ({ ok: true }) }));
vi.mock("@/lib/i18n-server", async () => {
  const { translator } = await import("@/lib/i18n");
  return { getT: async () => ({ lang: "en", t: translator("en") }) };
});
// Sin cifrar: así se ve qué se guarda.
vi.mock("@/lib/crypto", () => ({ encryptJson: (v: unknown) => JSON.stringify(v), decryptJson: (s: string) => JSON.parse(s) }));
vi.mock("@/lib/db", () => ({ db: { connection: { upsert: m.upsert }, business: { findUniqueOrThrow: m.findBusiness } } }));
vi.mock("@/lib/seo/gsc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo/gsc")>()),
  listGscSites: m.listGscSites,
  saveGscSite: m.saveGscSite,
  tryFirstGscReport: m.tryFirstGscReport,
}));
vi.mock("@/lib/ga4", () => ({
  listGa4Properties: m.listGa4Properties,
  readGa4Connection: m.readGa4Connection,
  writeGa4Connection: m.writeGa4Connection,
  refreshGa4: m.refreshGa4,
}));

import { GET } from "@/app/api/google/callback/route";
import { GA4_SCOPE, GOOGLE_COOKIE, GOOGLE_SCOPE, GSC_SCOPE, YOUTUBE_READ_SCOPE, YOUTUBE_SCOPE } from "@/lib/google-oauth";
import { makeState } from "@/lib/meta-oauth";
import { GSC_COOKIE } from "@/lib/seo/gsc";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Google: el token con los permisos que se dieron (undefined = sin campo «scope»), y lo demás según la dirección. */
function google(scope: string | undefined, rest: (url: string) => Response = () => json({ error: { message: "unexpected" } }, 500), idToken?: string) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(String(url));
      if (String(url) === "https://oauth2.googleapis.com/token") return json({ access_token: "AT", refresh_token: "RT", ...(scope === undefined ? {} : { scope }), ...(idToken ? { id_token: idToken } : {}) });
      return rest(String(url));
    }),
  );
  return urls;
}

/** El regreso de Google con un state firmado: «youtube:biz1» → «google:youtube:biz1»; «biz1» → Perfil de Negocio. */
const back = (state: string, raw = false) =>
  GET(new Request(`https://app.example/api/google/callback?code=c1&state=${encodeURIComponent(makeState(raw ? state : `google:${state.includes(":") ? state : `profile:${state}`}`))}`));
const jwt = (p: unknown) => `h.${Buffer.from(JSON.stringify(p)).toString("base64url")}.sig`;
const where = (res: Response) => new URL(res.headers.get("location") ?? "");
const scopes = (...s: string[]) => s.join(" ");

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("PUBLIC_BASE_URL", "https://app.example");
  vi.stubEnv("APP_SECRET", "test-secret");
  vi.stubEnv("GOOGLE_CLIENT_ID", "app-id.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "app-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("YouTube: hacen falta los dos permisos", () => {
  it("solo «ver el canal»: no se guarda nada y el mensaje nombra el permiso de subir", async () => {
    const urls = google(scopes(YOUTUBE_READ_SCOPE));
    const u = where(await back("youtube:biz1"));
    expect(u.pathname).toBe("/b/biz1/conexiones");
    expect(u.searchParams.get("youtube")).toBe("error");
    expect(u.searchParams.get("msg")).toContain("upload videos to your YouTube channel");
    expect(u.searchParams.get("msg")).toContain("nothing was connected");
    expect(urls).toEqual(["https://oauth2.googleapis.com/token"]);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("solo «subir videos»: no se guarda nada y el mensaje nombra el permiso de ver el canal", async () => {
    const urls = google(scopes(YOUTUBE_SCOPE));
    const u = where(await back("youtube:biz1"));
    expect(u.searchParams.get("youtube")).toBe("error");
    expect(u.searchParams.get("msg")).toContain("view your YouTube channel");
    expect(u.searchParams.get("msg")).not.toContain("upload videos");
    expect(urls.some((x) => x.includes("youtube/v3/channels"))).toBe(false);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("los dos (y otros de antes): guarda el canal sin copia del cliente de la app", async () => {
    google(scopes(GA4_SCOPE, YOUTUBE_SCOPE, YOUTUBE_READ_SCOPE), () => json({ items: [{ id: "UC1", snippet: { title: "Fameseg" } }] }));
    const u = where(await back("youtube:biz1"));
    expect(u.searchParams.get("youtube")).toBe("ok");
    expect(u.searchParams.get("chan")).toBe("Fameseg");
    expect(m.upsert).toHaveBeenCalledTimes(1);
    const arg = m.upsert.mock.calls[0][0];
    expect(JSON.parse(arg.create.secret)).toEqual({ refreshToken: "RT", channelId: "UC1" });
    expect(arg.update.secret).toBe(arg.create.secret);
  });

  it("guarda la cuenta de Google que dio el permiso (para no revocar el de otras conexiones al desconectar)", async () => {
    google(scopes(YOUTUBE_SCOPE, YOUTUBE_READ_SCOPE), () => json({ items: [{ id: "UC1", snippet: { title: "Fameseg" } }] }), jwt({ sub: "g-123", aud: "app-id.apps.googleusercontent.com" }));
    await back("youtube:biz1");
    expect(JSON.parse(m.upsert.mock.calls[0][0].create.secret)).toEqual({ refreshToken: "RT", channelId: "UC1", googleUser: "g-123" });
  });

  it("un state de Facebook (misma firma, sin «google:») no sirve aquí: no se cambia el código", async () => {
    const urls = google(scopes(YOUTUBE_SCOPE, YOUTUBE_READ_SCOPE));
    const res = await back("biz1", true);
    expect(res.status).toBe(400);
    expect(urls).toEqual([]);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("sin el campo «scope»: sigue como antes", async () => {
    google(undefined, () => json({ items: [{ id: "UC1", snippet: { title: "Fameseg" } }] }));
    expect(where(await back("youtube:biz1")).searchParams.get("youtube")).toBe("ok");
    expect(m.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("Perfil de Negocio", () => {
  it("sin el permiso de administrar: no pide ubicaciones ni deja la cookie", async () => {
    const urls = google(scopes(GSC_SCOPE));
    const u = where(await back("biz1"));
    expect(u.searchParams.get("google")).toBe("error");
    expect(u.searchParams.get("msg")).toContain("manage your Business Profile");
    expect(urls.some((x) => x.includes("mybusiness"))).toBe(false);
    expect(m.jar.set).not.toHaveBeenCalled();
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("con el permiso y una sola ubicación: la guarda sin copia del cliente de la app", async () => {
    google(scopes(GOOGLE_SCOPE), (url) =>
      url.includes("/v1/accounts?") ? json({ accounts: [{ name: "accounts/11" }] }) : json({ locations: [{ name: "locations/22", title: "Fameseg" }] }),
    );
    const u = where(await back("biz1"));
    expect(u.searchParams.get("google")).toBe("ok");
    const arg = m.upsert.mock.calls[0][0];
    expect(JSON.parse(arg.create.secret)).toEqual({ accountId: "11", locationId: "22", refreshToken: "RT" });
  });

  it("varias ubicaciones: la cookie solo lleva el refresh token", async () => {
    google(scopes(GOOGLE_SCOPE), (url) =>
      url.includes("/v1/accounts?")
        ? json({ accounts: [{ name: "accounts/11" }] })
        : json({ locations: [{ name: "locations/22", title: "A" }, { name: "locations/23", title: "B" }] }),
    );
    expect(where(await back("biz1")).pathname).toBe("/b/biz1/conexiones/google");
    expect(m.jar.set.mock.calls[0][0]).toBe(GOOGLE_COOKIE);
    expect(JSON.parse(m.jar.set.mock.calls[0][1])).toMatchObject({ refreshToken: "RT", businessId: "biz1" });
  });
});

describe("Search Console y Analytics", () => {
  it("Search Console sin su permiso: no lista sitios, no guarda ni deja la cookie", async () => {
    google(scopes(GA4_SCOPE));
    const u = where(await back("gsc:biz1"));
    expect(u.pathname).toBe("/b/biz1/seo");
    expect(u.searchParams.get("gsc")).toBe("error");
    expect(u.searchParams.get("msg")).toContain("view your Search Console data");
    expect(m.listGscSites).not.toHaveBeenCalled();
    expect(m.saveGscSite).not.toHaveBeenCalled();
    expect(m.jar.set).not.toHaveBeenCalledWith(GSC_COOKIE, expect.anything(), expect.anything());
  });

  it("Search Console con su permiso: sigue como antes", async () => {
    google(scopes(GSC_SCOPE));
    m.listGscSites.mockResolvedValue(["https://fameseg.com/"]);
    m.findBusiness.mockResolvedValue({ website: "https://fameseg.com" });
    expect(where(await back("gsc:biz1")).searchParams.get("gsc")).toBe("ok");
    expect(m.listGscSites).toHaveBeenCalledWith("AT");
    expect(m.saveGscSite).toHaveBeenCalledWith("biz1", "RT", "https://fameseg.com/", null);
  });

  it("Analytics sin su permiso: no lista propiedades ni guarda", async () => {
    google(scopes(GSC_SCOPE, YOUTUBE_SCOPE));
    const u = where(await back("ga4:biz1"));
    expect(u.pathname).toBe("/b/biz1/seo");
    expect(u.hash).toBe("#ga4");
    expect(u.searchParams.get("tab")).toBe("web");
    expect(u.searchParams.get("ga4")).toBe("error");
    expect(u.searchParams.get("msg")).toContain("view your Google Analytics data");
    expect(m.listGa4Properties).not.toHaveBeenCalled();
    expect(m.writeGa4Connection).not.toHaveBeenCalled();
  });

  it("Analytics con su permiso: sigue como antes", async () => {
    google(scopes(GA4_SCOPE));
    m.listGa4Properties.mockResolvedValue([{ id: "p1", name: "Fameseg" }]);
    m.readGa4Connection.mockResolvedValue(null);
    m.refreshGa4.mockResolvedValue({ ok: true });
    expect(where(await back("ga4:biz1")).searchParams.get("ga4")).toBe("ok");
    expect(m.writeGa4Connection).toHaveBeenCalledWith("biz1", expect.objectContaining({ refreshToken: "RT", propertyId: "p1" }));
  });
});
