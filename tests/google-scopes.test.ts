import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GA4_SCOPE,
  GOOGLE_SCOPE,
  googleAuthUrl,
  googleExchange,
  GSC_SCOPE,
  missingGoogleScopes,
  missingScopesText,
  PURPOSE_SCOPES,
  YOUTUBE_READ_SCOPE,
  YOUTUBE_SCOPE,
} from "@/lib/google-oauth";
import { channelDef, channelText } from "@/lib/channels";
import { translator } from "@/lib/i18n";
import { classifyFailure, needsReconnect } from "@/lib/publish-errors";

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  vi.stubEnv("PUBLIC_BASE_URL", "https://app.example.com");
  vi.stubEnv("APP_SECRET", "test-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("permisos que pide cada propósito", () => {
  it("el enlace a Google pide lo mismo de siempre (YouTube: subir y ver, en ese orden)", () => {
    const scope = (purpose: "profile" | "gsc" | "ga4" | "youtube") => new URL(googleAuthUrl("biz1", purpose)).searchParams.get("scope");
    expect(scope("youtube")).toBe(`${YOUTUBE_SCOPE} ${YOUTUBE_READ_SCOPE}`);
    expect(scope("profile")).toBe(GOOGLE_SCOPE);
    expect(scope("gsc")).toBe(GSC_SCOPE);
    expect(scope("ga4")).toBe(GA4_SCOPE);
    expect(PURPOSE_SCOPES.youtube).toEqual([YOUTUBE_SCOPE, YOUTUBE_READ_SCOPE]);
  });
});

describe("missingGoogleScopes: qué casilla desmarcó la persona", () => {
  it("YouTube necesita los dos permisos", () => {
    expect(missingGoogleScopes("youtube", [YOUTUBE_SCOPE])).toEqual([YOUTUBE_READ_SCOPE]);
    expect(missingGoogleScopes("youtube", [YOUTUBE_READ_SCOPE])).toEqual([YOUTUBE_SCOPE]);
    expect(missingGoogleScopes("youtube", [])).toEqual([YOUTUBE_SCOPE, YOUTUBE_READ_SCOPE]);
  });
  it("permisos de otras conexiones (include_granted_scopes) no importan", () => {
    expect(missingGoogleScopes("youtube", [GA4_SCOPE, YOUTUBE_READ_SCOPE, "openid", YOUTUBE_SCOPE])).toEqual([]);
    expect(missingGoogleScopes("profile", [GA4_SCOPE, GOOGLE_SCOPE])).toEqual([]);
  });
  it("sin la lista de Google (no vino «scope») se da por concedido todo", () => {
    expect(missingGoogleScopes("youtube", null)).toEqual([]);
    expect(missingGoogleScopes("profile", null)).toEqual([]);
  });
  it("Perfil de Negocio, Search Console y Analytics", () => {
    expect(missingGoogleScopes("profile", [GSC_SCOPE])).toEqual([GOOGLE_SCOPE]);
    expect(missingGoogleScopes("gsc", [GOOGLE_SCOPE])).toEqual([GSC_SCOPE]);
    expect(missingGoogleScopes("ga4", [GSC_SCOPE])).toEqual([GA4_SCOPE]);
    expect(missingGoogleScopes("gsc", [GSC_SCOPE])).toEqual([]);
  });
});

describe("missingScopesText: el mensaje dice qué falta y que no se conectó nada", () => {
  it("un permiso", () => {
    const en = missingScopesText([YOUTUBE_SCOPE], translator("en"));
    expect(en).toContain("upload videos to your YouTube channel");
    expect(en).toContain("nothing was connected");
    expect(en).toContain("check that box");
    expect(en).not.toContain("view your YouTube channel");
    const es = missingScopesText([YOUTUBE_READ_SCOPE], translator("es"));
    expect(es).toContain("ver tu canal de YouTube");
    expect(es).toContain("no se conectó nada");
    expect(es).toContain("marca esa casilla");
  });
  it("los dos permisos de YouTube", () => {
    const en = missingScopesText([YOUTUBE_SCOPE, YOUTUBE_READ_SCOPE], translator("en"));
    expect(en).toBe(
      "You didn't grant permission to upload videos to your YouTube channel or to view your YouTube channel (its name and your videos' views), so nothing was connected. Connect again and, on Google's screen, check both boxes.",
    );
    const es = missingScopesText([YOUTUBE_SCOPE, YOUTUBE_READ_SCOPE], translator("es"));
    expect(es).toContain("subir videos a tu canal de YouTube ni para ver tu canal de YouTube");
    expect(es).toContain("marca las dos casillas");
  });
  it("Perfil de Negocio, Search Console y Analytics tienen nombre claro", () => {
    const en = translator("en");
    expect(missingScopesText([GOOGLE_SCOPE], en)).toContain("manage your Business Profile");
    expect(missingScopesText([GSC_SCOPE], en)).toContain("view your Search Console data");
    expect(missingScopesText([GA4_SCOPE], en)).toContain("view your Google Analytics data");
  });
});

describe("googleExchange devuelve los permisos que se dieron", () => {
  const token = (body: unknown) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  it("lee el campo «scope» (separado por espacios)", async () => {
    const fetchMock = token({ access_token: "AT", refresh_token: "RT", scope: `${YOUTUBE_SCOPE}  ${GA4_SCOPE}` });
    await expect(googleExchange("code1")).resolves.toEqual({ refreshToken: "RT", accessToken: "AT", scopes: [YOUTUBE_SCOPE, GA4_SCOPE] });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("https://oauth2.googleapis.com/token");
  });
  it("sin «scope»: null (todo lo pedido)", async () => {
    token({ access_token: "AT", refresh_token: "RT" });
    await expect(googleExchange("code1")).resolves.toEqual({ refreshToken: "RT", accessToken: "AT", scopes: null });
  });
  it("sin refresh token sigue fallando", async () => {
    token({ access_token: "AT", scope: YOUTUBE_SCOPE });
    await expect(googleExchange("code1")).rejects.toThrow("permiso permanente");
  });
});

describe("conexiones guardadas sin el permiso: volver a conectar", () => {
  it("YouTube responde «insufficient authentication scopes» al subir", () => {
    expect(classifyFailure("403: Request had insufficient authentication scopes.", "youtube")).toBe("reconnect");
    expect(classifyFailure("403: ACCESS_TOKEN_SCOPE_INSUFFICIENT", "google")).toBe("reconnect");
    expect(needsReconnect("403: Request had insufficient authentication scopes.", "youtube")).toBe(true);
  });
});

describe("la tarjeta de YouTube pide los dos permisos", () => {
  it("pasos fáciles y a mano, en los dos idiomas", () => {
    const def = channelDef("youtube")!;
    for (const c of [def, channelText(def, "en")]) {
      expect(c.easy?.at(-1)).toMatch(/dos permisos|both permissions/);
      expect(c.steps.join(" ")).toContain("youtube.upload");
      expect(c.steps.join(" ")).toContain("youtube.readonly");
    }
    expect(channelText(def, "en").fields.find((f) => f.key === "clientId")?.placeholder).toBe("Leave empty if you connected with Google");
    expect(channelText(channelDef("google")!, "en").fields.find((f) => f.key === "clientId")?.placeholder).toBe("Leave empty if you connected with Google");
    expect(channelDef("google")!.fields.find((f) => f.key === "clientId")?.placeholder).toBe("Vacío si conectaste con Google");
  });
});
