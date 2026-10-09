import { afterEach, describe, expect, it, vi } from "vitest";
import { facebook, instagram } from "@/lib/publishers/meta";
import { linkedin, linkedinPostBody } from "@/lib/publish-linkedin";
import { x } from "@/lib/publish-x";
import { google } from "@/lib/publishers/google";
import { mediaOf, type PublishInput } from "@/lib/publishers/types";

type Call = { url: string; method: string; body: string; form: URLSearchParams | null; json: unknown };

/** fetch falso: responde según la dirección (nunca se llama a las APIs de verdad). */
function mockFetch(route: (url: string, method: string, body: string) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const body = init.body instanceof URLSearchParams ? init.body.toString() : typeof init.body === "string" ? init.body : "";
      let json: unknown = null;
      try {
        json = body ? JSON.parse(body) : null;
      } catch {
        json = null;
      }
      calls.push({ url, method, body, form: init.body instanceof URLSearchParams ? init.body : null, json });
      const out = route(url, method, body);
      if (out instanceof Response) return out;
      return new Response(JSON.stringify(out ?? {}), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const PHOTOS = [
  { url: "https://cdn.test/1.jpg", type: "photo" as const, alt: "Portón rojo — portones enrollables en Managua" },
  { url: "https://cdn.test/2.jpg", type: "photo" as const, alt: "Cortina metálica — Managua" },
  { url: "https://cdn.test/3.jpg", type: "photo" as const },
];
const base: PublishInput = {
  text: "Nuevo trabajo #portones",
  subject: "",
  seoTitle: "",
  mediaType: "photo",
  mediaUrl: PHOTOS[0].url,
  businessName: "Fameseg",
  contacts: [],
};
const GRAPH = "https://graph.facebook.com/v21.0";

describe("Instagram", () => {
  it("carrusel: un contenedor por foto (is_carousel_item + alt_text), luego CAROUSEL con children y publicar", async () => {
    let n = 0;
    const calls = mockFetch((url, method) => {
      if (method === "POST" && url === `${GRAPH}/IG1/media`) return { id: `c${++n}` };
      if (url.includes("fields=status_code")) return { status_code: "FINISHED" };
      if (url === `${GRAPH}/IG1/media_publish`) return { id: "M9" };
      if (url.includes("fields=permalink")) return { permalink: "https://instagram.com/p/x" };
      return {};
    });
    const r = await instagram.publish({ ...base, kind: "carousel", media: PHOTOS }, { igUserId: "IG1", accessToken: "tok" });
    const creates = calls.filter((c) => c.method === "POST" && c.url === `${GRAPH}/IG1/media`);
    expect(creates).toHaveLength(4);
    for (const [i, c] of creates.slice(0, 3).entries()) {
      expect(c.form!.get("image_url")).toBe(PHOTOS[i].url);
      expect(c.form!.get("is_carousel_item")).toBe("true");
      expect(c.form!.get("caption")).toBeNull();
    }
    expect(creates[0].form!.get("alt_text")).toBe(PHOTOS[0].alt);
    expect(creates[2].form!.get("alt_text")).toBeNull();
    const parent = creates[3].form!;
    expect(parent.get("media_type")).toBe("CAROUSEL");
    expect(parent.get("children")).toBe("c1,c2,c3");
    expect(parent.get("caption")).toBe(base.text);
    const pub = calls.find((c) => c.url === `${GRAPH}/IG1/media_publish`)!;
    expect(pub.form!.get("creation_id")).toBe("c4");
    expect(r.url).toBe("https://instagram.com/p/x");
    expect(r.detail).toMatch(/Carrusel de 3 fotos/);
  });

  it("historia: media_type=STORIES con image_url (sin texto ni alt_text)", async () => {
    const calls = mockFetch((url, method) => (method === "POST" && url.endsWith("/media") ? { id: "s1" } : url.endsWith("/media_publish") ? { id: "M1" } : {}));
    const r = await instagram.publish({ ...base, kind: "story", media: [PHOTOS[0]] }, { igUserId: "IG1", accessToken: "tok" });
    const create = calls.find((c) => c.method === "POST" && c.url === `${GRAPH}/IG1/media`)!.form!;
    expect(create.get("media_type")).toBe("STORIES");
    expect(create.get("image_url")).toBe(PHOTOS[0].url);
    expect(create.get("caption")).toBeNull();
    expect(create.get("alt_text")).toBeNull();
    expect(r.detail).toBe("Historia publicada en Instagram");
  });

  it("historia de video: video_url", async () => {
    const calls = mockFetch((url, method) => (method === "POST" && url.endsWith("/media") ? { id: "s1" } : url.endsWith("/media_publish") ? { id: "M1" } : {}));
    await instagram.publish({ ...base, kind: "story", mediaType: "video", media: [{ url: "https://cdn.test/v.mp4", type: "video" }] }, { igUserId: "IG1", accessToken: "tok" });
    const create = calls.find((c) => c.method === "POST" && c.url === `${GRAPH}/IG1/media`)!.form!;
    expect(create.get("media_type")).toBe("STORIES");
    expect(create.get("video_url")).toBe("https://cdn.test/v.mp4");
  });

  it("una foto como siempre (con alt_text si hay); sin media[] usa mediaUrl", async () => {
    const calls = mockFetch((url, method) => (method === "POST" && url.endsWith("/media") ? { id: "c1" } : url.endsWith("/media_publish") ? { id: "M1" } : {}));
    await instagram.publish({ ...base, altText: "Portón — Managua" }, { igUserId: "IG1", accessToken: "tok" });
    const create = calls.find((c) => c.method === "POST" && c.url === `${GRAPH}/IG1/media`)!.form!;
    expect(create.get("image_url")).toBe(PHOTOS[0].url);
    expect(create.get("caption")).toBe(base.text);
    expect(create.get("alt_text")).toBe("Portón — Managua");
    expect(create.get("media_type")).toBeNull();
  });
});

describe("Facebook", () => {
  it("varias fotos: se suben sin publicar (published=false, alt_text_custom) y /feed con attached_media", async () => {
    let n = 0;
    const calls = mockFetch((url) => (url === `${GRAPH}/P1/photos` ? { id: `ph${++n}` } : url === `${GRAPH}/P1/feed` ? { id: "P1_77" } : {}));
    const r = await facebook.publish({ ...base, kind: "carousel", media: PHOTOS }, { pageId: "P1", accessToken: "tok" });
    const ups = calls.filter((c) => c.url === `${GRAPH}/P1/photos`);
    expect(ups).toHaveLength(3);
    expect(ups.map((c) => c.form!.get("published"))).toEqual(["false", "false", "false"]);
    expect(ups[0].form!.get("url")).toBe(PHOTOS[0].url);
    expect(ups[0].form!.get("alt_text_custom")).toBe(PHOTOS[0].alt);
    expect(ups[2].form!.get("alt_text_custom")).toBeNull();
    const feed = calls.find((c) => c.url === `${GRAPH}/P1/feed`)!.form!;
    expect(feed.get("message")).toBe(base.text);
    expect(JSON.parse(feed.get("attached_media[0]")!)).toEqual({ media_fbid: "ph1" });
    expect(JSON.parse(feed.get("attached_media[2]")!)).toEqual({ media_fbid: "ph3" });
    expect(r.url).toBe("https://www.facebook.com/P1_77");
    expect(r.detail).toMatch(/3 fotos/);
  });

  it("historia de foto: foto sin publicar y /photo_stories con photo_id", async () => {
    const calls = mockFetch((url) => (url === `${GRAPH}/P1/photos` ? { id: "ph1" } : url === `${GRAPH}/P1/photo_stories` ? { success: true, post_id: "S5" } : {}));
    const r = await facebook.publish({ ...base, kind: "story", media: [PHOTOS[0]] }, { pageId: "P1", accessToken: "tok" });
    expect(calls[0].form!.get("published")).toBe("false");
    const st = calls.find((c) => c.url === `${GRAPH}/P1/photo_stories`)!.form!;
    expect(st.get("photo_id")).toBe("ph1");
    expect(r.detail).toBe("Historia publicada en Facebook");
  });

  it("si Facebook no acepta la historia, se publica como post y lo dice", async () => {
    mockFetch((url) =>
      url === `${GRAPH}/P1/photo_stories`
        ? new Response(JSON.stringify({ error: { message: "Unsupported" } }), { status: 400 })
        : url === `${GRAPH}/P1/photos`
          ? { id: "ph1", post_id: "P1_1" }
          : {},
    );
    const r = await facebook.publish({ ...base, kind: "story", media: [PHOTOS[0]] }, { pageId: "P1", accessToken: "tok" });
    expect(r.detail).toMatch(/se publicó como post/);
  });

  it("una foto con texto alternativo", async () => {
    const calls = mockFetch(() => ({ id: "ph1", post_id: "P1_2" }));
    await facebook.publish({ ...base, media: [PHOTOS[0]] }, { pageId: "P1", accessToken: "tok" });
    expect(calls[0].url).toBe(`${GRAPH}/P1/photos`);
    expect(calls[0].form!.get("caption")).toBe(base.text);
    expect(calls[0].form!.get("alt_text_custom")).toBe(PHOTOS[0].alt);
    expect(calls[0].form!.get("published")).toBeNull();
  });
});

describe("X", () => {
  const creds = { apiKey: "k", apiSecret: "s", accessToken: "t", accessSecret: "a" };
  it("hasta 4 fotos, cada una con su texto alternativo, en un solo post", async () => {
    let n = 0;
    const calls = mockFetch((url) => {
      if (url.startsWith("https://cdn.test/")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/jpeg" } });
      if (url === "https://api.x.com/2/media/upload") return { data: { id: `${++n}00` } };
      if (url === "https://api.x.com/2/tweets") return { data: { id: "T1" } };
      return {};
    });
    const six = [...PHOTOS, ...PHOTOS];
    const r = await x.publish({ ...base, kind: "carousel", media: six }, creds);
    expect(calls.filter((c) => c.url === "https://api.x.com/2/media/upload")).toHaveLength(4);
    const meta = calls.filter((c) => c.url === "https://api.x.com/2/media/metadata");
    expect(meta[0].json).toEqual({ id: "100", metadata: { alt_text: { text: PHOTOS[0].alt } } });
    const tweet = calls.find((c) => c.url === "https://api.x.com/2/tweets")!.json as { text: string; media: { media_ids: string[] } };
    expect(tweet.media.media_ids).toEqual(["100", "200", "300", "400"]);
    expect(tweet.text).toBe(base.text);
    expect(r.detail).toMatch(/4 fotos/);
  });
  it("una sola foto en un post normal", async () => {
    const calls = mockFetch((url) => {
      if (url.startsWith("https://cdn.test/")) return new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/jpeg" } });
      if (url === "https://api.x.com/2/media/upload") return { data: { id: "9" } };
      return { data: { id: "T2" } };
    });
    await x.publish({ ...base, media: PHOTOS }, creds);
    expect(calls.filter((c) => c.url === "https://api.x.com/2/media/upload")).toHaveLength(1);
  });
});

describe("LinkedIn y Google", () => {
  it("LinkedIn: varias fotos van en content.multiImage con altText", () => {
    const body = linkedinPostBody("urn:li:person:1", "Hola", [{ id: "urn:li:image:A", altText: "uno" }, { id: "urn:li:image:B" }]);
    expect(body.content).toEqual({ multiImage: { images: [{ id: "urn:li:image:A", altText: "uno" }, { id: "urn:li:image:B" }] } });
    expect(linkedinPostBody("urn:li:person:1", "Hola", { id: "urn:li:image:A", altText: "uno" }).content).toEqual({ media: { id: "urn:li:image:A", altText: "uno" } });
    expect(linkedinPostBody("urn:li:person:1", "Hola").content).toBeUndefined();
  });
  it("LinkedIn: sube cada foto del carrusel y publica una sola vez", async () => {
    let n = 0;
    const calls = mockFetch((url, method) => {
      if (url.includes("/rest/images?action=initializeUpload")) return { value: { uploadUrl: `https://up.test/${++n}`, image: `urn:li:image:${n}` } };
      if (url.startsWith("https://cdn.test/")) return new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/jpeg" } });
      if (url.startsWith("https://up.test/")) return new Response("", { status: 201 });
      if (url.endsWith("/rest/posts") && method === "POST") return new Response("", { status: 201, headers: { "x-restli-id": "urn:li:share:9" } });
      return {};
    });
    const r = await linkedin.publish({ ...base, kind: "carousel", media: PHOTOS }, { accessToken: "tok", author: "urn:li:organization:5" });
    const post = calls.find((c) => c.url.endsWith("/rest/posts"))!.json as { content: { multiImage: { images: { id: string; altText?: string }[] } } };
    expect(post.content.multiImage.images.map((i) => i.id)).toEqual(["urn:li:image:1", "urn:li:image:2", "urn:li:image:3"]);
    expect(post.content.multiImage.images[0].altText).toBe(PHOTOS[0].alt);
    expect(r.detail).toMatch(/3 fotos/);
  });
  it("Google: solo la primera foto", async () => {
    const calls = mockFetch((url) => (url.includes("oauth2") ? { access_token: "g" } : { searchUrl: "https://g.co/x" }));
    const r = await google.publish({ ...base, kind: "carousel", media: PHOTOS }, { clientId: "a", clientSecret: "b", refreshToken: "c", accountId: "1", locationId: "2" });
    const body = calls.find((c) => c.url.includes("localPosts"))!.json as { media: { sourceUrl: string }[] };
    expect(body.media).toEqual([{ mediaFormat: "PHOTO", sourceUrl: PHOTOS[0].url }]);
    expect(r.detail).toMatch(/primera foto/);
  });
  it("mediaOf: publicaciones de antes siguen usando mediaUrl", () => {
    expect(mediaOf({ mediaUrl: "https://a/1.jpg", mediaType: "photo", altText: "x" })).toEqual([{ url: "https://a/1.jpg", type: "photo", alt: "x" }]);
    expect(mediaOf({ mediaUrl: "", mediaType: "none" })).toEqual([]);
  });
});
