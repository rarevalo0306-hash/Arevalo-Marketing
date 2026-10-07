import { afterEach, describe, expect, it, vi } from "vitest";
import { escapeLinkedinText, linkedin, linkedinAuthor, linkedinPostBody } from "@/lib/publish-linkedin";
import { oauthHeader, x } from "@/lib/publish-x";

afterEach(() => vi.unstubAllGlobals());

describe("X: firma OAuth 1.0a", () => {
  it("coincide con el ejemplo oficial de la documentación", () => {
    const header = oauthHeader(
      "POST",
      "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
      {
        apiKey: "xvz1evFS4wEEPTGEFPHBog",
        apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
        accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
      },
      { status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
      { nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp: "1318622958" },
    );
    expect(header).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"');
  });

  it("publica texto con POST /2/tweets", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { id: "123", text: "Hola" } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await x.publish(
      { text: "Hola", subject: "", seoTitle: "", mediaType: "none", mediaUrl: "", businessName: "Fameseg", contacts: [] },
      { apiKey: "a", apiSecret: "b", accessToken: "c", accessSecret: "d" },
    );
    expect(res.url).toBe("https://x.com/i/web/status/123");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.x.com/2/tweets");
    expect(JSON.parse(String(init.body))).toEqual({ text: "Hola" });
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^OAuth oauth_consumer_key="a"/);
  });

  it("explica que hay que reconectar si las claves no sirven", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ title: "Unauthorized", detail: "Unauthorized" }), { status: 401 })));
    await expect(x.test({ apiKey: "a", apiSecret: "b", accessToken: "c", accessSecret: "d" })).rejects.toThrow(/token/);
  });

  it("pide las 4 claves", async () => {
    await expect(x.test({ apiKey: "a" })).rejects.toThrow(/Faltan datos/);
  });
});

describe("LinkedIn", () => {
  it("escapa los caracteres especiales pero deja los hashtags", () => {
    expect(escapeLinkedinText("Hola (Managua) #Portones @fameseg")).toBe("Hola \\(Managua\\) #Portones \\@fameseg");
  });

  it("usa la empresa escrita en «Publicar como»", async () => {
    expect(await linkedinAuthor({ accessToken: "t", author: "12345" })).toBe("urn:li:organization:12345");
    expect(await linkedinAuthor({ accessToken: "t", author: "urn:li:organization:9" })).toBe("urn:li:organization:9");
    await expect(linkedinAuthor({ accessToken: "t", author: "mi empresa" })).rejects.toThrow(/Publicar como/);
  });

  it("publica en el perfil del dueño del token", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/v2/userinfo")
        ? new Response(JSON.stringify({ sub: "abc", name: "Ricardo" }), { status: 200 })
        : new Response("", { status: 201, headers: { "x-restli-id": "urn:li:share:1" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await linkedin.publish(
      { text: "Hola", subject: "", seoTitle: "", mediaType: "none", mediaUrl: "", businessName: "Fameseg", contacts: [] },
      { accessToken: "t", author: "" },
    );
    expect(res.url).toBe("https://www.linkedin.com/feed/update/urn:li:share:1/");
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.linkedin.com/rest/posts");
    expect(JSON.parse(String(init.body))).toEqual(linkedinPostBody("urn:li:person:abc", "Hola"));
    expect((init.headers as Record<string, string>)["LinkedIn-Version"]).toMatch(/^\d{6}$/);
  });

  it("un token vencido pide volver a conectar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Invalid access token" }), { status: 401 })));
    await expect(linkedin.test({ accessToken: "t" })).rejects.toThrow(/token/);
  });
});

describe("los errores de token piden volver a conectar (Conexiones)", () => {
  it("LinkedIn y X: 401 y 403 se reconocen como «volver a conectar»", async () => {
    const { needsReconnect } = await import("@/lib/publish-errors");
    expect(needsReconnect("401: LinkedIn rechazó el token (venció o se revocó).", "linkedin")).toBe(true);
    expect(needsReconnect("403: Forbidden — el token no tiene permiso para publicar aquí", "linkedin")).toBe(true);
    expect(needsReconnect("401: X rechazó las claves (token inválido o revocado).", "x")).toBe(true);
    expect(needsReconnect("403: X no deja publicar exactamente el mismo texto dos veces.", "x")).toBe(false);
  });
});
