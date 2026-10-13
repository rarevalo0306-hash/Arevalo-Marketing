import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { addArticle, photoForSite, sitePhotoPath, slugify, type GeneratedArticle, type SiteArticle } from "@/lib/publishers/website";

// DNS de mentira (sin red): "inside.example.com" apunta a la red interna, todo lo demás a internet.
vi.mock("dns/promises", () => ({
  lookup: vi.fn(async (host: string) => [{ address: host === "inside.example.com" ? "10.0.0.5" : "93.184.215.14", family: 4 }]),
}));
// Fotos guardadas en el disco (sin Supabase) en una carpeta temporal solo para esta prueba.
const uploadDir = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR || "/tmp"}/website-test-uploads-${process.pid}`;
  vi.stubEnv("UPLOAD_DIR", dir);
  return dir;
});

const copy = (slug: string) => ({
  slug,
  seoTitle: "T",
  title: "Título",
  description: "D",
  category: "Novedades",
  sections: [{ title: "Uno", text: "Texto" }, { title: " ", text: "vacía" }],
});
const gen = (es: string, en: string): GeneratedArticle => ({ photo: "storm", es: copy(es), en: copy(en) });

describe("artículos para el sitio", () => {
  it("convierte títulos en slugs limpios", () => {
    expect(slugify("¿Qué hacer después de un huracán?")).toBe("que-hacer-despues-de-un-huracan");
    expect(slugify("!!!")).toBe("articulo");
  });
  it("agrega el artículo primero, con id y sin secciones vacías", () => {
    const { list, article } = addArticle([], gen("hola", "hello"), "post-1");
    expect(list[0]).toBe(article);
    expect(article.id).toBe("post-1");
    expect(article.es.sections).toHaveLength(1);
  });
  it("no repite slugs que ya existen", () => {
    const first = addArticle([], gen("huracan", "hurricane"), "a").list;
    const { article } = addArticle(first as SiteArticle[], gen("Huracán", "hurricane"), "b");
    expect(article.es.slug).toBe("huracan-2");
    expect(article.en.slug).toBe("hurricane-2");
  });
});

describe("fecha del artículo", () => {
  it("guarda la fecha de publicación que muestra el sitio", () => {
    const { article } = addArticle([], gen("lluvia", "rain"), "p", "2026-10-05");
    expect(article.published).toBe("2026-10-05");
  });
});

describe("foto del artículo", () => {
  it("se guarda en la carpeta de fotos de marketing del sitio", () => {
    expect(sitePhotoPath("post-abc")).toBe("public/images/marketing/post-abc.webp");
  });
});

describe("descargar la foto del post para el sitio", () => {
  const jpeg = () => sharp({ create: { width: 8, height: 8, channels: 3, background: "#c33" } }).jpeg().toBuffer();
  const fetchMock = vi.fn();
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(uploadDir, { recursive: true, force: true });
  });

  it("descarga una dirección pública y la convierte a WEBP", async () => {
    vi.stubGlobal("fetch", fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(await jpeg()), { headers: { "Content-Type": "image/jpeg" } })));
    const webp = await photoForSite("https://x.supabase.co/storage/v1/object/public/media/b/a.jpg");
    expect((await sharp(webp).metadata()).format).toBe("webp");
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
  });

  it("no descarga una dirección que apunta a la red interna, ni siguiendo una redirección", async () => {
    vi.stubGlobal("fetch", fetchMock);
    for (const url of ["https://inside.example.com/a.jpg", "https://169.254.169.254/latest/meta-data", "http://x.supabase.co/a.jpg"]) {
      await expect(photoForSite(url), url).rejects.toThrow("dirección pública");
    }
    expect(fetchMock).not.toHaveBeenCalled();
    for (const location of ["https://inside.example.com/a.jpg", "http://169.254.169.254/latest/meta-data", "https://10.0.0.1/a.jpg"]) {
      fetchMock.mockReset().mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: location } }));
      await expect(photoForSite("https://cdn.example.com/a.jpg"), location).rejects.toThrow("dirección pública");
      expect(fetchMock, location).toHaveBeenCalledTimes(1);
    }
  });

  it("en tu computadora lee del disco las fotos propias (http://localhost/media/…) sin descargarlas", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", "http://localhost:3000/");
    vi.stubGlobal("fetch", fetchMock);
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, "a1b2c3d4e5f6a1b2c3d4e5f6.jpg"), await jpeg());
    const webp = await photoForSite("http://localhost:3000/media/a1b2c3d4e5f6a1b2c3d4e5f6.jpg");
    expect((await sharp(webp).metadata()).format).toBe("webp");
    await expect(photoForSite("http://localhost:3000/media/b1b2c3d4e5f6a1b2c3d4e5f6.jpg")).rejects.toThrow("(404)");
    // Un nombre que no es de /media/… no se lee del disco: es una dirección http interna.
    await expect(photoForSite("http://localhost:3000/media/..%2Fsecret.jpg")).rejects.toThrow("dirección pública");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
