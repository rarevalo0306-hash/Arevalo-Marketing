import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Las métricas leen la base: aquí no se toca.
vi.mock("@/lib/db", () => ({ db: {} }));

import { fetchYoutube } from "@/lib/post-metrics";
import { google, googleAccessToken, googleClient } from "@/lib/publishers/google";
import { youtube } from "@/lib/publishers/youtube";

const APP_ID = "app-id.apps.googleusercontent.com";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Call = { url: string; body: string };
function mockFetch(rest: (url: string) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), body: String(init.body ?? "") });
      return String(url) === "https://oauth2.googleapis.com/token" ? json({ access_token: "AT" }) : rest(String(url));
    }),
  );
  return calls;
}
/** El cliente con que se pidió el token. */
const tokenClient = (calls: Call[]) => {
  const q = new URLSearchParams(calls.find((c) => c.url === "https://oauth2.googleapis.com/token")?.body ?? "");
  return { id: q.get("client_id"), secret: q.get("client_secret"), refresh: q.get("refresh_token") };
};

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", APP_ID);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "app-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("googleClient: con qué cliente se renueva el permiso", () => {
  it("conexión nueva de «Conectar con Google» (sin copia): el cliente de la app", () => {
    expect(googleClient({ refreshToken: "RT" })).toEqual({ clientId: APP_ID, clientSecret: "app-secret" });
    expect(googleClient({ clientId: "  ", refreshToken: "RT" })).toEqual({ clientId: APP_ID, clientSecret: "app-secret" });
  });
  it("conexión vieja con copia del cliente de la app: la clave actual del servidor, no la copia", () => {
    expect(googleClient({ clientId: APP_ID, clientSecret: "stale", refreshToken: "RT" })).toEqual({ clientId: APP_ID, clientSecret: "app-secret" });
  });
  it("conexión pegada a mano con su propio cliente: el guardado", () => {
    expect(googleClient({ clientId: " own-id ", clientSecret: " own-secret ", refreshToken: "RT" })).toEqual({ clientId: "own-id", clientSecret: "own-secret" });
  });
  it("sin cliente en el servidor: el guardado", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(googleClient({ clientId: "own-id", clientSecret: "own-secret" })).toEqual({ clientId: "own-id", clientSecret: "own-secret" });
  });
  it("cliente propio sin su clave: falta un dato (volver a conectar)", async () => {
    const calls = mockFetch(() => json({}));
    await expect(googleAccessToken({ clientId: "own-id", refreshToken: "RT" })).rejects.toThrow("Faltan datos de la conexión: clientSecret");
    await expect(googleAccessToken({})).rejects.toThrow("Faltan datos de la conexión: refreshToken");
    expect(calls).toHaveLength(0);
  });
});

describe("Perfil de Negocio y YouTube publican sin copia del cliente", () => {
  it("Google: publicar y probar con solo cuenta, ubicación y refresh token", async () => {
    const creds = { accountId: "1", locationId: "2", refreshToken: "RT" };
    let calls = mockFetch(() => json({ name: "accounts/1/locations/2/localPosts/3", searchUrl: "https://local.google.com/x" }));
    const input = { text: "Hola", subject: "", seoTitle: "", mediaType: "none" as const, mediaUrl: "", businessName: "Fameseg", contacts: [] };
    expect((await google.publish(input, creds)).id).toBe("accounts/1/locations/2/localPosts/3");
    expect(tokenClient(calls)).toEqual({ id: APP_ID, secret: "app-secret", refresh: "RT" });
    calls = mockFetch(() => json({ title: "Fameseg" }));
    await expect(google.test(creds)).resolves.toBe('Conectado a "Fameseg"');
    expect(tokenClient(calls)).toEqual({ id: APP_ID, secret: "app-secret", refresh: "RT" });
  });
  it("Google: una conexión vieja ya no usa la clave copiada", async () => {
    const calls = mockFetch(() => json({ title: "Fameseg" }));
    await google.test({ accountId: "1", locationId: "2", clientId: APP_ID, clientSecret: "stale", refreshToken: "RT" });
    expect(tokenClient(calls).secret).toBe("app-secret");
  });
  it("YouTube: probar con solo el refresh token", async () => {
    const calls = mockFetch(() => json({ items: [{ id: "UC1", snippet: { title: "Fameseg" } }] }));
    await expect(youtube.test({ refreshToken: "RT", channelId: "UC1" })).resolves.toBe("Conectado al canal Fameseg");
    expect(tokenClient(calls)).toEqual({ id: APP_ID, secret: "app-secret", refresh: "RT" });
  });
  it("YouTube: un cliente propio pegado a mano se sigue usando", async () => {
    const calls = mockFetch(() => json({ items: [{ id: "UC1" }] }));
    await youtube.test({ clientId: "own-id", clientSecret: "own-secret", refreshToken: "RT" });
    expect(tokenClient(calls)).toEqual({ id: "own-id", secret: "own-secret", refresh: "RT" });
  });
  it("YouTube: las métricas también usan el cliente de la app", async () => {
    const calls = mockFetch(() => json({ items: [{ id: "v1", statistics: { viewCount: "5" } }] }));
    const r = await fetchYoutube(["v1"], { refreshToken: "RT" });
    expect(r.v1.ok).toBe(true);
    expect(tokenClient(calls)).toEqual({ id: APP_ID, secret: "app-secret", refresh: "RT" });
  });
  it("YouTube: métricas sin datos de la conexión, el mismo error de siempre", async () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const calls = mockFetch(() => json({}));
    const r = await fetchYoutube(["v1"], { refreshToken: "RT" });
    expect(r.v1.ok).toBe(false);
    if (!r.v1.ok) expect(r.v1.error).toMatch(/faltan datos de la conexión de YouTube/);
    expect(calls).toHaveLength(0);
  });
});
