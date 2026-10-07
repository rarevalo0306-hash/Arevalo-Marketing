import { describe, expect, it } from "vitest";
import { attachment, kitItems, ownAsset, sessionOk } from "@/app/api/brand-kit/access";
import {
  averageInk,
  cleanTagline,
  coverBackground,
  coverLines,
  fallbackTagline,
  fitInCircle,
  fitInside,
  hostOf,
  initials,
  isMultiColor,
  KIT_FORMATS,
  KIT_GROUPS,
  kitFileName,
  logoFor,
  pool,
  signatureHtml,
  signatureText,
  symbolBox,
  toneInk,
  zipEntries,
} from "@/lib/brand-kit-formats";
import { contrast } from "@/lib/design-shapes";

describe("kit de marca: lista de piezas", () => {
  it("cada pieza tiene clave única, grupo conocido, tamaño y textos en los dos idiomas", () => {
    const keys = KIT_FORMATS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    const groups = new Set(KIT_GROUPS.map((g) => g.key));
    for (const f of KIT_FORMATS) {
      expect(groups.has(f.group), f.key).toBe(true);
      expect(f.w, f.key).toBeGreaterThan(0);
      expect(f.h, f.key).toBeGreaterThan(0);
      for (const l of [f.label, f.where, f.file]) {
        expect(l.es.trim(), f.key).not.toBe("");
        expect(l.en.trim(), f.key).not.toBe("");
      }
      expect(f.file.es).toMatch(/^[a-z0-9-]+$/);
      expect(f.file.en).toMatch(/^[a-z0-9-]+$/);
      if (f.safe) {
        expect(f.safe.w).toBeLessThanOrEqual(f.w);
        expect(f.safe.h).toBeLessThanOrEqual(f.h);
      }
      for (const p of f.places) {
        expect(p.name.es && p.name.en, f.key).toBeTruthy();
        expect(p.steps.es.length, `${f.key} ${p.name.es}`).toBeGreaterThanOrEqual(1);
        expect(p.steps.es.length).toBeLessThanOrEqual(3);
        expect(p.steps.en.length).toBe(p.steps.es.length);
      }
    }
  });

  it("tiene las medidas que piden las redes", () => {
    const size = (k: string) => KIT_FORMATS.find((f) => f.key === k);
    expect(size("profile")).toMatchObject({ w: 1080, h: 1080 });
    expect(size("fb-cover")).toMatchObject({ w: 1640, h: 624 });
    expect(size("x-header")).toMatchObject({ w: 1500, h: 500 });
    expect(size("yt-banner")).toMatchObject({ w: 2560, h: 1440, safe: { w: 1546, h: 423 } });
    expect(size("linkedin-cover")).toMatchObject({ w: 1128, h: 191 });
    expect(size("og")).toMatchObject({ w: 1200, h: 630 });
    expect(size("email-header")).toMatchObject({ w: 1200, h: 400 });
    expect(size("card-front")).toMatchObject({ w: 1125, h: 675 });
    for (const [k, s] of [["favicon-32", 32], ["favicon-180", 180], ["favicon-192", 192], ["favicon-512", 512]] as const) expect(size(k)).toMatchObject({ w: s, h: s });
    // La foto de perfil se usa en todas las redes: cada una con sus pasos.
    expect(size("profile")!.places.map((p) => p.name.en).join(" ")).toMatch(/Facebook.*Instagram.*LinkedIn.*X.*TikTok.*YouTube.*WhatsApp.*Google/);
  });

  it("cada grupo tiene piezas y todas las piezas que se suben dicen cómo", () => {
    for (const g of KIT_GROUPS) expect(KIT_FORMATS.some((f) => f.group === g.key)).toBe(true);
    for (const f of KIT_FORMATS.filter((x) => x.group === "social")) expect(f.places.length, f.key).toBeGreaterThan(0);
  });
});

