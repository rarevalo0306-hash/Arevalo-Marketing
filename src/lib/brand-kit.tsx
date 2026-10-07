// Kit de marca: dibuja en el servidor todas las imágenes que necesita un negocio (logos limpios, foto de perfil,
// portadas de cada red, imagen para compartir enlaces, íconos del sitio, encabezado de email y tarjeta de
// presentación) con su logo, sus colores y su letra. Las medidas y los textos de cada pieza están en
// brand-kit-formats.ts. Se dibuja con next/og (gratis, sin IA) y sale en PNG.
import { readFile } from "fs/promises";
import path from "path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { bestMark, type BrandAssets } from "@/lib/brand-assets";
import { recolor, transparentLogo, trimTransparent } from "@/lib/brand-image";
import {
  averageInk,
  coverBackground,
  coverLines,
  fitInCircle,
  fitInside,
  hostOf,
  initials,
  isMultiColor,
  symbolBox,
  toneInk,
  KIT_FORMATS,
  logoFor,
  pool,
  type CoverText,
  type KitFormat,
} from "@/lib/brand-kit-formats";
import { BODY_FONTS, bodyFontId, contrast, FONTS, fontId, hexOr, mix, rgba } from "@/lib/design-shapes";
import { readMedia } from "@/lib/media";

export { pool };

export type KitBrand = {
  name: string;
  color: string;
  color2?: string;
  color3?: string;
  fontHeading?: string;
  fontBody?: string;
  logoUrl?: string;
  logoLightUrl?: string;
  phone?: string;
  website?: string;
  assets: BrandAssets;
  cover: CoverText;
};

export type KitPiece = { format: KitFormat; data: Buffer; w: number; h: number; transparent: boolean };

// ---------- Letras ----------

type FontFile = { name: string; data: Buffer; weight: 400 | 500 | 600 | 700 | 800; style: "normal" };
const fontCache = new Map<string, Promise<FontFile>>();
/** Lee una letra de src/assets/fonts (los mismos archivos que usa design.tsx). */
function fontFile(file: string, name: string, weight: FontFile["weight"]): Promise<FontFile> {
  const key = `${file}-${weight}`;
  let hit = fontCache.get(key);
  if (!hit) {
    hit = readFile(path.join(process.cwd(), "src/assets/fonts", `${key}.woff`)).then((data) => ({ name, data, weight, style: "normal" as const }));
    hit.catch(() => fontCache.delete(key));
    fontCache.set(key, hit);
  }
  return hit;
}
/** Ancho medio de una letra en negrita, en "em" (para calcular cuántas líneas ocupa la frase). */
// Medido con estas letras (promedio de varias frases, ×1.12 para ir seguros).
const EM: Record<keyof typeof FONTS, number> = { montserrat: 0.66, poppins: 0.65, inter: 0.61, oswald: 0.5, "playfair-display": 0.58 };

async function kitFonts(heading = "", body = "") {
  const hid = fontId(heading);
  const hf = FONTS[hid];
  const head = await Promise.all([fontFile(hid, hf.name, hf.semi), fontFile(hid, hf.name, hf.bold)]);
  const bid = bodyFontId(body);
  const bf = bid ? BODY_FONTS[bid] : null;
  const bodyFiles = bf && bid ? await Promise.all([fontFile(bid, bf.name, bf.regular), fontFile(bid, bf.name, bf.semi)]).catch(() => null) : null;
  return {
    fonts: [...head, ...(bodyFiles ?? [])],
    head: hf.name,
    bold: hf.bold,
    semi: hf.semi,
    body: bodyFiles && bf ? bf.name : hf.name,
    bodyWeight: bodyFiles && bf ? bf.semi : hf.semi,
    em: EM[hid],
  };
}
type Fonts = Awaited<ReturnType<typeof kitFonts>>;

/** Tamaño de letra para que `text` quepa en `boxW` en como mucho `maxLines` líneas. */
export function fitText(text: string, boxW: number, maxLines: number, cap: number, min: number, em: number): number {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = (size: number) => {
    const cw = size * em;
    const space = size * 0.3;
    let n = 1;
    let cur = 0;
    for (const w of words) {
      const ww = w.length * cw;
      if (ww > boxW) return Infinity;
      if (cur && cur + space + ww > boxW) {
        n++;
        cur = ww;
      } else cur += (cur ? space : 0) + ww;
    }
    return n;
  };
  for (let s = Math.round(cap); s > min; s -= 1) if (lines(s) <= maxLines) return s;
  return Math.round(min);
}

