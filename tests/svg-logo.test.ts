import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { bestMark, LOGO_INFO, readBrandAssets, setLogoSlot, setMainLogoType } from "@/lib/brand-assets";
import { cleanSvg, svgToPng } from "@/lib/svg-logo";

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 400 100" width="400" height="100">
<defs><linearGradient id="g"><stop offset="0" stop-color="#1569bb"/><stop offset="1" stop-color="#3dbdb5"/></linearGradient></defs>
<rect x="10" y="10" width="380" height="80" rx="12" fill="url(#g)"/><use xlink:href="#g"/></svg>`;

describe("logo en SVG", () => {
  it("deja el dibujo y quita lo que no es dibujo", () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="0 0 10 10">
<script>alert(2)</script><script src="https://x.com/a.js"/>
<foreignObject><div>hola</div></foreignObject>
<image href="https://otro.com/rastreo.png" width="10" height="10"/>
<image xlink:href="file:///etc/passwd" width="10" height="10"/>
<image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/>
<style>@import url("https://x.com/a.css"); rect { fill: url(https://x.com/f.svg#a) }</style>
<rect width="10" height="10" fill="url(#ok)" onclick="x()"/></svg>`;
    const s = cleanSvg(dirty)!;
    expect(s).not.toMatch(/onload|onclick|<script|foreignObject|otro\.com|file:|@import|x\.com/);
    // Lo que es parte del dibujo se queda: degradados (#id) e imágenes incrustadas.
    expect(s).toContain('fill="url(#ok)"');
    expect(s).toContain("data:image/png;base64,");
    expect(cleanSvg(LOGO)).toContain('xlink:href="#g"');
  });

  it("acepta los SVG de Illustrator, que traen un DOCTYPE simple", async () => {
    const ai = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 1575 618" style="enable-background:new 0 0 1575 618;" xml:space="preserve">
<style type="text/css">.st0{fill:#126BBC;}.st1{fill:#3DBAB3;}</style>
<rect class="st0" width="700" height="400"/><rect class="st1" x="800" y="200" width="775" height="418"/></svg>`;
    const s = cleanSvg(ai)!;
    expect(s).not.toContain("<!DOCTYPE");
    expect(s).toContain(".st0{fill:#126BBC;}");
    const m = await sharp(await svgToPng(ai)).metadata();
    expect([m.width, m.height]).toEqual([2000, Math.round((2000 * 618) / 1575)]);
  });

  it("rechaza lo que no es un SVG o puede leer archivos", () => {
    expect(cleanSvg("<html><body>hola</body></html>")).toBeNull();
    expect(cleanSvg(`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>`)).toBeNull();
    expect(cleanSvg(`<!DOCTYPE svg [<!ATTLIST svg x CDATA "y">]><svg></svg>`)).toBeNull();
    expect(cleanSvg(`<svg>${"a".repeat(1024 * 1024)}</svg>`)).toBeNull();
  });

  it("lo convierte en un PNG grande, con su forma y fondo transparente", async () => {
    const png = await svgToPng(LOGO);
    const m = await sharp(png).metadata();
    expect(m.format).toBe("png");
    expect(m.width).toBe(2000);
    expect(m.height).toBe(500);
    expect(m.hasAlpha).toBe(true);
    await expect(svgToPng("<p>no</p>")).rejects.toThrow();
  });
});

describe("logos por tipo", () => {
  it("lee los tipos guardados y descarta direcciones que no son públicas", () => {
    const a = readBrandAssets({
      items: [],
      logos: {
        mainType: "isologo",
        slots: {
          isotipo: { color: "https://x.supabase.co/a.png", white: "file:///etc/passwd" },
          logotipo: { color: "javascript:alert(1)" },
          imagotipo: { white: "/media/aaaaaaaaaaaaaaaaaaaaaaaa.png" },
          otro: { color: "https://x.supabase.co/b.png" },
        },
      },
    });
    expect(a.logos).toEqual({ mainType: "isologo", mainTypeBy: "owner", slots: { isotipo: { color: "https://x.supabase.co/a.png" }, imagotipo: { white: "/media/aaaaaaaaaaaaaaaaaaaaaaaa.png" } } });
    expect(readBrandAssets({ items: [], logos: { mainType: "nada", slots: {} } }).logos).toBeUndefined();
  });

  it("guarda, quita y elige el tipo principal", () => {
    let a = readBrandAssets({ items: [] });
    a = setLogoSlot(a, "isotipo", "color", "https://x.supabase.co/a.png");
    a = setLogoSlot(a, "isotipo", "white", "https://x.supabase.co/b.png");
    a = setMainLogoType(a, "imagotipo");
    expect(a.logos).toEqual({ mainType: "imagotipo", mainTypeBy: "owner", slots: { isotipo: { color: "https://x.supabase.co/a.png", white: "https://x.supabase.co/b.png" } } });
    a = setLogoSlot(a, "isotipo", "color", "");
    a = setLogoSlot(a, "isotipo", "white", "");
    expect(a.logos).toEqual({ mainType: "imagotipo", mainTypeBy: "owner", slots: {} });
    expect(setMainLogoType(a, null).logos).toEqual({ slots: {} });
  });

  it("recuerda si el tipo lo dijo la IA o el dueño", () => {
    let a = setMainLogoType(readBrandAssets({ items: [] }), "isologo", "ai");
    expect(a.logos).toEqual({ mainType: "isologo", mainTypeBy: "ai", slots: {} });
    // Subir otra versión no borra quién lo dijo; se lee igual de la base de datos.
    a = setLogoSlot(a, "isotipo", "color", "https://x.supabase.co/a.png");
    expect(a.logos?.mainTypeBy).toBe("ai");
    expect(readBrandAssets(JSON.parse(JSON.stringify(a))).logos?.mainTypeBy).toBe("ai");
    expect(setMainLogoType(a, "imagotipo").logos?.mainTypeBy).toBe("owner");
    expect(readBrandAssets({ items: [], logos: { mainType: "isologo", mainTypeBy: "otro", slots: {} } }).logos?.mainTypeBy).toBe("owner");
  });

  it("cada tipo se explica en palabras simples", () => {
    for (const x of Object.values(LOGO_INFO)) expect(x.plain.es).toMatch(/nombre|dibujo/);
  });

  it("el isotipo que subió el dueño va primero en la foto de perfil y los íconos", () => {
    const book = { id: "b1", kind: "isotype", url: "https://x.supabase.co/libro.png", w: 1, h: 1, source: "book", status: "accepted", label: { es: "x", en: "x" }, createdAt: "" };
    const a = readBrandAssets({ items: [book] });
    expect(bestMark(a, "https://x.supabase.co/logo.png")).toBe("https://x.supabase.co/libro.png");
    expect(bestMark(setLogoSlot(a, "isotipo", "color", "https://x.supabase.co/mio.png"), "https://x.supabase.co/logo.png")).toBe("https://x.supabase.co/mio.png");
    expect(bestMark(readBrandAssets({ items: [] }), "")).toBe("");
  });
});
