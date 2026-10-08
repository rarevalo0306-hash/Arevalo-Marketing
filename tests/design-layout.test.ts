import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  accentOn,
  balance,
  fitText,
  gradientPair,
  grayOf,
  gridMargin,
  guessLang,
  inkForAll,
  pickInk,
  safeArea,
  scrimAlpha,
  shortHost,
  sloganFrom,
  tokens,
  wrap,
  type Measure,
} from "@/lib/design-layout";
import { contrast, DESIGN_SHAPES, luminance, mix } from "@/lib/design-shapes";
import { measurer, parseFont } from "@/lib/font-metrics";

// Letra de ancho fijo para las pruebas: cada carácter mide 0.6 del tamaño.
const mono: Measure = (t, size) => [...t].length * size * 0.6;

describe("zonas seguras y márgenes", () => {
  it("las historias dejan libre lo que tapan los botones (arriba 14%, abajo 20%)", () => {
    const { w, h } = DESIGN_SHAPES.story;
    const s = safeArea(w, h);
    expect(s.top).toBeGreaterThanOrEqual(Math.round(h * 0.14));
    expect(s.bottom).toBeGreaterThanOrEqual(Math.round(h * 0.2));
    expect(s.left).toBe(s.right);
  });
  it("las demás formas usan el mismo margen en los cuatro lados", () => {
    for (const shape of ["square", "portrait", "link", "google", "wide", "email"] as const) {
      const { w, h } = DESIGN_SHAPES[shape];
      const s = safeArea(w, h);
      expect(new Set([s.top, s.right, s.bottom, s.left]).size).toBe(1);
      expect(s.top).toBe(gridMargin(w, h));
    }
    expect(gridMargin(1080, 1080)).toBe(80);
  });
});

describe("partir el titular", () => {
  it("las palabras cortas no quedan solas al final de una línea", () => {
    expect(tokens("¿Tu cortina de acero hace ruido? Te la reparamos")).toEqual(["¿Tu cortina", "de acero", "hace", "ruido?", "Te la reparamos"]);
    expect(tokens("Call us for a free review")).toEqual(["Call", "us", "for a free", "review"]);
  });
  it("respeta el ancho", () => {
    const lines = wrap(tokens("Instalamos puertas enrollables en todo Managua"), 300, 30, mono);
    for (const l of lines) expect(mono(l, 30)).toBeLessThanOrEqual(300);
  });
  it("reparte las líneas parejas (sin una palabra sola en la última línea)", () => {
    const text = "Seguridad que dura para tu negocio hoy";
    const greedy = wrap(tokens(text), 560, 40, mono);
    const even = balance(text, 560, 40, mono);
    expect(even.length).toBe(greedy.length);
    const spread = (ls: string[]) => Math.max(...ls.map((l) => l.length)) - Math.min(...ls.map((l) => l.length));
    expect(spread(even)).toBeLessThanOrEqual(spread(greedy));
    expect(even[even.length - 1].split(" ").length).toBeGreaterThan(1);
  });
});

describe("tamaño de la letra", () => {
  it("usa la letra más grande que cabe y nunca se sale de la caja", () => {
    const f = fitText({ text: "Seguridad que dura", maxW: 900, maxH: 200, max: 120, min: 40, maxLines: 4, lineHeight: 1.1, measure: mono });
    expect(f.truncated).toBe(false);
    expect(f.width).toBeLessThanOrEqual(900);
    expect(f.height).toBeLessThanOrEqual(200);
    // Si sobra espacio, usa el tamaño máximo; si no, uno menor que el máximo.
    expect(fitText({ text: "Hola", maxW: 900, maxH: 400, max: 120, min: 40, maxLines: 4, lineHeight: 1.1, measure: mono }).size).toBe(120);
    expect(f.size).toBeLessThan(120);
    expect(f.size).toBeGreaterThan(40);
  });
  it("un titular largo usa letra más chica que uno corto", () => {
    const a = fitText({ text: "Hola", maxW: 800, maxH: 500, max: 100, min: 30, maxLines: 4, lineHeight: 1.1, measure: mono });
    const b = fitText({ text: "Instalamos puertas enrollables de acero galvanizado con motor eléctrico", maxW: 800, maxH: 500, max: 100, min: 30, maxLines: 4, lineHeight: 1.1, measure: mono });
    expect(b.size).toBeLessThan(a.size);
  });
  it("si no cabe ni con la letra más chica, corta en una palabra entera con «…»", () => {
    const f = fitText({ text: "Una frase muy larga que de ninguna manera cabe en una caja tan chiquita", maxW: 300, maxH: 70, max: 40, min: 30, maxLines: 2, lineHeight: 1.1, measure: mono });
    expect(f.truncated).toBe(true);
    expect(f.lines.join(" ").endsWith("…")).toBe(true);
    expect(f.lines.join(" ")).not.toMatch(/\s…$/);
    for (const l of f.lines) expect(mono(l, f.size)).toBeLessThanOrEqual(300);
    expect(f.height).toBeLessThanOrEqual(70);
  });
  it("en columnas angostas permite más líneas antes de cortar", () => {
    const text = "¿Tu cortina de acero hace ruido? Te la reparamos el mismo día";
    const f = fitText({ text, maxW: 400, maxH: 900, max: 60, min: 44, maxLines: 4, hardLines: 7, lineHeight: 1.1, measure: mono });
    expect(f.truncated).toBe(false);
    expect(f.lines.length).toBeGreaterThan(4);
  });
  it("mide con las letras reales (la W es más ancha que la i)", () => {
    const font = parseFont(readFileSync(path.join(process.cwd(), "src/assets/fonts/montserrat-800.woff")));
    const m = measurer(font);
    expect(m("W", 100)).toBeGreaterThan(m("i", 100) * 2);
    expect(m("ñ", 100)).toBeGreaterThan(0);
    expect(m("abc", 100, 10)).toBeCloseTo(m("abc", 100) + 20, 5);
  });
});