// ---------- Imágenes ----------

type Pic = { buf: Buffer; w: number; h: number };
type Uri = { uri: string; w: number; h: number };

async function pic(buf: Buffer): Promise<Pic> {
  const m = await sharp(buf).metadata();
  return { buf, w: m.width ?? 1, h: m.height ?? 1 };
}
/** La imagen como data URI para dibujarla (más chica si sobra: Satori la escala igual). */
async function uri(p: Pic, maxSide: number): Promise<Uri> {
  const { data, info } = await sharp(p.buf).resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  return { uri: `data:image/png;base64,${data.toString("base64")}`, w: info.width, h: info.height };
}
async function rawInk(buf: Buffer): Promise<{ ink: string | null; multi: boolean }> {
  const { data } = await sharp(buf).resize(128, 128, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { ink: averageInk(data, 1), multi: isMultiColor(data) };
}

/** Pinta el logo de un solo color: liso si es de un color, con tonos si es de varios (ver toneInk). */
async function oneColor(buf: Buffer, hex: string, multi: boolean): Promise<Buffer> {
  if (!multi) return recolor(buf, hex);
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  toneInk(data, hex);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/** El símbolo de un logo horizontal o apilado (ver symbolBox), recortado. null si no tiene uno claro. */
async function cutSymbol(buf: Buffer): Promise<Buffer | null> {
  const small = 400;
  const meta = await sharp(buf).metadata();
  const W = meta.width ?? 1;
  const H = meta.height ?? 1;
  const k = Math.min(1, small / Math.max(W, H));
  const { data, info } = await sharp(buf).resize(Math.max(1, Math.round(W * k)), Math.max(1, Math.round(H * k)), { fit: "fill" }).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  const box = symbolBox(data, info.width, info.height);
  if (!box) return null;
  const pad = 2;
  const left = Math.max(0, Math.floor((box.left - pad) / k));
  const top = Math.max(0, Math.floor((box.top - pad) / k));
  const width = Math.min(W - left, Math.ceil((box.width + pad * 2) / k));
  const height = Math.min(H - top, Math.ceil((box.height + pad * 2) / k));
  return trimTransparent(await sharp(buf).extract({ left, top, width, height }).png().toBuffer());
}

const GLOBE = `<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`;
const PHONE = `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>`;
const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const icon = (kind: "phone" | "web", color: string) =>
  svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${kind === "phone" ? PHONE : GLOBE}</svg>`);

async function draw(node: React.ReactElement, w: number, h: number, F: Fonts): Promise<Buffer> {
  const img = new ImageResponse(node, { width: w, height: h, fonts: F.fonts });
  return Buffer.from(await img.arrayBuffer());
}

/** PNG final: los opacos sin canal alfa (pesan menos); todos comprimidos. */
async function finish(png: Buffer, transparent: boolean): Promise<Buffer> {
  const s = sharp(png);
  return (transparent ? s : s.flatten({ background: "#ffffff" }).removeAlpha()).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

// ---------- Logos preparados ----------

type Logos = {
  /** El logo tal cual, con fondo transparente si se pudo. */
  color: Pic;
  colorTransparent: boolean;
  colorInk: string | null;
  /** Blanco (para fondos oscuros) y de un solo color oscuro. null si el logo tiene un fondo que no se pudo quitar. */
  light: Pic | null;
  dark: Pic | null;
  /** Símbolo para piezas cuadradas chicas. */
  mark: Pic;
  markLight: Pic | null;
  markInk: string | null;
  markMulti: boolean;
  /** Sin logo: se usa el nombre escrito con la letra de la marca. */
  wordmark: boolean;
  /** Sin símbolo cuadrado: las iniciales en un círculo. */
  monogram: boolean;
};

const DARK_INK = "#111827";

/** Nombre del negocio escrito con la letra de la marca, en una línea, con fondo transparente. */
async function wordmark(name: string, color: string, F: Fonts): Promise<Pic> {
  const size = 180;
  const text = name.trim() || "Logo";
  const w = Math.min(4000, Math.round(text.length * size * F.em * 1.15 + size));
  const png = await draw(
    <div style={{ width: w, height: 320, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", fontFamily: F.head, fontWeight: F.bold, fontSize: size, color, letterSpacing: -3, whiteSpace: "nowrap", lineHeight: 1 }}>{text}</div>
    </div>,
    w,
    320,
    F,
  );
  return pic(await trimTransparent(png, 0.03));
}

/** Iniciales en un círculo del color de la marca (símbolo de respaldo). */
async function monogram(name: string, bg: string, F: Fonts): Promise<Pic> {
  const s = 1024;
  const text = initials(name);
  const png = await draw(
    <div style={{ width: s, height: s, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: s, background: bg }}>
      <div style={{ display: "flex", fontFamily: F.head, fontWeight: F.bold, fontSize: text.length > 1 ? 420 : 560, color: "#ffffff", letterSpacing: -8, lineHeight: 1, marginTop: -20 }}>{text}</div>
    </div>,
    s,
    s,
    F,
  );
  return pic(png);
}

async function prepareLogos(b: KitBrand, F: Fonts, c1: string): Promise<Logos> {
  const MAX = 2000;
  const shrink = async (buf: Buffer) => sharp(buf).resize({ width: MAX, height: MAX, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  /** Sin el fondo y sin los huecos de su color (para pintarlo de un solo color). null si el fondo no se pudo quitar. */
  const solid = async (buf: Buffer) => {
    const t = await transparentLogo(buf, { holes: true });
    return t.transparent ? t.data : null;
  };
  let color: Pic;
  let colorTransparent = true;
  let light: Pic | null = null;
  let dark: Pic | null = null;
  let multi = false;
  let one: Buffer | null = null;
  const src = b.logoUrl ? await readMedia(b.logoUrl).catch(() => null) : null;
  const wordmarkUsed = !src;
  if (src) {
    const t = await transparentLogo(src);
    color = await pic(await shrink(t.data));
    colorTransparent = t.transparent;
    multi = colorTransparent && (await rawInk(color.buf)).multi;
    one = colorTransparent ? (multi ? color.buf : await solid(src)) : null;
    const lightSrc = b.logoLightUrl ? await readMedia(b.logoLightUrl).catch(() => null) : null;
    const ownLight = lightSrc ? await transparentLogo(lightSrc) : null;
    if (ownLight?.transparent) light = await pic(await shrink(ownLight.data));
    else if (one) light = await pic(await shrink(await oneColor(one, "#ffffff", multi)));
    if (one) dark = await pic(await shrink(await oneColor(one, DARK_INK, multi)));
  } else {
    const ink = contrast(c1, "#ffffff") >= 2.2 ? c1 : mix(c1, "#000000", 0.5);
    [color, light, dark] = await Promise.all([wordmark(b.name, ink, F), wordmark(b.name, "#ffffff", F), wordmark(b.name, DARK_INK, F)]);
  }
  const { ink: colorInk } = await rawInk(color.buf);

  // Símbolo: el isotipo aceptado del manual; si no, el símbolo que va al lado del nombre en el logo; si no, el logo
  // entero si es más o menos cuadrado; si no, las iniciales.
  let mark: Pic | null = null;
  let markLight: Pic | null = null;
  const markUrl = b.logoUrl ? bestMark(b.assets, b.logoUrl) : "";
  if (markUrl && markUrl !== b.logoUrl) {
    const m = await readMedia(markUrl).catch(() => null);
    if (m) {
      const t = await transparentLogo(m);
      mark = await pic(await shrink(t.data));
      const mMulti = t.transparent && (await rawInk(mark.buf)).multi;
      const mOne = t.transparent ? (mMulti ? mark.buf : await solid(m)) : null;
      markLight = mOne ? await pic(await shrink(await oneColor(mOne, "#ffffff", mMulti))) : null;
    }
  }
  if (!mark && src && colorTransparent) {
    const cut = await cutSymbol(color.buf);
    if (cut) {
      mark = await pic(cut);
      const mMulti = (await rawInk(cut)).multi;
      const cutOne = mMulti ? cut : one ? await cutSymbol(one) : null;
      markLight = cutOne ? await pic(await oneColor(cutOne, "#ffffff", mMulti)) : null;
    }
  }
  if (!mark && src && color.w / color.h <= 2.4 && color.w / color.h >= 0.42) {
    mark = color;
    markLight = light;
  }
  let monogramUsed = false;
  if (!mark) {
    // Un logo muy ancho no se lee en un cuadrado chico: van las iniciales.
    mark = await monogram(b.name, coverBackground(c1), F);
    monogramUsed = true;
  }
  const mi = await rawInk(mark.buf);
  return { color, colorTransparent, colorInk, light, dark, mark, markLight, markInk: mi.ink, markMulti: mi.multi, wordmark: wordmarkUsed, monogram: monogramUsed };
}

// ---------- Piezas ----------

type Ctx = {
  b: KitBrand;
  F: Fonts;
  L: Logos;
  c1: string;
  c2: string;
  c3: string;
  /** Fondo de las portadas (el principal, más oscuro si es muy claro). */
  bg: string;
  accent: string;
  lines: string[];
  phone: string;
  site: string;
  uri: (p: Pic, max: number) => Promise<Uri>;
};

/** Fondo de las portadas: degradado del color de la marca y formas suaves en las esquinas (fuera de la zona del texto). */
function decor(c: Ctx, w: number, h: number, style: "brand" | "light"): string {
  const m = Math.max(w, h);
  const s = Math.min(w, h);
  if (style === "light") {
    const tint = mix("#ffffff", c.c1, 0.05);
    return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="${tint}"/>
<polygon points="${w * 0.8},0 ${w},0 ${w},${h} ${w * 0.7},${h}" fill="${c.bg}"/>
<polygon points="${w * 0.77},0 ${w * 0.8},0 ${w * 0.7},${h} ${w * 0.67},${h}" fill="${c.accent}" opacity="0.9"/>
<circle cx="${w * 0.95}" cy="${h * 0.1}" r="${s * 0.55}" fill="#ffffff" opacity="0.07"/>
<circle cx="${w * 0.9}" cy="${h * 1.05}" r="${s * 0.35}" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="${s * 0.03}"/>
</svg>`);
  }
  const deep = mix(c.bg, "#000000", 0.38);
  const dots: string[] = [];
  const step = s * 0.06;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) dots.push(`<circle cx="${s * 0.08 + i * step}" cy="${s * 0.1 + j * step}" r="${s * 0.008}" fill="#ffffff" opacity="0.18"/>`);
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.bg}"/><stop offset="1" stop-color="${deep}"/></linearGradient>
<radialGradient id="r" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<circle cx="${w * 0.5}" cy="${h * 0.45}" r="${m * 0.45}" fill="url(#r)"/>
<circle cx="${w + m * 0.02}" cy="${-m * 0.04}" r="${m * 0.2}" fill="#ffffff" opacity="0.06"/>
<circle cx="${w - m * 0.04}" cy="${h + m * 0.03}" r="${m * 0.14}" fill="none" stroke="${c.accent}" stroke-opacity="0.55" stroke-width="${s * 0.025}"/>
<circle cx="${-m * 0.03}" cy="${h + m * 0.02}" r="${m * 0.12}" fill="${c.c2 !== c.c1 ? c.c2 : "#ffffff"}" opacity="${c.c2 !== c.c1 ? 0.35 : 0.05}"/>
${dots.join("")}
<rect x="0" y="${h - s * 0.022}" width="${w}" height="${s * 0.022}" fill="${c.accent}"/>
</svg>`);
}

/** Qué logo va sobre un fondo (y su versión para dibujar). */
function logoOn(c: Ctx, bg: string): Pic {
  const v = logoFor(bg, c.L.colorTransparent ? c.L.colorInk : null);
  if (v === "light" && c.L.light) return c.L.light;
  if (v === "dark" && c.L.dark) return c.L.dark;
  return c.L.color;
}
/** El logo de color tiene un fondo que no se pudo quitar y va sobre un fondo de otro color: va en una tarjeta blanca. */
const needsCard = (c: Ctx, p: Pic, bg: string) => p === c.L.color && !c.L.colorTransparent && contrast(bg, "#ffffff") > 1.3;

function LogoImg({ c, p, u, w, h, bg }: { c: Ctx; p: Uri; u: number; w: number; h: number; bg: string }) {
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  const img = <img src={p.uri} width={w} height={h} style={{ width: w, height: h }} />;
  if (!needsCard(c, c.L.color, bg) || p.uri === "") return img;
  return <div style={{ display: "flex", background: "#ffffff", borderRadius: Math.round(16 * u), padding: Math.round(18 * u) }}>{img}</div>;
}

function Contact({ c, size, color, iconColor, column }: { c: Ctx; size: number; color: string; iconColor: string; column?: boolean }) {
  if (!c.phone && !c.site) return null;
  const is = Math.round(size * 0.95);
  const item = (kind: "phone" | "web", text: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: Math.round(size * 0.4) }}>
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img src={icon(kind, iconColor)} width={is} height={is} style={{ width: is, height: is }} />
      <span>{text}</span>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: column ? "column" : "row", alignItems: column ? "flex-start" : "center", gap: Math.round(size * (column ? 0.5 : 1.3)), fontFamily: c.F.body, fontWeight: c.F.bodyWeight, fontSize: size, color, whiteSpace: "nowrap", lineHeight: 1.2 }}>
      {c.phone ? item("phone", c.phone) : null}
      {c.site ? item("web", c.site) : null}
    </div>
  );
}
/** Tamaño de la segunda línea (el otro idioma): mejor en una sola línea, achicándola hasta un 30%. */
const secondFit = (text: string, width: number, size: number, em: number) => {
  const one = fitText(text, width, 1, size, size * 0.7, em * 0.95);
  return one > Math.round(size * 0.7) ? one : Math.min(size, fitText(text, width, 2, size, 10, em * 0.95));
};
const contactWidth = (c: Ctx, size: number) => (c.phone.length + c.site.length) * size * 0.58 + (c.phone && c.site ? 4.2 : 1.5) * size;

/** Portada: fondo de la marca y, dentro de la zona segura, logo + frase + contacto (apilados o en fila). */
async function cover(c: Ctx, f: KitFormat, opts: { style?: "brand" | "light"; contact?: boolean; tagline?: boolean; offsetX?: number } = {}): Promise<Buffer> {
  const { w, h } = f;
  const style = opts.style ?? "brand";
  const bg = style === "brand" ? c.bg : mix("#ffffff", c.c1, 0.05);
  const dark = style === "brand";
  const safe = f.safe ?? { w: w * 0.86, h: h * 0.8 };
  // Un poco de aire dentro de la zona segura.
  // En el estilo claro el lado derecho es una franja de color: el contenido va en los dos tercios de la izquierda.
  const sw = style === "light" ? Math.round(w * 0.63 - h * 0.14) : Math.round(safe.w * 0.94);
  const sh = Math.round(safe.h * (safe.h < 260 ? 0.82 : 0.88));
  const left = style === "light" ? Math.round(h * 0.12) : Math.round((w - sw) / 2 + (opts.offsetX ?? 0));
  const top = Math.round((h - sh) / 2);
  const u = sh / 500;
  const lines = opts.tagline === false ? [] : c.lines;
  const showContact = opts.contact !== false && Boolean(c.phone || c.site);
  const row = sw / sh >= 2.6 || style === "light";
  const ink = dark ? "#ffffff" : mix("#0f172a", c.c1, 0.2);
  const sub = dark ? rgba("#ffffff", 0.82) : "#475569";
  const iconColor = dark ? (contrast(c.accent, bg) >= 1.8 ? c.accent : "#ffffff") : c.c1;
  const logoPic = logoOn(c, bg);
  const em = c.F.em;

  let body: React.ReactNode;
  if (row) {
    // Logo a la izquierda, línea de color y el texto a la derecha.
    const logoBox = fitInside(logoPic.w / logoPic.h, sw * (lines.length || showContact ? (logoPic.w / logoPic.h > 3 ? 0.4 : 0.34) : 0.8), sh * (lines.length || showContact ? 0.62 : 0.8));
    const logo = await c.uri(logoPic, Math.max(logoBox.w, logoBox.h) * 2);
    const gap = Math.round(sh * 0.12);
    const textW = Math.round(sw - logoBox.w - gap * 2 - 4);
    let contactSize = Math.round(Math.min(sh * 0.12, 30 * (sh / 191) * 0.95, sh * 0.13));
    contactSize = Math.max(12, Math.min(contactSize, Math.round(sh * 0.13)));
    while (contactSize > 12 && contactWidth(c, contactSize) > textW) contactSize--;
    const contactH = showContact ? contactSize * 1.3 : 0;
    const main = lines[0] ?? "";
    const second = lines[1] ?? "";
    const room = sh - contactH - (showContact ? sh * 0.1 : 0);
    let size = main ? fitText(main, textW, 2, sh * 0.3, sh * 0.1, em) : 0;
    const lineCount = (s: number) => (fitText(main, textW, 1, s, s - 1, em) === s ? 1 : 2);
    const secondSize = (s: number) => (second ? Math.max(12, Math.round(s * 0.6)) : 0);
    const textH = (s: number) => (main ? lineCount(s) * s * 1.12 : 0) + (second ? secondSize(s) * 1.25 + s * 0.15 : 0);
    while (size > 10 && textH(size) > room) size--;
    const ss = second ? secondFit(second, textW, secondSize(size), em) : 0;
    // El contacto nunca más grande que la frase.
    if (main) contactSize = Math.min(contactSize, Math.max(12, Math.round(size * 0.62)));
    body = (
      <div style={{ position: "absolute", left, top, width: sw, height: sh, display: "flex", alignItems: "center", gap }}>
        <div style={{ display: "flex", width: logoBox.w, justifyContent: "center", flexShrink: 0 }}>
          <LogoImg c={c} p={logo} u={u} w={logoBox.w} h={logoBox.h} bg={bg} />
        </div>
        {(main || showContact) && <div style={{ display: "flex", width: 4, height: Math.round(sh * 0.62), background: c.accent, borderRadius: 4, flexShrink: 0 }} />}
        {(main || showContact) && (
          <div style={{ display: "flex", flexDirection: "column", width: textW, gap: Math.round(sh * 0.08) }}>
            {main && (
              <div style={{ display: "flex", flexDirection: "column", gap: Math.round(size * 0.15) }}>
                <div style={{ display: "flex", fontFamily: c.F.head, fontWeight: c.F.bold, fontSize: size, lineHeight: 1.1, color: ink, letterSpacing: -Math.round(size * 0.015) }}>{main}</div>
                {second && <div style={{ display: "flex", fontFamily: c.F.head, fontWeight: c.F.semi, fontSize: ss, lineHeight: 1.2, color: sub }}>{second}</div>}
              </div>
            )}
            {showContact && <Contact c={c} size={contactSize} color={sub} iconColor={iconColor} />}
          </div>
        )}
      </div>
    );
  } else {
    // Apilado y centrado: logo arriba, la frase y el contacto abajo.
    const has = lines.length > 0;
    const logoBox = fitInside(logoPic.w / logoPic.h, sw * (has ? (logoPic.w / logoPic.h > 3 ? 0.66 : 0.5) : 0.7), sh * (has ? 0.3 : showContact ? 0.45 : 0.6));
    const logo = await c.uri(logoPic, Math.max(logoBox.w, logoBox.h) * 2);
    let contactSize = Math.round(sh * 0.062);
    while (contactSize > 12 && contactWidth(c, contactSize) > sw) contactSize--;
    const main = lines[0] ?? "";
    const second = lines[1] ?? "";
    const gap = Math.round(sh * 0.07);
    const room = sh - logoBox.h - gap * (showContact ? 2 : 1) - (showContact ? contactSize * 1.3 : 0);
    let size = main ? fitText(main, sw * 0.96, 2, sh * 0.15, sh * 0.06, em) : 0;
    const lineCount = (s: number) => (fitText(main, sw * 0.96, 1, s, s - 1, em) === s ? 1 : 2);
    const secondSize = (s: number) => (second ? Math.round(s * 0.58) : 0);
    const textH = (s: number) => (main ? lineCount(s) * s * 1.12 : 0) + (second ? secondSize(s) * 1.25 + s * 0.2 : 0);
    while (size > 12 && textH(size) > room) size--;
    const ss = second ? secondFit(second, sw * 0.96, secondSize(size), em) : 0;
    body = (
      <div style={{ position: "absolute", left, top, width: sw, height: sh, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap }}>
        <LogoImg c={c} p={logo} u={u} w={logoBox.w} h={logoBox.h} bg={bg} />
        {main && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: Math.round(size * 0.2), width: sw }}>
            <div style={{ display: "flex", justifyContent: "center", textAlign: "center", width: sw, fontFamily: c.F.head, fontWeight: c.F.bold, fontSize: size, lineHeight: 1.1, color: ink, letterSpacing: -Math.round(size * 0.015) }}>{main}</div>
            {second && <div style={{ display: "flex", justifyContent: "center", textAlign: "center", width: sw, fontFamily: c.F.head, fontWeight: c.F.semi, fontSize: ss, lineHeight: 1.2, color: sub }}>{second}</div>}
          </div>
        )}
        {showContact && <Contact c={c} size={contactSize} color={sub} iconColor={iconColor} />}
      </div>
    );
  }
  const png = await draw(
    <div style={{ width: w, height: h, display: "flex", position: "relative", background: bg }}>
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img src={decor(c, w, h, style)} width={w} height={h} style={{ position: "absolute", left: 0, top: 0, width: w, height: h }} />
      {body}
    </div>,
    w,
    h,
    c.F,
  );
  return finish(png, false);
}

/** Fondo de las piezas cuadradas (perfil, íconos): color de la marca con el símbolo blanco, o blanco con el símbolo a color. */
function squareStyle(c: Ctx): { bg: string; pic: Pic } {
  const L = c.L;
  if (L.monogram) return { bg: "#ffffff", pic: L.mark };
  // Un símbolo de varios colores o que no se puede pintar de blanco: sobre blanco, tal cual.
  if (L.markMulti || !L.markLight) return { bg: "#ffffff", pic: L.mark };
  return { bg: c.bg, pic: L.markLight };
}

async function profile(c: Ctx, f: KitFormat): Promise<Buffer> {
  const { bg, pic: p } = squareStyle(c);
  const d = f.w;
  // El monograma ya es un círculo: ocupa casi todo. Los demás quedan dentro del círculo que recortan las redes.
  const box = c.L.monogram ? { w: Math.round(d * 0.84), h: Math.round(d * 0.84) } : fitInCircle(p.w / p.h, d, 0.78);
  const img = await c.uri(p, Math.max(box.w, box.h));
  const png = await draw(
    <div style={{ width: d, height: d, display: "flex", alignItems: "center", justifyContent: "center", background: c.L.monogram ? coverBackground(c.c1) : bg }}>
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img src={img.uri} width={box.w} height={box.h} style={{ width: box.w, height: box.h }} />
    </div>,
    d,
    d,
    c.F,
  );
  return finish(png, false);
}

async function icon512(c: Ctx, f: KitFormat): Promise<Buffer> {
  const { bg, pic: p } = squareStyle(c);
  const s = f.w;
  const rounded = f.key === "favicon-32";
  const big = 512;
  const fill = c.L.monogram ? coverBackground(c.c1) : bg;
  const box = c.L.monogram ? { w: big, h: big } : fitInside(p.w / p.h, big * (rounded ? 0.8 : 0.66), big * (rounded ? 0.8 : 0.66));
  const img = await c.uri(p, Math.max(box.w, box.h));
  // Se dibuja grande y se achica (queda más nítido que dibujar a 32 px).
  const png = await draw(
    <div style={{ width: big, height: big, display: "flex", alignItems: "center", justifyContent: "center", background: c.L.monogram && rounded ? "transparent" : fill, borderRadius: rounded ? big * 0.22 : 0, border: rounded && fill === "#ffffff" ? `${big * 0.03}px solid ${rgba(c.c1, 0.25)}` : "none" }}>
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img src={img.uri} width={box.w} height={box.h} style={{ width: box.w, height: box.h }} />
    </div>,
    big,
    big,
    c.F,
  );
  const small = await sharp(png).resize(s, s, { kernel: s < 64 ? "lanczos3" : "lanczos3" }).png().toBuffer();
  return finish(small, rounded);
}

async function symbol(c: Ctx, f: KitFormat): Promise<Buffer> {
  const p = c.L.mark;
  const box = fitInside(p.w / p.h, f.w * 0.9, f.h * 0.9);
  const resized = await sharp(p.buf).resize(box.w, box.h, { fit: "fill" }).png().toBuffer();
  const out = await sharp({ create: { width: f.w, height: f.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, gravity: "center" }])
    .png()
    .toBuffer();
  return finish(out, true);
}

async function logoFile(p: Pic, f: KitFormat): Promise<Buffer> {
  const box = fitInside(p.w / p.h, f.w, f.h);
  const buf = p.w > box.w || p.h > box.h ? await sharp(p.buf).resize(box.w, box.h, { fit: "fill" }).png().toBuffer() : p.buf;
  return finish(buf, true);
}

/** Tarjeta: frente con el logo sobre el color de la marca; reverso blanco con los datos. */
async function cardFront(c: Ctx, f: KitFormat): Promise<Buffer> {
  return cover(c, f, { contact: false, tagline: c.lines.length > 0 });
}
async function cardBack(c: Ctx, f: KitFormat): Promise<Buffer> {
  const { w, h } = f;
  const safe = f.safe!;
  const left = Math.round((w - safe.w) / 2);
  const top = Math.round((h - safe.h) / 2);
  const band = Math.round(w * 0.2);
  const textW = safe.w - band - 30;
  const logoPic = logoOn(c, "#ffffff");
  const logoBox = fitInside(logoPic.w / logoPic.h, textW * 0.62, safe.h * 0.3);
  const logo = await c.uri(logoPic, Math.max(logoBox.w, logoBox.h) * 2);
  const main = c.lines[0] ?? "";
  const size = main ? fitText(main, textW, 2, 40, 22, c.F.em) : 0;
  let contactSize = 34;
  while (contactSize > 18 && Math.max(c.phone.length, c.site.length) * contactSize * 0.58 + contactSize * 1.6 > textW) contactSize--;
  const png = await draw(
    <div style={{ width: w, height: h, display: "flex", position: "relative", background: "#ffffff" }}>
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img src={decor(c, band, h, "brand")} width={band} height={h} style={{ position: "absolute", right: 0, top: 0, width: band, height: h }} />
      <div style={{ position: "absolute", right: band, top: 0, width: 10, height: h, display: "flex", background: c.accent }} />
      <div style={{ position: "absolute", left, top, width: textW, height: safe.h, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          <img src={logo.uri} width={logoBox.w} height={logoBox.h} style={{ width: logoBox.w, height: logoBox.h }} />
          {main && <div style={{ display: "flex", width: textW, fontFamily: c.F.head, fontWeight: c.F.semi, fontSize: size, lineHeight: 1.2, color: mix("#0f172a", c.c1, 0.2) }}>{main}</div>}
        </div>
        <Contact c={c} size={contactSize} color="#1f2937" iconColor={c.c1} column />
      </div>
    </div>,
    w,
    h,
    c.F,
  );
  return finish(png, false);
}

// ---------- Todo el kit ----------

export async function renderKit(b: KitBrand, opts: { only?: string[] } = {}): Promise<{ pieces: KitPiece[]; wordmark: boolean }> {
  const c1 = hexOr(b.color, "#126BBC");
  const c2 = hexOr(b.color2, c1);
  const c3 = hexOr(b.color3, c2);
  const F = await kitFonts(b.fontHeading, b.fontBody);
  const L = await prepareLogos(b, F, c1);
  const bg = coverBackground(c1);
  const accent = [c3, c2, mix(bg, "#ffffff", 0.45)].find((x) => x !== bg && contrast(x, bg) >= 1.5) ?? mix(bg, "#ffffff", 0.45);
  const uriCache = new Map<string, Promise<Uri>>();
  const c: Ctx = {
    b,
    F,
    L,
    c1,
    c2,
    c3,
    bg,
    accent,
    lines: coverLines(b.cover),
    phone: (b.phone ?? "").trim(),
    site: hostOf(b.website),
    uri: (p, max) => {
      // Tamaños redondeados para reusar la misma imagen en varias piezas.
      const m = Math.max(64, Math.ceil(max / 200) * 200);
      const key = `${L.color === p ? "c" : L.light === p ? "l" : L.dark === p ? "d" : L.mark === p ? "m" : L.markLight === p ? "ml" : p.w}-${m}`;
      let hit = uriCache.get(key);
      if (!hit) uriCache.set(key, (hit = uri(p, m)));
      return hit;
    },
  };
  const formats = KIT_FORMATS.filter((f) => !opts.only || opts.only.includes(f.key));
  const pieces = await pool(formats, 4, async (f): Promise<KitPiece> => {
    let data: Buffer;
    switch (f.key) {
      case "logo-color":
        data = await logoFile(L.color, f);
        break;
      case "logo-white":
        data = await logoFile(L.light ?? L.color, f);
        break;
      case "logo-dark":
        data = await logoFile(L.dark ?? L.color, f);
        break;
      case "email-logo":
        data = await logoFile(L.color, f);
        break;
      case "symbol":
        data = await symbol(c, f);
        break;
      case "profile":
        data = await profile(c, f);
        break;
      case "favicon-32":
      case "favicon-180":
      case "favicon-192":
      case "favicon-512":
        data = await icon512(c, f);
        break;
      case "email-header":
        data = await cover(c, f, { style: "light" });
        break;
      case "card-front":
        data = await cardFront(c, f);
        break;
      case "card-back":
        data = await cardBack(c, f);
        break;
      case "x-header":
        // La foto de perfil tapa la esquina de abajo a la izquierda: todo un poco a la derecha.
        data = await cover(c, f, { offsetX: 110 });
        break;
      case "og":
      case "fb-cover":
      case "linkedin-cover":
      case "yt-banner":
      case "gbp-cover":
        data = await cover(c, f);
        break;
      default:
        throw new Error(`Formato desconocido: ${f.key}`);
    }
    const m = await sharp(data).metadata();
    // El logo a color (y el de la firma) conserva su fondo si no se pudo quitar.
    const keepsBackground = (f.key === "logo-color" || f.key === "email-logo") && !L.colorTransparent;
    return { format: f, data, w: m.width ?? f.w, h: m.height ?? f.h, transparent: Boolean(f.transparent && m.hasAlpha && !keepsBackground) };
  });
  return { pieces, wordmark: L.wordmark };
}