describe("kit de marca: colores y logo", () => {
  it("elige el logo a color sobre fondos claros y el blanco sobre el color de la marca", () => {
    expect(logoFor("#ffffff", "#126BBC")).toBe("color");
    expect(logoFor("#126BBC", "#126BBC")).toBe("light");
    expect(logoFor("#0f172a", "#111827")).toBe("light");
    expect(logoFor("#F4D35E", "#F6D860")).toBe("dark");
    // Sin color medio conocido (el logo tiene un fondo que no se pudo quitar): según el fondo.
    expect(logoFor("#005DB4", null)).toBe("light");
  });

  it("oscurece un color claro para que el texto blanco de las portadas se lea", () => {
    expect(contrast(coverBackground("#E9B949"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(coverBackground("#005DB4")).toBe("#005DB4");
  });

  it("color medio y varios colores", () => {
    const px = (rgb: number[][]) => Uint8Array.from(rgb.flatMap((c) => [...c, 255]));
    expect(averageInk(px([[0, 0, 255], [0, 0, 255]]), 1)).toBe("#0000ff");
    expect(averageInk(Uint8Array.from([0, 0, 0, 0]), 1)).toBeNull();
    expect(isMultiColor(px(Array(10).fill([0, 93, 180])))).toBe(false);
    expect(isMultiColor(px([...Array(6).fill([0, 93, 180]), ...Array(4).fill([61, 186, 179])]))).toBe(true);
  });

  it("logo de un color con tonos: lo oscuro queda lleno y lo blanco desaparece", () => {
    const d = Uint8Array.from([0, 93, 180, 255, 61, 186, 179, 255, 255, 255, 255, 255]);
    toneInk(d, "#ffffff");
    expect(Array.from(d.slice(0, 3))).toEqual([255, 255, 255]);
    expect(d[3]).toBe(255);
    expect(d[7]).toBeGreaterThan(100);
    expect(d[7]).toBeLessThan(255);
    expect(d[11]).toBe(0);
  });

  it("encuentra el símbolo a la izquierda del nombre, o arriba", () => {
    const W = 100, H = 30;
    const a = new Uint8Array(W * H);
    const fill = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) a[y * W + x] = 255; };
    fill(0, 0, 27, 29); // símbolo
    fill(40, 8, 99, 20); // nombre
    expect(symbolBox(a, W, H)).toEqual({ left: 0, top: 0, width: 28, height: 30 });
    // Un logo que es solo texto (sin huecos grandes) no tiene símbolo.
    expect(symbolBox(new Uint8Array(W * H).fill(255), W, H)).toBeNull();
    // Apilado: símbolo arriba, nombre abajo.
    const S = 60;
    const b = new Uint8Array(S * S);
    for (let y = 0; y < 30; y++) for (let x = 15; x < 45; x++) b[y * S + x] = 255;
    for (let y = 40; y < 52; y++) for (let x = 0; x < 60; x++) b[y * S + x] = 255;
    expect(symbolBox(b, S, S)).toEqual({ left: 15, top: 0, width: 30, height: 30 });
  });

  it("medidas: no estira y cabe en el círculo de la foto de perfil", () => {
    expect(fitInside(2, 1000, 1000)).toEqual({ w: 1000, h: 500 });
    expect(fitInside(0.5, 1000, 1000)).toEqual({ w: 500, h: 1000 });
    for (const aspect of [1, 3, 0.5]) {
      const { w, h } = fitInCircle(aspect, 1080, 1);
      expect(Math.hypot(w, h)).toBeLessThanOrEqual(1081);
      expect(w / h).toBeCloseTo(aspect, 1);
    }
  });

  it("iniciales y dirección corta", () => {
    expect(initials("Ricardo Public Adjusters")).toBe("RP");
    expect(initials("Fameseg")).toBe("F");
    expect(initials("Panadería La Espiga")).toBe("PE");
    expect(hostOf("https://www.fameseg.com/contacto")).toBe("fameseg.com");
  });
});

describe("kit de marca: frase de las portadas", () => {
  it("limpia la frase", () => {
    expect(cleanTagline('  "Te ayudamos con tu reclamo."  ')).toBe("Te ayudamos con tu reclamo");
    expect(cleanTagline(42)).toBe("");
    const long = cleanTagline("palabra ".repeat(30));
    expect(long.length).toBeLessThanOrEqual(70);
    expect(long.endsWith(" ")).toBe(false);
  });

  it("sin IA usa la descripción del negocio si es corta, o una frase general", () => {
    expect(fallbackTagline({ name: "Ricardo Public Adjusters", aiProfile: "Ricardo Public Adjusters Corp. es una firma de ajustadores públicos con licencia en Florida, en Miami. Ayudamos…" }).es).toBe("Ajustadores públicos con licencia en Florida, en Miami");
    expect(fallbackTagline({ name: "Fameseg", aiProfile: "Fameseg es una empresa de puertas enrollables en Managua." }).es).toBe("Puertas enrollables en Managua");
    expect(fallbackTagline({ name: "Fameseg", aiProfile: "" })).toEqual({ es: "Estamos para ayudarte", en: "We're here to help" });
    expect(fallbackTagline({ name: "X", aiProfile: "Vendemos de todo un poco y mucho más." }).es).toBe("Estamos para ayudarte");
  });

  it("líneas según el idioma elegido", () => {
    expect(coverLines({ lang: "es", es: "Hola", en: "Hi" })).toEqual(["Hola"]);
    expect(coverLines({ lang: "en", es: "Hola", en: "Hi" })).toEqual(["Hi"]);
    expect(coverLines({ lang: "both", es: "Hola", en: "Hi" })).toEqual(["Hola", "Hi"]);
    expect(coverLines({ lang: "both", es: "Hola", en: "" })).toEqual(["Hola"]);
    expect(coverLines({ lang: "en", es: "Hola", en: "" })).toEqual(["Hola"]);
    expect(coverLines({ lang: "es", es: "", en: "" })).toEqual([]);
  });
});

describe("kit de marca: descargas", () => {
  const raw = {
    items: [
      { id: "abc123xyz", kind: "kit", url: "/media/a.png", w: 1, h: 1, source: "generated", status: "accepted", label: { es: "x", en: "x" }, format: "fb-cover", group: "social", createdAt: "" },
      { id: "def456uvw", kind: "kit", url: "/media/b.png", w: 1, h: 1, source: "generated", status: "accepted", label: { es: "x", en: "x" }, format: "logo-color", group: "logos", createdAt: "" },
      { id: "ghi789rst", kind: "logo", url: "/media/c.png", w: 1, h: 1, source: "book", status: "proposed", label: { es: "x", en: "x" }, createdAt: "" },
    ],
  };

  it("solo con la sesión correcta", () => {
    expect(sessionOk("tok", "tok", "pass")).toBe(true);
    expect(sessionOk("tok", "tok", undefined)).toBe(false);
    expect(sessionOk("bad", "tok", "pass")).toBe(false);
    expect(sessionOk(undefined, "tok", "pass")).toBe(false);
    expect(sessionOk("", "", "pass")).toBe(false);
  });

  it("solo imágenes de este negocio", () => {
    expect(ownAsset(raw, "abc123xyz")?.url).toBe("/media/a.png");
    expect(ownAsset(raw, "otro123456")).toBeNull();
    expect(ownAsset(raw, "../etc/passwd")).toBeNull();
    expect(ownAsset(null, "abc123xyz")).toBeNull();
    expect(kitItems(raw).map((a) => a.id)).toEqual(["abc123xyz", "def456uvw"]);
  });

  it("ZIP en carpetas por grupo, en orden y sin nombres repetidos", () => {
    const items = [...kitItems(raw), { ...kitItems(raw)[0], id: "dup" }];
    const e = zipEntries(items, "es").map((x) => x.path);
    expect(e).toEqual(["1 Logos/logo-a-color.png", "2 Redes sociales/portada-facebook.png", "2 Redes sociales/portada-facebook-2.png"]);
    expect(zipEntries(items, "en")[0].path).toBe("1 Logos/logo-color.png");
  });

  it("nombre del archivo sin acentos y con el negocio", () => {
    expect(kitFileName("fb-cover", "Panadería La Espiga", "es")).toBe("panaderia-la-espiga-portada-facebook.png");
    expect(kitFileName("profile", "Ricardo Public Adjusters", "en")).toBe("ricardo-public-adjusters-profile-picture.png");
    expect(attachment("año.png")).toBe(`attachment; filename="ano.png"; filename*=UTF-8''a%C3%B1o.png`);
  });

  it("firma de email con el logo, el teléfono y el sitio, y sin HTML inyectado", () => {
    const html = signatureHtml({ name: "Ricardo <PA>", phone: "305-394-8090", website: "https://ricardopa.com", color: "#005DB4", logoUrl: "https://x.supabase.co/a.png", logoW: 300, logoH: 100 });
    expect(html).toContain('href="tel:3053948090"');
    expect(html).toContain("ricardopa.com");
    expect(html).toContain('src="https://x.supabase.co/a.png"');
    expect(html).toContain("Ricardo &lt;PA&gt;");
    expect(html).not.toContain("<PA>");
    expect(signatureText({ name: "Fameseg", person: "Ana", role: "Gerente", phone: "8888", website: "fameseg.com", color: "#126BBC" })).toBe("Ana\nGerente · Fameseg\nTel. 8888\nfameseg.com");
  });

  it("hace el trabajo de a pocos", async () => {
    let now = 0;
    let max = 0;
    const out = await pool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      now++;
      max = Math.max(max, now);
      await new Promise((r) => setTimeout(r, 5));
      now--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12]);
    expect(max).toBe(2);
  });
});