describe("colores que se leen", () => {
  it("elige blanco sobre oscuro y casi negro sobre claro", () => {
    expect(pickInk("#0a4ea3")).toBe("#ffffff");
    expect(pickInk("#f4b400")).not.toBe("#ffffff");
    expect(pickInk("#9ad0ec")).not.toBe("#ffffff");
    expect(contrast(pickInk("#bb1111"), "#bb1111")).toBeGreaterThanOrEqual(4.5);
  });
  it("el degradado no mezcla colores que no combinan (amarillo con gris oscuro)", () => {
    const [a, b] = gradientPair("#f4b400", "#263238");
    expect(a).toBe("#f4b400");
    expect(b).not.toBe("#263238");
    expect(contrast(a, b)).toBeLessThan(1.6);
    expect(gradientPair("#0a4ea3", "#126bbc")).toEqual(["#0a4ea3", "#126bbc"]);
  });
  it("la letra sirve sobre los dos extremos del degradado", () => {
    const [a, b] = gradientPair("#bb1111");
    const ink = inkForAll([a, b]);
    expect(Math.min(contrast(ink, a), contrast(ink, b))).toBeGreaterThanOrEqual(4.5);
  });
  it("los detalles usan el color de acento solo si se distingue del fondo (3:1)", () => {
    expect(accentOn("#ffffff", ["#3dbab3", "#0a4ea3"], "#000000")).toBe("#0a4ea3");
    expect(accentOn("#0a4ea3", ["#3dbab3"], "#ffffff")).toBe("#3dbab3");
    expect(accentOn("#f4b400", ["#f4b400"], "#111111")).toBe("#111111");
  });
  it("oscurece la foto lo justo para que el texto blanco tenga contraste 4.5", () => {
    const deep = mix("#bb1111", "#050a14", 0.86);
    for (const bright of ["#ffffff", "#dddddd", "#9aa1a8", "#555555"]) {
      const a = scrimAlpha(bright, deep, 4.5);
      expect(contrast("#ffffff", mix(bright, deep, a))).toBeGreaterThanOrEqual(4.45);
    }
    // Una foto oscura no necesita degradado; la plantilla puede pedir un mínimo.
    expect(scrimAlpha("#202020", deep, 4.5)).toBe(0);
    expect(scrimAlpha("#202020", deep, 4.5, 0.35)).toBe(0.35);
  });
  it("grayOf devuelve un gris con esa luminancia", () => {
    expect(luminance(grayOf(0.5))).toBeCloseTo(0.5, 1);
    expect(grayOf(1)).toBe("#ffffff");
    expect(grayOf(0)).toBe("#000000");
  });
});

describe("textos de la marca", () => {
  it("lee el eslogan de brandIdentity aunque falte o tenga otra forma", () => {
    expect(sloganFrom(null, "es")).toBe("");
    expect(sloganFrom({ slogan: "Seguridad que dura" }, "en")).toBe("Seguridad que dura");
    expect(sloganFrom({ slogan: { es: "Te ayudamos", en: "We help you" } }, "en")).toBe("We help you");
    expect(sloganFrom({ slogan: { es: "Te ayudamos" } }, "en")).toBe("Te ayudamos");
    expect(sloganFrom({ slogan: 42 }, "es")).toBe("");
  });
  it("adivina el idioma del titular", () => {
    expect(guessLang("¿Daños por huracán?")).toBe("es");
    expect(guessLang("Call us for a free review of your claim")).toBe("en");
    expect(guessLang("Puertas enrollables de acero")).toBe("es");
  });
  it("muestra la web corta", () => {
    expect(shortHost("https://www.Fameseg.com/contacto?x=1")).toBe("fameseg.com");
  });
});

describe("piezas que no caben", () => {
  it("si dos palabras unidas no caben en la línea, se separan (en vez de cortar el titular)", () => {
    const f = fitText({ text: "¿TU ASEGURADORA NEGÓ TU RECLAMO?", maxW: 400, maxH: 1000, max: 44, min: 44, maxLines: 8, lineHeight: 1.1, measure: (t, s) => [...t].length * s * 0.75 });
    expect(f.truncated).toBe(false);
    expect(f.lines.join(" ")).toBe("¿TU ASEGURADORA NEGÓ TU RECLAMO?");
  });
});
