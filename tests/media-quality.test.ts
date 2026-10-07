import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATES, contrast, customBase, inkOn, StoredTemplate, TemplateSpec, textBox } from "@/lib/design-shapes";
import { isGeminiUrl } from "@/lib/fal";
import { adaptPlan, CHANNEL_FORMATS, formatFor } from "@/lib/formats";
import { colorName, photoPrompt } from "@/lib/imagegen";
import { businessPlace, photoMetaFor } from "@/lib/media-formats";
import { readProvenance, writePhotoMeta } from "@/lib/photo-meta";

const biz = { name: "Ricardo Public Adjusters", website: "https://ricardopa.com", hashtags: "#Miami #ReclamosDeSeguro", study: null, studyInput: null, seoLocations: null, seoLocationName: "" };

describe("plantillas de fábrica", () => {
  it("hay 6, todas válidas y distintas", () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(6);
    for (const t of BUILTIN_TEMPLATES) expect(TemplateSpec.safeParse(t).success).toBe(true);
    expect(new Set(BUILTIN_TEMPLATES.map((t) => t.name)).size).toBe(6);
  });
  it("el texto sobre un color siempre se lee", () => {
    expect(inkOn("#005DB4")).toBe("#ffffff");
    expect(inkOn("#ffe14d")).not.toBe("#ffffff");
    expect(contrast("#ffffff", "#000000")).toBeGreaterThan(20);
  });
});

describe("plantillas propias", () => {
  const custom = customBase("Marco", { imageUrl: "https://x.supabase.co/a.png", w: 1080, h: 1080, mode: "marco", photo: "completa", text: "arriba", ink: "claro" });
  it("se guardan con los campos normales y la parte propia", () => {
    const parsed = StoredTemplate.parse(custom);
    expect(parsed.custom?.mode).toBe("marco");
    // El resto de la app (que lee TemplateSpec) la sigue entendiendo.
    expect(TemplateSpec.safeParse(custom).success).toBe(true);
  });
  it("el titular va del lado contrario a la foto", () => {
    expect(textBox({ photo: "izquierda", text: "centro" })!.x).toBeGreaterThan(0.5);
    expect(textBox({ photo: "arriba", text: "ninguno" })).toBeNull();
  });
});

describe("tamaños por red", () => {
  it("Instagram y Facebook usan 4:5, Google 4:3, el sitio 16:9 y el email 2:1", () => {
    expect(formatFor("instagram")?.shape).toBe("portrait");
    expect(formatFor("facebook")?.shape).toBe("portrait");
    expect(formatFor("google")?.shape).toBe("google");
    expect(formatFor("seo")?.shape).toBe("wide");
    expect(formatFor("email")?.shape).toBe("email");
    expect(formatFor("sms")).toBeNull();
    expect(Object.keys(CHANNEL_FORMATS).length).toBeGreaterThanOrEqual(5);
  });
  it("las fotos con letras nunca se recortan; las fotos solas sí, si no se pierde mucho", () => {
    const ig = formatFor("instagram")!;
    expect(adaptPlan(1, ig, { hasText: true })).toBe("keep");
    expect(adaptPlan(9 / 16, ig, { hasText: true })).toBe("fit");
    expect(adaptPlan(1, ig, { hasText: false })).toBe("crop");
    expect(adaptPlan(0.8, ig, { hasText: false })).toBe("keep");
    expect(adaptPlan(1, formatFor("email")!, { hasText: false })).toBe("fit");
  });
});

describe("datos de la foto", () => {
  it("escribe autor, lugar y palabras clave en un JPEG sin cambiar la imagen", async () => {
    const jpg = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#3366aa" } }).jpeg().toBuffer();
    const out = writePhotoMeta(jpg, { creator: "Ricardo Public Adjusters", title: "Techo", keywords: ["roof leak", "Miami"], city: "Miami", state: "Florida", country: "United States", gps: { lat: 25.76, lng: -80.19 } });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(64);
    expect(meta.exif).toBeTruthy();
    expect(meta.iptc).toBeTruthy();
    const xmp = meta.xmp!.toString();
    expect(xmp).toContain("Ricardo Public Adjusters");
    expect(xmp).toContain("roof leak");
    expect(xmp).toContain('photoshop:City="Miami"');
  });
  it("no toca un archivo con credenciales C2PA y conserva la marca de IA", async () => {
    const jpg = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#000" } }).jpeg().toBuffer();
    // Segmento APP11 (JUMBF) como el que ponen los proveedores con C2PA.
    const app11 = Buffer.concat([Buffer.from([0xff, 0xeb, 0x00, 0x0e]), Buffer.from("JP\0\0jumbc2pa", "latin1")]);
    const withC2pa = Buffer.concat([jpg.subarray(0, 2), app11, jpg.subarray(2)]);
    expect(readProvenance(withC2pa).c2pa).toBe(true);
    expect(writePhotoMeta(withC2pa, { creator: "X" }).equals(withC2pa)).toBe(true);
    const ai = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
    const marked = writePhotoMeta(jpg, { creator: "X" }, { digitalSourceType: ai });
    const again = writePhotoMeta(marked, { creator: "Otro negocio" });
    expect(readProvenance(again).digitalSourceType).toBe(ai);
  });
  it("saca la ciudad de la zona de SEO o del lugar en Google Maps", () => {
    expect(businessPlace({ ...biz, seoMapPlace: null, seoLocationName: "Miami,Florida,United States" })).toMatchObject({ city: "Miami", state: "Florida", country: "United States", countryCode: "US" });
    const place = businessPlace({ ...biz, seoLocationName: "", seoMapPlace: { title: "Ricardo PA", lat: 25.7, lng: -80.2, address: "123 SW 8th St, Miami, FL 33130, United States" } });
    expect(place).toMatchObject({ city: "Miami", state: "Florida", gps: { lat: 25.7, lng: -80.2 } });
  });
  it("las palabras clave salen de los hashtags del post y de la marca", () => {
    const m = photoMetaFor({ ...biz, seoMapPlace: null, seoLocationName: "Miami,Florida,United States" }, { text: "¿Goteras? Te ayudamos #RoofLeak", title: "Filtraciones" });
    expect(m.creator).toBe("Ricardo Public Adjusters");
    expect(m.keywords).toEqual(expect.arrayContaining(["RoofLeak", "Miami", "ReclamosDeSeguro"]));
    expect(m.title).toBe("Filtraciones");
  });
});

describe("fotos y videos con IA", () => {
  it("el texto para la IA pide foto real, del lugar, sin letras", () => {
    const p = photoPrompt("A roof with missing shingles", { place: "Miami, Florida", color: "#005DB4" });
    expect(p).toContain("Miami, Florida");
    expect(p).toContain("blue");
    expect(p).toMatch(/no text/i);
    expect(colorName("#bb1111")).toContain("red");
  });
  it("solo manda la clave de Google a la API de Gemini", () => {
    expect(isGeminiUrl("https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-lite-generate-preview/operations/abc123", "operation")).toBe(true);
    expect(isGeminiUrl("https://generativelanguage.googleapis.com/v1beta/files/xyz:download", "file")).toBe(true);
    expect(isGeminiUrl("https://evil.com/v1beta/files/xyz", "file")).toBe(false);
    expect(isGeminiUrl("http://generativelanguage.googleapis.com/v1beta/models/x/operations/a", "operation")).toBe(false);
    expect(isGeminiUrl("https://generativelanguage.googleapis.com/v1beta/models/x:generateContent", "operation")).toBe(false);
  });
});
