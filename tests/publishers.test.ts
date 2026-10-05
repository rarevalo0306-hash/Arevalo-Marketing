import { afterEach, describe, expect, it, vi } from "vitest";
import { email, sms } from "@/lib/publishers/messaging";
import { facebook } from "@/lib/publishers/meta";

const base = { text: "Hola", subject: "Asunto", seoTitle: "", mediaType: "none" as const, mediaUrl: "", businessName: "Mi Negocio", contacts: [] };

function mockFetch(responses: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = responses.shift() ?? {};
    return new Response(JSON.stringify(body), { status: (body as { _status?: number })._status ?? 200 });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("Facebook", () => {
  it("publica texto en el feed de la página", async () => {
    const calls = mockFetch([{ id: "123_456" }]);
    const r = await facebook.publish(base, { pageId: "123", accessToken: "tok" });
    expect(calls[0].url).toBe("https://graph.facebook.com/v21.0/123/feed");
    expect(String(calls[0].init.body)).toContain("message=Hola");
    expect(r.url).toBe("https://www.facebook.com/123_456");
  });
  it("muestra el mensaje de error de la API", async () => {
    mockFetch([{ _status: 400, error: { message: "Invalid OAuth access token" } }]);
    await expect(facebook.publish(base, { pageId: "1", accessToken: "x" })).rejects.toThrow("Invalid OAuth access token");
  });
});

describe("Email y SMS solo a contactos con permiso", () => {
  const contacts = [
    { name: "A", email: "a@x.com", phone: "+15550000001", emailOptIn: true, smsOptIn: false },
    { name: "B", email: "b@x.com", phone: "+15550000002", emailOptIn: false, smsOptIn: true },
  ];
  it("email: envía uno por persona solo a quien aceptó", async () => {
    const calls = mockFetch([{ data: [] }]);
    const r = await email.publish({ ...base, contacts }, { apiKey: "k", from: "Yo <yo@x.com>" });
    const batch = JSON.parse(String(calls[0].init.body));
    expect(batch).toHaveLength(1);
    expect(batch[0].to).toEqual(["a@x.com"]);
    expect(r.detail).toContain("1 contacto");
  });
  it("email con Brevo: un mensaje por persona, con el remitente de la empresa", async () => {
    const calls = mockFetch([{ messageIds: ["m1"] }]);
    const r = await email.publish({ ...base, contacts }, { apiKey: "xkeysib-abc", from: "Ricardo PA <claims@ricardopa.com>" });
    expect(calls[0].url).toBe("https://api.brevo.com/v3/smtp/email");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.sender).toEqual({ name: "Ricardo PA", email: "claims@ricardopa.com" });
    expect(body.messageVersions).toEqual([{ to: [{ email: "a@x.com", name: "A" }] }]);
    expect(r.detail).toContain("1 contacto");
  });
  it("email sin clave propia usa la clave de Brevo de la app", async () => {
    process.env.BREVO_API_KEY = "xkeysib-app";
    const calls = mockFetch([{ messageIds: ["m1"] }]);
    await email.publish({ ...base, contacts }, { apiKey: "", from: "Ricardo PA <claims@ricardopa.com>" });
    delete process.env.BREVO_API_KEY;
    expect(calls[0].url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((calls[0].init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-app");
  });
  it("sms: solo a quien aceptó y con STOP", async () => {
    const calls = mockFetch([{ sid: "SM1" }]);
    await sms.publish({ ...base, contacts }, { accountSid: "AC1", authToken: "t", from: "+15559999999" });
    expect(calls).toHaveLength(1);
    const body = new URLSearchParams(String(calls[0].init.body));
    expect(body.get("To")).toBe("+15550000002");
    expect(body.get("Body")).toContain("STOP");
  });
  it("falla claro si nadie aceptó", async () => {
    mockFetch([]);
    await expect(email.publish({ ...base, contacts: [] }, { apiKey: "k", from: "x" })).rejects.toThrow("No hay contactos");
  });
});
