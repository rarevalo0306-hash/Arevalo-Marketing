import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notesFor } from "@/lib/channels";
import { googleAuthUrl, googleStatePurpose, YOUTUBE_SCOPE } from "@/lib/google-oauth";
import { readState } from "@/lib/meta-oauth";
import { PUBLISHERS } from "@/lib/publishers";
import { uploadInitRequest, youtube, youtubeMetadata, youtubeTags } from "@/lib/publishers/youtube";
import { tagsLength } from "@/lib/video-plan";

const base = {
  text: "Cortinas metálicas en Managua: instalamos la tuya en un día.\n\n📞 +505 8888 0000\n\n#Shorts #CortinasMetalicas #Managua",
  subject: "",
  seoTitle: "Cortinas metálicas en Managua | Fameseg #Shorts",
  mediaType: "video" as const,
  mediaUrl: "https://x.supabase.co/storage/v1/object/public/media/b/cortinas-metalicas-managua-reel-abc.mp4",
  businessName: "Fameseg",
  keywords: ["cortinas metálicas", "puertas enrollables"],
  contacts: [],
};
const creds = { clientId: "cid", clientSecret: "sec", refreshToken: "rt" };

type Call = { url: string; init: RequestInit };
function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
  return calls;
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

afterEach(() => vi.unstubAllGlobals());

