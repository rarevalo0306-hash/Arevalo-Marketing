import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Base de datos y Gemini simulados.
const businesses: { id: string; name: string; color: string; logoUrl: string; logoLightUrl: string; uploadToken: string }[] = [];
const items = new Map<string, Record<string, unknown>>();
const upserts: Record<string, unknown>[] = [];
const updates: { id: string; data: Record<string, unknown> }[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    business: {
      findMany: vi.fn(async () => businesses.filter((b) => b.uploadToken)),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        name: "Fameseg",
        aiProfile: "Cortinas metálicas en Managua",
        study: null,
        studyInput: null,
        seoLanguage: "es",
        driveFolderId: "",
      })),
    },
    libraryItem: {
      findUnique: vi.fn(async ({ where }: { where: { businessId_externalId: { externalId: string } } }) => {
        const it = [...items.values()].find((x) => x.externalId === where.businessId_externalId.externalId);
        return it ? { id: it.id } : null;
      }),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        upserts.push(create);
        const id = `item${upserts.length}`;
        items.set(id, { id, ...create, error: "" });
        return { id };
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        [...items.values()].filter((x) => x.businessId === where.businessId && x.status === where.status && (!where.source || x.source === where.source)),
      ),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string; error: string }; data: Record<string, unknown> }) => {
        const it = items.get(where.id);
        if (!it || it.status !== where.status || it.error !== where.error) return { count: 0 };
        Object.assign(it, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: where.id, data });
        Object.assign(items.get(where.id) ?? {}, data);
        return items.get(where.id);
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        [...items.values()].filter((x) => x.businessId === where.businessId && x.status === where.status && (!where.source || x.source === where.source)).length,
      ),
    },
  },
}));

const askGemini = vi.fn();
vi.mock("@/lib/ai", () => ({ askGemini: (...a: unknown[]) => askGemini(...a) }));

import { analyzeUploads, claimable, CLAIM_STALE_MS, pickBatch, pickUploadBusiness } from "@/lib/library-sync";
import { businessForToken, fileDate, finishUpload, guard, newUploadToken, RateLimiter, signFor, tokenEquals, UploadError } from "@/lib/upload";
import { checkUploadFile, cleanNote, IMAGE_MAX_BYTES, langFromAcceptLanguage, MAX_FILES, TOKEN_RE, uploadType, VIDEO_MAX_BYTES } from "@/lib/upload-rules";

const R2 = { R2_ACCOUNT_ID: "acc", R2_ACCESS_KEY_ID: "AK", R2_SECRET_ACCESS_KEY: "SK", R2_BUCKET: "arevalo-media", R2_PUBLIC_URL: "https://pub-x.r2.dev" };
const BIZ = "cmuvspllw0000l6047ocei6sx";
const TOKEN = "A".repeat(16) + "b-_9".repeat(4);