describe("YouTube: lo que se manda", () => {
  it("título del seoTitle (≤ 100), descripción del texto, etiquetas con palabras clave, público y no para niños", () => {
    const m = youtubeMetadata(base);
    expect(m.snippet.title).toBe("Cortinas metálicas en Managua | Fameseg #Shorts");
    expect(m.snippet.description).toBe(base.text);
    expect(m.snippet.tags.slice(0, 2)).toEqual(["cortinas metálicas", "puertas enrollables"]);
    expect(m.snippet.tags).toContain("Managua");
    expect(m.snippet.tags).not.toContain("Shorts");
    expect(m.snippet.categoryId).toBe("22");
    expect(m.status).toEqual({ privacyStatus: "public", selfDeclaredMadeForKids: false, embeddable: true });
  });
  it("sin seoTitle usa la primera línea sin hashtags ni enlaces, sin < > y como mucho 100 caracteres", () => {
    const m = youtubeMetadata({ ...base, seoTitle: "", text: `<b>${"Puertas enrollables ".repeat(8)}</b> https://x.com #tag\nOtra línea` });
    expect(m.snippet.title.length).toBeLessThanOrEqual(100);
    expect(m.snippet.title).not.toMatch(/[<>#]|https/);
    expect(m.snippet.description).not.toMatch(/[<>]/);
  });
  it("etiquetas ≤ 500 caracteres", () => {
    const tags = youtubeTags(Array.from({ length: 120 }, (_, i) => `#EtiquetaLarga${i}`).join(" "), ["cortinas metálicas"]);
    expect(tagsLength(tags)).toBeLessThanOrEqual(500);
    expect(tags[0]).toBe("cortinas metálicas");
  });
  it("arma la subida reanudable", () => {
    const r = uploadInitRequest(youtubeMetadata(base), 1234, "video/mp4", "tok");
    expect(r.url).toBe("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status");
    const h = r.init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer tok");
    expect(h["X-Upload-Content-Type"]).toBe("video/mp4");
    expect(h["X-Upload-Content-Length"]).toBe("1234");
    expect(JSON.parse(String(r.init.body)).status.selfDeclaredMadeForKids).toBe(false);
  });
});

describe("YouTube: publicar (sin subir de verdad)", () => {
  it("token → descarga el video → pide la dirección → sube los bytes → devuelve el Short", async () => {
    const calls = mockFetch((url, init) => {
      if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "AT" });
      if (url === base.mediaUrl) return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "Content-Type": "video/mp4" } });
      if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable")) return new Response("", { status: 200, headers: { Location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=XYZ" } });
      if (url.includes("upload_id=XYZ") && init.method === "PUT") return json({ id: "vid123" });
      return json({ error: { message: "unexpected" } }, 500);
    });
    const r = await youtube.publish(base, creds);
    expect(calls.map((c) => c.url.split("?")[0])).toEqual([
      "https://oauth2.googleapis.com/token",
      base.mediaUrl,
      "https://www.googleapis.com/upload/youtube/v3/videos",
      "https://www.googleapis.com/upload/youtube/v3/videos",
    ]);
    expect(String(calls[0].init.body)).toContain("grant_type=refresh_token");
    expect(String(calls[0].init.body)).toContain("refresh_token=rt");
    const init = calls[2].init;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Upload-Content-Length"]).toBe("4");
    const meta = JSON.parse(String(init.body));
    expect(meta.snippet.title).toMatch(/#Shorts$/);
    expect(meta.status.privacyStatus).toBe("public");
    expect(calls[3].init.method).toBe("PUT");
    expect((calls[3].init.body as Uint8Array).byteLength).toBe(4);
    expect(r.url).toBe("https://www.youtube.com/shorts/vid123");
    expect(r.detail).toContain("Short");
  });
  it("video horizontal (sin #Shorts): enlace normal", async () => {
    mockFetch((url, init) => {
      if (url.includes("oauth2")) return json({ access_token: "AT" });
      if (url === base.mediaUrl) return new Response(new Uint8Array([1]), { status: 200, headers: { "Content-Type": "video/mp4" } });
      if (url.includes("uploadType=resumable")) return new Response("", { status: 200, headers: { Location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=Q" } });
      if (init.method === "PUT") return json({ id: "h1" });
      return json({}, 500);
    });
    const r = await youtube.publish({ ...base, seoTitle: "Cortinas metálicas en Managua", text: "Video largo" }, creds);
    expect(r.url).toBe("https://youtu.be/h1");
  });
  it("explica el límite de subidas", async () => {
    mockFetch((url) => {
      if (url.includes("oauth2")) return json({ access_token: "AT" });
      if (url === base.mediaUrl) return new Response(new Uint8Array([1]), { status: 200 });
      return json({ error: { message: "quota", errors: [{ reason: "uploadLimitExceeded" }] } }, 400);
    });
    await expect(youtube.publish(base, creds)).rejects.toThrow("límite de subidas");
  });
  it("no sube a una dirección que no es de Google", async () => {
    mockFetch((url) => {
      if (url.includes("oauth2")) return json({ access_token: "AT" });
      if (url === base.mediaUrl) return new Response(new Uint8Array([1]), { status: 200 });
      return new Response("", { status: 200, headers: { Location: "https://evil.example.com/upload" } });
    });
    await expect(youtube.publish(base, creds)).rejects.toThrow("dirección para subir");
  });
  it("sin video no intenta nada", async () => {
    const calls = mockFetch(() => json({}));
    await expect(youtube.publish({ ...base, mediaType: "photo" }, creds)).rejects.toThrow("necesita un video");
    expect(calls).toHaveLength(0);
  });
  it("probar la conexión: nombre del canal", async () => {
    mockFetch((url) => (url.includes("oauth2") ? json({ access_token: "AT" }) : json({ items: [{ id: "UC1", snippet: { title: "Fameseg Nicaragua" } }] })));
    await expect(youtube.test(creds)).resolves.toBe("Conectado al canal Fameseg Nicaragua");
  });
  it("está registrado como canal y pide video", () => {
    expect(PUBLISHERS.youtube).toBe(youtube);
    const draft = { text: "Hola", subject: "", seoTitle: "", mediaType: "photo" as const };
    expect(notesFor("youtube", draft).some((n) => n.id === "needsVideo" && n.blocking)).toBe(true);
    expect(notesFor("youtube", { ...draft, mediaType: "video" }).some((n) => n.blocking)).toBe(false);
  });
});

describe("Conectar YouTube con Google", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "cid.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.PUBLIC_BASE_URL = "https://app.example.com/";
    process.env.APP_SECRET = "test-secret";
  });
  it("pide permiso para subir videos, usa el mismo regreso y marca el propósito", () => {
    const u = new URL(googleAuthUrl("biz123", "youtube"));
    expect(u.searchParams.get("scope")).toContain(YOUTUBE_SCOPE);
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/google/callback");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(googleStatePurpose(readState(u.searchParams.get("state")!)!)).toEqual({ purpose: "youtube", businessId: "biz123" });
  });
});