beforeEach(() => {
  businesses.splice(0, businesses.length, { id: BIZ, name: "Fameseg", color: "#126BBC", logoUrl: "", logoLightUrl: "", uploadToken: TOKEN });
  items.clear();
  upserts.length = 0;
  updates.length = 0;
  askGemini.mockReset();
  for (const [k, v] of Object.entries(R2)) vi.stubEnv(k, v);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("qué se puede subir", () => {
  it("tipos y tamaños", () => {
    expect(checkUploadFile({ name: "a.jpg", type: "image/jpeg", size: 1000 })).toMatchObject({ ok: true, ext: "jpg", kind: "photo" });
    expect(checkUploadFile({ name: "IMG_1.HEIC", type: "", size: 1000 })).toMatchObject({ ok: true, type: "image/heic", ext: "heic" });
    expect(checkUploadFile({ name: "v.mov", type: "video/quicktime", size: VIDEO_MAX_BYTES })).toMatchObject({ ok: true, ext: "mov", kind: "video" });
    expect(checkUploadFile({ name: "v.mp4", type: "video/mp4", size: VIDEO_MAX_BYTES + 1 })).toMatchObject({ ok: false });
    expect(checkUploadFile({ name: "a.png", type: "image/png", size: IMAGE_MAX_BYTES + 1 })).toMatchObject({ ok: false, es: expect.stringContaining("40 MB") });
    expect(checkUploadFile({ name: "doc.pdf", type: "application/pdf", size: 10 })).toMatchObject({ ok: false });
    expect(checkUploadFile({ name: "a.gif", type: "image/gif", size: 10 })).toMatchObject({ ok: false });
    expect(checkUploadFile({ name: "a.jpg", type: "image/jpeg", size: 0 })).toMatchObject({ ok: false });
    expect(uploadType("application/octet-stream", "clip.MP4")).toBe("video/mp4");
    expect(uploadType("image/jpg", "x")).toBe("image/jpeg");
    expect(MAX_FILES).toBe(30);
  });

  it("nota corta y limpia; idioma del celular", () => {
    expect(cleanNote("  Cortina\n en   Ferretería López  ")).toBe("Cortina en Ferretería López");
    expect(cleanNote("x".repeat(300))).toHaveLength(120);
    expect(langFromAcceptLanguage("en-US,en;q=0.9,es;q=0.8")).toBe("en");
    expect(langFromAcceptLanguage("es-NI,es;q=0.9,en;q=0.8")).toBe("es");
    expect(langFromAcceptLanguage("fr-FR,en;q=0.5")).toBe("en");
    expect(langFromAcceptLanguage("es;q=0.4,en;q=0.6")).toBe("en");
    expect(langFromAcceptLanguage("")).toBe("es");
    expect(langFromAcceptLanguage(null)).toBe("es");
  });

  it("fecha del archivo: la del celular si tiene sentido", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    expect(fileDate(Date.parse("2026-09-01T10:00:00Z"), now).toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(fileDate(0, now)).toEqual(now);
    expect(fileDate(Date.parse("2030-01-01"), now)).toEqual(now);
    expect(fileDate("x", now)).toEqual(now);
  });
});

describe("el link", () => {
  it("32 caracteres al azar y comparación exacta", () => {
    const a = newUploadToken();
    expect(a).toMatch(TOKEN_RE);
    expect(newUploadToken()).not.toBe(a);
    expect(tokenEquals(a, a)).toBe(true);
    expect(tokenEquals(a, a.slice(0, 31) + (a[31] === "x" ? "y" : "x"))).toBe(false);
    expect(tokenEquals(a, "")).toBe(false);
    expect(tokenEquals("", "")).toBe(false);
  });

  it("encuentra el negocio solo con el link exacto y vigente", async () => {
    expect((await businessForToken(TOKEN))?.id).toBe(BIZ);
    expect(await businessForToken(TOKEN.toLowerCase())).toBeNull();
    expect(await businessForToken("corto")).toBeNull();
    businesses[0].uploadToken = newUploadToken(); // lo cambiaron
    expect(await businessForToken(TOKEN)).toBeNull();
  });

  it("link viejo: mensaje amable; muchos intentos: espera; sin R2: avisa", async () => {
    const bad = "Z".repeat(32);
    await expect(guard(bad, "9.9.9.9", "sign")).rejects.toThrow("Este link ya no sirve. Pídele uno nuevo a tu jefe.");
    let last: unknown;
    for (let i = 0; i < 25; i++) last = await guard(bad, "9.9.9.9", "sign").catch((e) => e);
    expect(last).toBeInstanceOf(UploadError);
    expect((last as UploadError).status).toBe(429);
    expect((await guard(TOKEN, "1.1.1.1", "sign")).id).toBe(BIZ);
    vi.stubEnv("R2_BUCKET", "");
    await expect(guard(TOKEN, "1.1.1.1", "sign")).rejects.toMatchObject({ status: 503 });
  });
});

describe("límite de pedidos", () => {
  it("cuenta por clave dentro de la ventana", () => {
    const r = new RateLimiter(3, 1000);
    expect([r.take("a", 0), r.take("a", 10), r.take("a", 20), r.take("a", 30)]).toEqual([true, true, true, false]);
    expect(r.take("b", 30)).toBe(true);
    expect(r.take("a", 1005)).toBe(true); // ya pasó el primero
    expect(r.take("a", 1006)).toBe(false);
  });
});

describe("firmar y terminar la subida", () => {
  it("firma con una llave del negocio y el tipo exacto", () => {
    const s = signFor(BIZ, { name: "IMG_20.jpg", type: "image/jpeg", size: 2_000_000 }, new Date("2026-10-08T12:00:00Z"));
    expect(s.key).toMatch(new RegExp(`^library/${BIZ}/2026-10/[a-f0-9]{24}\\.jpg$`));
    expect(s.contentType).toBe("image/jpeg");
    const u = new URL(s.url);
    expect(u.host).toBe("acc.r2.cloudflarestorage.com");
    expect(u.pathname).toBe(`/arevalo-media/${s.key}`);
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    expect(signFor(BIZ, { frame: true, type: "image/jpeg", size: 90_000 }).key).toMatch(/\.jpg$/);
    expect(() => signFor(BIZ, { frame: true, type: "image/png", size: 10 })).toThrow(UploadError);
    expect(() => signFor(BIZ, { name: "a.exe", type: "application/x-msdownload", size: 10 })).toThrow(/no se puede subir/);
    expect(() => signFor(BIZ, { name: "v.mp4", type: "video/mp4", size: VIDEO_MAX_BYTES + 1 })).toThrow(/500 MB/);
  });

  function r2Fetch(sizes: Record<string, number>) {
    const calls: { method: string; url: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({ method, url });
        const key = Object.keys(sizes).find((k) => url.endsWith(k));
        if (method === "HEAD") return key ? new Response(null, { status: 200, headers: { "content-length": String(sizes[key]) } }) : new Response(null, { status: 404 });
        if (method === "DELETE") return new Response(null, { status: 204 });
        return new Response("", { status: 200 });
      }),
    );
    return calls;
  }

  it("video: revisa que llegó, guarda la nota, su dirección y la imagen para la IA", async () => {
    const key = `library/${BIZ}/2026-10/${"a".repeat(24)}.mp4`;
    const thumbKey = `library/${BIZ}/2026-10/${"b".repeat(24)}.jpg`;
    r2Fetch({ [key]: 52_000_000, [thumbKey]: 80_000 });
    const r = await finishUpload(BIZ, { key, thumbKey, name: "VID_1.mp4", note: " Cortina  Ferretería López ", durationSec: 31.5, width: 1920, height: 1080, lastModified: Date.parse("2026-10-07T15:00:00Z") });
    expect(r).toMatchObject({ kind: "video", created: true });
    expect(upserts[0]).toMatchObject({
      businessId: BIZ,
      source: "upload",
      externalId: key,
      kind: "video",
      mimeType: "video/mp4",
      name: "VID_1.mp4",
      folderPath: "Cortina Ferretería López",
      url: `https://pub-x.r2.dev/${key}`,
      thumbUrl: `https://pub-x.r2.dev/${thumbKey}`,
      sizeBytes: 52_000_000,
      durationSec: 31.5,
      status: "new",
    });
    // La segunda vez (reintento) no se repite.
    expect(await finishUpload(BIZ, { key })).toMatchObject({ created: false });
    expect(upserts).toHaveLength(1);
  });

  it("foto: sin copia todavía (se hace al revisarla); lo que no llegó o pesa de más no se guarda", async () => {
    const key = `library/${BIZ}/2026-10/${"c".repeat(24)}.jpg`;
    const big = `library/${BIZ}/2026-10/${"d".repeat(24)}.png`;
    const calls = r2Fetch({ [key]: 3_000_000, [big]: IMAGE_MAX_BYTES + 5 });
    await finishUpload(BIZ, { key, name: "IMG.jpg" });
    expect(upserts[0]).toMatchObject({ kind: "photo", url: "", thumbUrl: "", folderPath: "" });
    await expect(finishUpload(BIZ, { key: big })).rejects.toMatchObject({ status: 413 });
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith(big))).toBe(true);
    await expect(finishUpload(BIZ, { key: `library/${BIZ}/2026-10/${"e".repeat(24)}.jpg` })).rejects.toMatchObject({ status: 409 });
    // Llave de otro negocio o inventada.
    await expect(finishUpload(BIZ, { key: `library/otro/2026-10/${"c".repeat(24)}.jpg` })).rejects.toThrow(UploadError);
    await expect(finishUpload(BIZ, { key: "../../etc/passwd" })).rejects.toThrow(UploadError);
  });
});

describe("la IA mira lo subido", () => {
  it("turnos: libre si nadie lo mira o si quien lo tomó se cortó", () => {
    const now = 1_000_000_000_000;
    expect(claimable("", now)).toBe(true);
    expect(claimable("La foto pesa más de 40 MB", now)).toBe(true);
    expect(claimable(`busy:${now - 1000}`, now)).toBe(false);
    expect(claimable(`busy:${now - CLAIM_STALE_MS - 1}`, now)).toBe(true);
  });

  it("el publicador automático elige el negocio que más espera (sin pisar lo recién subido)", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const ago = (min: number) => new Date(now.getTime() - min * 60_000);
    expect(
      pickUploadBusiness(
        [
          { businessId: "fresh", error: "", createdAt: ago(1) },
          { businessId: "busy", error: `busy:${now.getTime() - 60_000}`, createdAt: ago(60) },
          { businessId: "b", error: "", createdAt: ago(10) },
          { businessId: "a", error: "", createdAt: ago(30) },
        ],
        now,
      ),
    ).toBe("a");
    expect(pickUploadBusiness([{ businessId: "fresh", error: "", createdAt: ago(1) }], now)).toBeNull();
    expect(pickUploadBusiness([], now)).toBeNull();
    // La tanda: lo más viejo primero.
    expect(
      pickBatch(
        [
          { id: "2", status: "new", modifiedAt: ago(5), createdAt: ago(1) },
          { id: "1", status: "new", modifiedAt: ago(50), createdAt: ago(1) },
        ],
        1,
      ).map((x) => x.id),
    ).toEqual(["1"]);
  });

  it("foto subida: se baja de R2, se copia girada a R2 y la IA la describe; video: usa su imagen", async () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    const jpg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#888" } }).jpeg().toBuffer();
    const base = { businessId: BIZ, source: "upload", status: "new", error: "", folderPath: "Cortina López", width: 0, height: 0, durationSec: 0, createdAt: new Date(), modifiedAt: new Date() };
    items.set("p1", { ...base, id: "p1", kind: "photo", name: "IMG.jpg", mimeType: "image/jpeg", externalId: `library/${BIZ}/2026-10/${"1".repeat(24)}.jpg`, url: "", thumbUrl: "" });
    items.set("v1", {
      ...base,
      id: "v1",
      kind: "video",
      name: "VID.mp4",
      mimeType: "video/mp4",
      durationSec: 12,
      externalId: `library/${BIZ}/2026-10/${"2".repeat(24)}.mp4`,
      url: `https://pub-x.r2.dev/library/${BIZ}/2026-10/${"2".repeat(24)}.mp4`,
      thumbUrl: `https://pub-x.r2.dev/library/${BIZ}/2026-10/${"3".repeat(24)}.jpg`,
    });
    items.set("v2", { ...base, id: "v2", kind: "video", name: "sin-imagen.mov", mimeType: "video/quicktime", externalId: `library/${BIZ}/2026-10/${"4".repeat(24)}.mov`, url: "https://pub-x.r2.dev/v.mov", thumbUrl: "" });
    items.set("d1", { ...base, id: "d1", source: "drive", kind: "photo", name: "drive.jpg", externalId: "drive-id", url: "", thumbUrl: "" });
    const puts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          puts.push(url);
          return new Response("", { status: 200 });
        }
        return new Response(new Uint8Array(jpg), { status: 200, headers: { "content-length": String(jpg.length) } });
      }),
    );
    askGemini.mockImplementation(async () => ({
      items: [
        { n: 1, es: "Cortina metálica gris.", en: "Gray metal door.", scene: "done", topics: ["cortinas"], tags: ["cortina"], quality: 4, usable: true, reasonEs: "", reasonEn: "", privacy: [] },
        { n: 2, es: "Técnico instalando.", en: "Technician installing.", scene: "progress", topics: ["instalación"], tags: ["técnico"], quality: 3, usable: true, reasonEs: "", reasonEn: "", privacy: ["faces"] },
      ],
    }));
    const r = await analyzeUploads(BIZ, { limit: 10 });
    expect(r).toMatchObject({ analyzed: 2, errors: 1, pending: 0, stopped: "" });
    // Una sola pregunta, con la nota del técnico como contexto.
    expect(askGemini).toHaveBeenCalledTimes(1);
    const parts = askGemini.mock.calls[0][4] as { text?: string }[];
    expect(parts[0].text).toContain(`technician's note about the job: "Cortina López"`);
    // Copia grande + miniatura en R2.
    expect(puts).toHaveLength(2);
    expect(puts.every((u) => u.startsWith(`https://acc.r2.cloudflarestorage.com/arevalo-media/library/${BIZ}/`))).toBe(true);
    const p1 = items.get("p1")!;
    expect(p1).toMatchObject({ status: "ready", quality: 4, error: "", width: 1200, height: 900 });
    expect(String(p1.url)).toMatch(/^https:\/\/pub-x\.r2\.dev\/library\//);
    expect(items.get("v1")).toMatchObject({ status: "ready", privacy: ["faces"], url: expect.stringContaining(".mp4") });
    expect(items.get("v2")).toMatchObject({ status: "error", error: expect.stringContaining("no pudo sacar una imagen") });
    // Lo de Drive no se toca aquí.
    expect(items.get("d1")).toMatchObject({ status: "new" });
  });

  it("sin clave de Gemini no toma nada", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    items.set("p1", { id: "p1", businessId: BIZ, source: "upload", status: "new", error: "", kind: "photo", externalId: "k", createdAt: new Date(), modifiedAt: null });
    const r = await analyzeUploads(BIZ);
    expect(r).toMatchObject({ analyzed: 0, pending: 1, stopped: "noai" });
    expect(items.get("p1")!.error).toBe("");
  });
});
