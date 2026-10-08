// Diseñador gráfico: dibuja los posts con la identidad de cada negocio (logo, colores, letras) usando
// plantillas. La IA no escribe bien letras dentro de las imágenes; aquí el texto se dibuja con fuentes
// reales, así que sale sin errores. Cada plantilla se adapta a la forma de cada red (cuadrada, vertical,
// historia 9:16, ancha 16:9…).
//
// Reglas de diseñador que se cumplen siempre (las cuentas están en design-layout.ts y tienen pruebas):
// - Cuadrícula: el mismo margen en los cuatro lados; en historias, nada importante arriba (14%) ni abajo (20%),
//   donde Instagram, Facebook y TikTok ponen sus botones.
// - Jerarquía: titular grande → texto corto → botón (llamada a la acción) → contacto discreto abajo.
// - El texto se mide con las letras reales: tamaño justo, líneas parejas, sin palabras cortas sueltas al final
//   de una línea, y nunca se sale de su caja. El logo tiene su propia zona: el texto nunca lo pisa.
// - Sobre fotos, un degradado oscuro debajo del texto calculado con la foto real para que se lea (contraste WCAG 4.5).
// - Logo claro u oscuro según el fondo; si no se leería, va sobre una placa.
import { readFile } from "fs/promises";
import path from "path";
import { ImageResponse } from "next/og";
import { readMedia } from "@/lib/media";
import sharp from "sharp";
import {
  BODY_FONTS,
  bodyFontId,
  contrast,
  DESIGN_SHAPES,
  FONTS,
  fontId,
  hexOr,
  mix,
  needsPhoto,
  rgba,
  PHOTO_BOXES,
  textBox,
  type Box,
  type CustomSpec,
  type DesignShape,
  type StoredTemplate,
} from "@/lib/design-shapes";
import { accentOn, fitText, gradientPair, grayOf, gridMargin, inkDark, inkForAll, isStory, pickInk, safeArea, scrimAlpha, shortHost, unitOf, type Fitted, type Measure } from "@/lib/design-layout";
import { measurer, parseFont } from "@/lib/font-metrics";

export { DESIGN_SHAPES, type DesignShape };

export type Brand = {
  name: string;
  color: string;
  color2?: string;
  color3?: string;
  logoUrl?: string;
  logoLightUrl?: string;
  phone?: string;
  website?: string;
  fontHeading?: string;
  /** Nombre libre de la letra del texto (por ejemplo "IBM Plex Sans"). */
  fontBody?: string;
  /** Eslogan de la marca (una línea corta). Opcional. */
  slogan?: string;
};

export type DesignInput = {
  brand: Brand;
  headline: string;
  /** Foto (las plantillas de color y de lista no la necesitan). */
  photoUrl?: string;
  /** Para las plantillas de lista. */
  steps?: string[];
  template: StoredTemplate;
  shape?: DesignShape;
  /** Texto corto debajo del titular (opcional). */
  sub?: string;
  /** Llamada a la acción, como un botón (opcional). Ej.: «Pide tu cotización». */
  cta?: string;
  /** Eslogan para este diseño. Si no viene, se usa brand.slogan; "" lo oculta. */
  slogan?: string;
  /** Lo importante de la foto (0-1 desde arriba a la izquierda) para recortarla bien en cada forma. */
  focus?: { x: number; y: number };
};

// ---------- Letras ----------

type Weight = 400 | 500 | 600 | 700 | 800;
type FontFile = { name: string; data: Buffer; weight: Weight; style: "normal" };
const fontCache = new Map<string, FontFile[]>();
const measureCache = new Map<string, Measure>();
async function fontFiles(file: string, name: string, weights: readonly Weight[]): Promise<FontFile[]> {
  const hit = fontCache.get(file);
  if (hit) return hit;
  const dir = path.join(process.cwd(), "src/assets/fonts");
  const list = await Promise.all(weights.map(async (weight) => ({ name, data: await readFile(path.join(dir, `${file}-${weight}.woff`)), weight, style: "normal" as const })));
  fontCache.set(file, list);
  return list;
}
/** Medidor del ancho del texto con la letra real (con un 3% de holgura por el redondeo del dibujo). */
function measureOf(file: string, f: FontFile, tracking = 0): Measure {
  const key = `${file}-${f.weight}-${tracking}`;
  const hit = measureCache.get(key);
  if (hit) return hit;
  const raw = measurer(parseFont(f.data));
  const m: Measure = (text, size) => raw(text, size, size * tracking) * 1.03;
  measureCache.set(key, m);
  return m;
}

/** Espacio entre letras del titular (en "em"): un poco cerrado en minúsculas, un poco abierto en mayúsculas. */
const headTracking = (upper: boolean) => (upper ? 0.01 : -0.015);
/** Alto de línea del titular según la letra. */
const HEAD_LH: Record<keyof typeof FONTS, number> = { montserrat: 1.1, poppins: 1.1, inter: 1.08, oswald: 1.08, "playfair-display": 1.14 };

/** Letras de titulares y de texto (con sus medidores). Si la del texto no está disponible, se usa la de los titulares. */
async function loadFonts(brand: Brand, upper: boolean) {
  const head = fontId(brand.fontHeading ?? "");
  const hf = FONTS[head];
  const fonts = await fontFiles(head, hf.name, [hf.semi, hf.bold]);
  const bold = fonts.find((f) => f.weight === hf.bold)!;
  const semi = fonts.find((f) => f.weight === hf.semi)!;
  const base = { head: hf.name, bold: hf.bold, semi: hf.semi, headLH: HEAD_LH[head], measureHead: measureOf(head, bold, headTracking(upper)), measureHeadPlain: measureOf(head, bold) };
  const bodyId = bodyFontId(brand.fontBody ?? "");
  const body = bodyId ? await fontFiles(bodyId, BODY_FONTS[bodyId].name, [BODY_FONTS[bodyId].regular, BODY_FONTS[bodyId].semi]).catch(() => null) : null;
  if (!bodyId || !body) {
    const m = measureOf(head, semi);
    return { ...base, fonts, body: hf.name, bodyRegular: hf.semi, bodySemi: hf.semi, measureBody: m, measureBodyReg: m, measureCaps: measureOf(head, semi, 0.12) };
  }
  const bf = BODY_FONTS[bodyId];
  const reg = body.find((f) => f.weight === bf.regular)!;
  const bsemi = body.find((f) => f.weight === bf.semi)!;
  return { ...base, fonts: [...fonts, ...body], body: bf.name, bodyRegular: bf.regular, bodySemi: bf.semi, measureBody: measureOf(bodyId, bsemi), measureBodyReg: measureOf(bodyId, reg), measureCaps: measureOf(bodyId, bsemi, 0.12) };
}

// ---------- Imágenes ----------

type Img = { uri: string; w: number; h: number };
async function readInput(url: string): Promise<Buffer> {
  // data: (vistas previas), https (tu almacenamiento) o /media/… (archivos en el disco del servidor).
  return url.startsWith("data:image/") ? Buffer.from(url.slice(url.indexOf(",") + 1), "base64") : readMedia(url);
}

/** Descarga una imagen y la deja como data URI (Satori la dibuja sin volver a pedirla). */
async function loadImage(url: string, maxSide = 2000): Promise<Img & { buf: Buffer }> {
  const input = await readInput(url);
  const img = sharp(input).rotate().resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true });
  const meta = await sharp(input).metadata();
  const png = Boolean(meta.hasAlpha);
  const { data, info } = png ? await img.png().toBuffer({ resolveWithObject: true }) : await img.jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
  return { uri: `data:image/${png ? "png" : "jpeg"};base64,${data.toString("base64")}`, w: info.width, h: info.height, buf: data };
}

/** Luminancia de la foto en una cuadrícula (para saber qué tan clara es donde va el texto o el logo). */
type LumGrid = { gw: number; gh: number; cells: Float32Array };
const GRID = 40;
const linear = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
async function lumGrid(buf: Buffer): Promise<LumGrid> {
  const { data } = await sharp(buf).resize(GRID, GRID, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const cells = new Float32Array(GRID * GRID);
  for (let i = 0; i < GRID * GRID; i++) cells[i] = 0.2126 * linear(data[i * 3]) + 0.7152 * linear(data[i * 3 + 1]) + 0.0722 * linear(data[i * 3 + 2]);
  return { gw: GRID, gh: GRID, cells };
}

type Photo = Img & { x: number; y: number; grid: LumGrid };
/**
 * La foto recortada al tamaño exacto de su espacio: con el punto importante (`focus`) si se conoce, o con el
 * recorte inteligente de sharp (busca lo que llama la atención). Si hay que agrandarla mucho, se le da nitidez.
 */
async function coverPhoto(url: string, x: number, y: number, w: number, h: number, focus?: { x: number; y: number }): Promise<Photo> {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  const rotated = await sharp(await readInput(url)).rotate().toBuffer();
  const meta = await sharp(rotated).metadata();
  const iw = meta.width ?? w;
  const ih = meta.height ?? h;
  const scale = Math.max(w / iw, h / ih);
  let pipe = sharp(rotated);
  if (focus && Number.isFinite(focus.x) && Number.isFinite(focus.y)) {
    const cw = Math.max(1, Math.min(iw, Math.round(w / scale)));
    const ch = Math.max(1, Math.min(ih, Math.round(h / scale)));
    const left = Math.round(Math.min(iw - cw, Math.max(0, focus.x * iw - cw / 2)));
    const top = Math.round(Math.min(ih - ch, Math.max(0, focus.y * ih - ch / 2)));
    pipe = pipe.extract({ left, top, width: cw, height: ch }).resize(w, h, { fit: "fill" });
  } else {
    pipe = pipe.resize(w, h, { fit: "cover", position: sharp.strategy.attention });
  }
  if (scale > 1.4) pipe = pipe.sharpen({ sigma: 0.9 });
  const out = await pipe.flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
  return { uri: `data:image/jpeg;base64,${out.toString("base64")}`, w, h, x: Math.round(x), y: Math.round(y), grid: await lumGrid(out) };
}

/** Luminancia de la foto (percentil `p`: 0.9 = la parte clara) dentro de un rectángulo del lienzo. */
function photoLum(ph: Photo, r: Box, p = 0.92): number {
  const x0 = Math.max(0, Math.floor(((r.x - ph.x) / ph.w) * ph.grid.gw));
  const x1 = Math.min(ph.grid.gw - 1, Math.ceil(((r.x + r.w - ph.x) / ph.w) * ph.grid.gw) - 1);
  const y0 = Math.max(0, Math.floor(((r.y - ph.y) / ph.h) * ph.grid.gh));
  const y1 = Math.min(ph.grid.gh - 1, Math.ceil(((r.y + r.h - ph.y) / ph.h) * ph.grid.gh) - 1);
  const vals: number[] = [];
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) vals.push(ph.grid.cells[yy * ph.grid.gw + xx]);
  if (!vals.length) return 0.5;
  vals.sort((a, b) => a - b);
  return vals[Math.min(vals.length - 1, Math.floor(vals.length * p))];
}

type Logo = Img & { tone: string };
/** El logo y su color medio (para saber si se lee sobre el fondo). */
async function loadLogo(url: string): Promise<Logo | null> {
  try {
    const img = await loadImage(url, 900);
    const { data, info } = await sharp(img.buf).ensureAlpha().resize(64, 64, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
    const all = [0, 0, 0, 0];
    const color = [0, 0, 0, 0];
    for (let i = 0; i < info.width * info.height; i++) {
      if (data[i * 4 + 3] < 128) continue;
      const px = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
      all[0] += px[0];
      all[1] += px[1];
      all[2] += px[2];
      all[3]++;
      if (px.every((v) => v > 240)) continue;
      color[0] += px[0];
      color[1] += px[1];
      color[2] += px[2];
      color[3]++;
    }
    // El color del logo es el de sus partes que no son blancas (si casi todo es blanco, es un logo claro).
    const src = color[3] > all[3] * 0.15 ? color : all;
    const hex = (v: number) => Math.round(v / Math.max(1, src[3])).toString(16).padStart(2, "0");
    // Un logo sin transparencia (JPG con fondo blanco) ya trae su propia "placa".
    const opaque = !(await sharp(img.buf).metadata()).hasAlpha;
    return { ...img, tone: opaque ? "opaque" : `#${hex(src[0])}${hex(src[1])}${hex(src[2])}` };
  } catch {
    return null;
  }
}

const GLOBE_PATH = "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z";
const PHONE_PATH = "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z";
const iconUri = (kind: "phone" | "web", color: string) => {
  const shape = kind === "phone" ? `<path d="${PHONE_PATH}"/>` : `<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="${GLOBE_PATH}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${shape}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
};

// ---------- Medidas por forma ----------

/** Tamaños del titular (en unidades de 1080) y máximo de líneas para cada forma. */
export function shapeRules(w: number, h: number): { headMax: number; headMin: number; maxLines: number } {
  const r = w / h;
  if (r >= 1.7) return { headMax: 112, headMin: 44, maxLines: 3 }; // enlace, ancho, email
  if (r >= 1.25) return { headMax: 104, headMin: 44, maxLines: 4 }; // Google 4:3
  if (r < 0.6) return { headMax: 132, headMin: 48, maxLines: 7 }; // historia
  if (r < 0.9) return { headMax: 108, headMin: 46, maxLines: 5 }; // vertical
  return { headMax: 98, headMin: 44, maxLines: 4 }; // cuadrado
}

// ---------- El diseño ----------

type Rect = { x: number; y: number; w: number; h: number };
type BlockPlan = {
  width: number;
  height: number;
  accent: "bar" | "quote" | null;
  accentH: number;
  head: Fitted;
  sub: Fitted | null;
  cta: { text: string; size: number; w: number; h: number } | null;
  gap: number;
};

/** Dibuja el diseño con la plantilla y lo devuelve en JPEG (Instagram solo acepta JPEG). */
export async function renderDesign(d: DesignInput): Promise<Buffer> {
  if (d.template.custom) return renderCustom(d, d.template.custom);
  const t = d.template;
  const { w, h } = DESIGN_SHAPES[d.shape ?? "square"];
  const b = d.brand;
  const F = await loadFonts(b, t.uppercase);
  const c1 = hexOr(b.color, "#126BBC");
  const c2 = hexOr(b.color2, c1);
  const c3 = hexOr(b.color3, c2);
  /** El color de la marca casi negro: para sombras y el degradado sobre fotos. */
  const deep = mix(c1, "#050a14", 0.86);
  const dark = inkDark(c1);
  let headline = d.headline.trim().replace(/\s+/g, " ").slice(0, 180);
  if (t.uppercase) headline = headline.toLocaleUpperCase("es");
  const sub = (d.sub ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
  const ctaText = (d.cta ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  const slogan = (d.slogan ?? b.slogan ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  const steps = (d.steps ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  if (needsPhoto(t) && !d.photoUrl) throw new Error(`La plantilla "${t.name}" necesita una foto.`);
  const withPhoto = needsPhoto(t) || (t.layout === "lista" && !!d.photoUrl);

  const u = unitOf(w, h);
  const m = gridMargin(w, h);
  const S = safeArea(w, h);
  const story = isStory(w, h);
  const ratio = w / h;
  const wide = ratio > 1.25;
  const tall = h / w > 1.1;
  const center = t.align === "centro";
  const align = center ? "center" : "left";
  const rules = shapeRules(w, h);
  const gap = Math.round(30 * u);

  const [logo, logoLight] = await Promise.all([b.logoUrl ? loadLogo(b.logoUrl) : null, b.logoLightUrl ? loadLogo(b.logoLightUrl) : null]);

  // ---------- Colores de los bloques ----------
  const [g1, g2] = gradientPair(c1, c2);
  const panelBase = { color1: c1, color2: c2, color3: c3, degradado: c1, blanco: "#ffffff" }[t.background];
  const gradient = t.background === "degradado" ? `linear-gradient(135deg, ${g1} 0%, ${g2} 100%)` : "";
  const panelStops = gradient ? [g1, g2] : [panelBase];
  const panelInk = t.background === "blanco" ? dark : inkForAll(panelStops, dark);
  /** Fondo "medio" del bloque (para elegir los colores de los detalles). */
  const panelMid = panelStops.length > 1 ? mix(panelStops[0], panelStops[1], 0.5) : panelBase;
  const panelStyle: React.CSSProperties = gradient ? { backgroundImage: gradient } : { background: panelBase };
  /** Color de los detalles (barra, comillas, íconos) sobre un fondo: el de acento si se distingue (3:1). */
  const accentFor = (bg: string, ink: string) => accentOn(bg, [c3, c2, c1], ink);

  // ---------- Logo ----------
  const logoH = Math.round((story ? 76 : wide ? 62 : 68) * u);
  const logoMaxW = Math.round(w * (story ? 0.5 : wide ? 0.26 : 0.36));
  const plateY = Math.round(logoH * 0.26);
  const plateX = Math.round(logoH * 0.36);
  // Sin logo: el nombre con la letra de los titulares, achicado si hace falta para que quepa entero.
  const nameMaxW = Math.round(w * (story ? 0.7 : wide ? 0.4 : 0.6));
  const nameBase = Math.round((b.name.length > 22 ? 36 : 44) * u);
  const nameSize = Math.max(Math.round(22 * u), Math.min(nameBase, Math.floor((nameBase * nameMaxW) / Math.max(1, F.measureHeadPlain(b.name, nameBase)))));
  type LogoPick = { pic: Logo | null; plate: string | null; w: number; h: number; textColor: string };
  type Under = { color: string } | { bright: number; darkest: number };
  /** Qué logo usar sobre un fondo (color liso, o la parte clara y oscura de la foto) y si necesita placa. */
  const pickLogo = (bg: Under): LogoPick => {
    const size = (pic: Logo | null) => {
      if (!pic) return { w: Math.ceil(Math.min(nameMaxW, F.measureHeadPlain(b.name, nameSize))), h: Math.round(nameSize * 1.15) };
      const lw = Math.min(logoMaxW, Math.round((logoH * pic.w) / pic.h));
      return { w: lw, h: Math.round((lw * pic.h) / pic.w) };
    };
    const readsOn = (tone: string) =>
      tone !== "opaque" && ("color" in bg ? contrast(tone, bg.color) >= 2.2 : Math.min(contrast(tone, grayOf(bg.bright)), contrast(tone, grayOf(bg.darkest))) >= 2.4);
    const plated = (s: { w: number; h: number }) => ({ w: s.w + plateX * 2, h: s.h + plateY * 2 });
    if (!logo) {
      // Sin logo: el nombre del negocio con la letra de los titulares.
      const ink = "color" in bg ? pickInk(bg.color, dark) : bg.bright < 0.25 ? "#ffffff" : dark;
      const s = size(null);
      return readsOn(ink) ? { pic: null, plate: null, ...s, textColor: ink } : { pic: null, plate: "#ffffff", ...plated(s), textColor: c1 };
    }
    for (const pic of [logo, logoLight]) if (pic && readsOn(pic.tone)) return { pic, plate: null, ...size(pic), textColor: "" };
    if (logo.tone === "opaque") return { pic: logo, plate: null, ...size(logo), textColor: "" };
    // No se lee directo: placa blanca (o del color oscuro de la marca si el logo es claro).
    const lightLogo = contrast(logo.tone, "#ffffff") < 2.2;
    return { pic: logo, plate: lightLogo ? deep : "#ffffff", ...plated(size(logo)), textColor: "" };
  };
  /** Alto que se reserva para la fila del logo (igual en todas las plantillas: la cuadrícula no salta). */
  const logoRow = logoH + plateY * 2;
  const LogoView = ({ pick }: { pick: LogoPick }) => {
    const iw = pick.w - (pick.plate ? plateX * 2 : 0);
    const ih = pick.h - (pick.plate ? plateY * 2 : 0);
    const inner = pick.pic ? (
      // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
      <img src={pick.pic.uri} width={iw} height={ih} style={{ width: iw, height: ih }} />
    ) : (
      <div style={{ display: "flex", maxWidth: iw, fontFamily: F.head, fontWeight: F.bold, fontSize: nameSize, lineHeight: 1.15, color: pick.textColor, whiteSpace: "nowrap", overflow: "hidden" }}>{b.name}</div>
    );
    if (!pick.plate) return inner;
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: pick.plate, borderRadius: Math.round(logoH * 0.22), padding: `${plateY}px ${plateX}px`, boxShadow: "0 6px 22px rgba(0,0,0,0.16)" }}>{inner}</div>;
  };

  // ---------- Contacto (teléfono y web) y eslogan ----------
  const phone = b.phone?.trim() ?? "";
  const site = shortHost(b.website);
  const hasContact = Boolean(phone || site);
  const baseContact = Math.round((wide ? 30 : story ? 34 : 31) * u);
  type ContactPlan = { size: number; stacked: boolean; w: number; h: number; parts: string[] };
  /** El contacto en una línea; si no cabe, en dos; si tampoco, con letra un poco más chica. */
  const planContact = (maxW: number, oneLine = false): ContactPlan | null => {
    if (!hasContact) return null;
    const parts = [phone, site].filter(Boolean);
    const sizes = [1, 0.9, 0.8, 0.72].map((k) => Math.round(baseContact * k));
    for (const size of sizes) {
      const icon = size * 0.92 + 10 * u;
      const widths = parts.map((p) => icon + F.measureBody(p, size));
      const one = widths.reduce((a, x) => a + x, 0) + (parts.length - 1) * 30 * u;
      if (one <= maxW) return { size, stacked: false, w: Math.ceil(one), h: Math.round(size * 1.3), parts };
      if (!oneLine && Math.max(...widths) <= maxW) return { size, stacked: true, w: Math.ceil(Math.max(...widths)), h: Math.round(size * 1.3 * parts.length + 8 * u), parts };
    }
    // Ni así: solo el teléfono (lo más útil).
    const size = sizes[sizes.length - 1];
    return { size, stacked: false, w: maxW, h: Math.round(size * 1.3), parts: [phone || site] };
  };
  const ContactView = ({ plan, color, icon, align: a }: { plan: ContactPlan; color: string; icon: string; align: "left" | "center" }) => (
    <div style={{ display: "flex", flexDirection: plan.stacked ? "column" : "row", alignItems: plan.stacked ? (a === "center" ? "center" : "flex-start") : "center", gap: Math.round((plan.stacked ? 8 : 30) * u), color, fontFamily: F.body, fontSize: plan.size, fontWeight: F.bodySemi, lineHeight: 1.3, whiteSpace: "nowrap" }}>
      {plan.parts.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: Math.round(10 * u) }}>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          <img src={iconUri(p === phone ? "phone" : "web", icon)} width={Math.round(plan.size * 0.92)} height={Math.round(plan.size * 0.92)} style={{ width: Math.round(plan.size * 0.92), height: Math.round(plan.size * 0.92) }} />
          <span>{p}</span>
        </div>
      ))}
    </div>
  );
  // Eslogan: una línea corta en mayúsculas espaciadas, solo en formas con alto suficiente.
  const sloganText = slogan.toLocaleUpperCase("es");
  const sloganBase = Math.round(baseContact * 0.72);
  const showSlogan = Boolean(slogan) && ratio <= 1.4;
  const sloganSize = (maxW: number) => {
    const at = F.measureCaps(sloganText, sloganBase);
    return at <= maxW ? sloganBase : Math.max(Math.round(16 * u), Math.floor((sloganBase * maxW) / at));
  };
  const SloganView = ({ color, a, maxW }: { color: string; a: "left" | "center"; maxW: number }) => {
    const size = sloganSize(maxW);
    return <div style={{ display: "flex", justifyContent: a === "center" ? "center" : "flex-start", maxWidth: maxW, fontFamily: F.body, fontWeight: F.bodySemi, fontSize: size, letterSpacing: size * 0.12, color, whiteSpace: "nowrap", lineHeight: 1.4, overflow: "hidden" }}>{sloganText}</div>;
  };

  /**
   * Pie: eslogan (opcional) y contacto con el estilo de la plantilla. `bg` es el color detrás, o null si es
   * una foto oscurecida (va en blanco).
   */
  const planFooter = (maxW: number, bg: string | null, a: "left" | "center") => {
    const ink = bg ? pickInk(bg, dark) : "#ffffff";
    const under = bg ?? deep;
    const sloganH = showSlogan ? Math.round(sloganSize(maxW) * 1.4) : 0;
    const pill = t.contactStyle === "pastilla";
    const padY = Math.round(14 * u);
    const padX = Math.round(28 * u);
    const plan = t.contactStyle === "franja" ? null : planContact(maxW - (pill ? padX * 2 : 0));
    let contact: React.ReactNode = null;
    let ch = 0;
    if (plan && pill) {
      const pillBg = accentOn(under, [c3, c2, c1, ink], ink);
      const fg = pickInk(pillBg, dark);
      ch = plan.h + padY * 2;
      contact = (
        <div style={{ display: "flex", background: pillBg, borderRadius: ch, padding: `${padY}px ${padX}px` }}>
          <ContactView plan={plan} color={fg} icon={fg} align={a} />
        </div>
      );
    } else if (plan) {
      ch = plan.h;
      contact = <ContactView plan={plan} color={ink} icon={accentFor(under, ink)} align={a} />;
    }
    const inner = Math.round(12 * u);
    const hgt = sloganH + ch + (sloganH && ch ? inner : 0);
    if (!hgt) return { h: 0, view: null as React.ReactNode };
    return {
      h: hgt,
      view: (
        <div style={{ display: "flex", flexDirection: "column", alignItems: a === "center" ? "center" : "flex-start", gap: inner }}>
          {sloganH > 0 && <SloganView color={ink} a={a} maxW={maxW} />}
          {contact}
        </div>
      ),
    };
  };

  /** Franja de contacto (estilo "franja"): de borde a borde abajo; en historias, flotando sobre la zona de botones. */
  const barH = t.contactStyle === "franja" && hasContact ? Math.round((wide ? 78 : 96) * u) : 0;
  const barSpace = barH ? barH + (story ? Math.round(28 * u) : 0) : 0;
  const ContactBar = ({ under }: { under: string }) => {
    if (!barH) return null;
    const barBg = contrast(c1, under) < 1.4 ? mix(c1, "#000000", 0.35) : c1;
    const fg = pickInk(barBg, dark);
    const plan = planContact((story ? w - m * 2 : w) - m * 2, true);
    if (!plan) return null;
    const style: React.CSSProperties = story
      ? { position: "absolute", left: m, width: w - m * 2, top: h - S.bottom - barH, height: barH, borderRadius: Math.round(barH / 2) }
      : { position: "absolute", left: 0, width: w, top: h - barH, height: barH };
    return (
      <div style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", background: barBg }}>
        <ContactView plan={plan} color={fg} icon={accentOn(barBg, [c3, c2], fg)} align="center" />
      </div>
    );
  };

  // ---------- Bloque de texto: detalle, titular, texto corto y botón ----------
  const planBlock = (width: number, maxH: number, o: { maxLines?: number; capScale?: number } = {}): BlockPlan => {
    const accent = t.accent === "barra" ? "bar" : t.accent === "comillas" ? "quote" : null;
    const accentH = accent === "bar" ? Math.round(10 * u) : accent === "quote" ? Math.round(80 * u) : 0;
    const subSize = Math.round((story ? 40 : wide ? 32 : 36) * u);
    const ctaSize = Math.round((wide ? 28 : 32) * u);
    const cta = ctaText ? { text: ctaText, size: ctaSize, w: Math.min(width, Math.ceil(F.measureBody(ctaText, ctaSize) + 2 * 34 * u)), h: Math.round(ctaSize * 1.25 + 2 * 18 * u) } : null;
    let rest = maxH - (accent ? accentH + gap : 0) - (cta ? cta.h + gap : 0);
    const subFit = sub ? fitText({ text: sub, maxW: width, maxH: Math.max(subSize * 1.3, rest * 0.34), max: subSize, min: Math.round(subSize * 0.8), maxLines: 3, lineHeight: 1.3, measure: F.measureBodyReg }) : null;
    if (subFit) rest -= subFit.height + Math.round(gap * 0.7);
    const max = Math.round(rules.headMax * u * t.headlineScale * (o.capScale ?? 1));
    const min = Math.round(rules.headMin * u);
    const head = fitText({ text: headline, maxW: width, maxH: Math.max(min * F.headLH, rest), max: Math.max(min, max), min, maxLines: o.maxLines ?? rules.maxLines, hardLines: (o.maxLines ?? rules.maxLines) + 3, lineHeight: F.headLH, measure: F.measureHead });
    const height = (accent ? accentH + gap : 0) + head.height + (subFit ? subFit.height + Math.round(gap * 0.7) : 0) + (cta ? cta.h + gap : 0);
    return { width, height: Math.ceil(height), accent, accentH, head, sub: subFit, cta, gap };
  };
  const BlockView = ({ p, color, bg, shadow }: { p: BlockPlan; color: string; bg: string; shadow?: boolean }) => {
    const acc = accentFor(bg, color);
    const ai = center ? "center" : "flex-start";
    const ctaBg = accentOn(bg, [c3, c2, c1], color);
    return (
      <div style={{ display: "flex", flexDirection: "column", width: p.width, alignItems: ai }}>
        {p.accent === "bar" && <div style={{ display: "flex", width: Math.round(84 * u), height: p.accentH, borderRadius: 99, background: acc, marginBottom: p.gap }} />}
        {p.accent === "quote" && (
          <div style={{ display: "flex", height: p.accentH, marginBottom: p.gap, fontFamily: F.head, fontWeight: F.bold, fontSize: Math.round(180 * u), lineHeight: 1, color: acc, overflow: "hidden" }}>“</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", width: p.width, alignItems: ai, fontFamily: F.head, fontWeight: F.bold, fontSize: p.head.size, lineHeight: F.headLH, color, letterSpacing: p.head.size * headTracking(t.uppercase), textShadow: shadow ? "0 2px 14px rgba(0,0,0,0.28)" : "none" }}>
          {p.head.lines.map((l, i) => (
            <div key={i} style={{ display: "flex", whiteSpace: "pre", height: Math.round(p.head.size * F.headLH) }}>{l}</div>
          ))}
        </div>
        {p.sub && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: ai, marginTop: Math.round(p.gap * 0.7), fontFamily: F.body, fontWeight: F.bodyRegular, fontSize: p.sub.size, lineHeight: 1.3, color }}>
            {p.sub.lines.map((l, i) => (
              <div key={i} style={{ display: "flex", whiteSpace: "pre" }}>{l}</div>
            ))}
          </div>
        )}
        {p.cta && (
          <div style={{ display: "flex", marginTop: p.gap, height: p.cta.h, maxWidth: p.cta.w, alignItems: "center", padding: `0 ${Math.round(34 * u)}px`, borderRadius: p.cta.h, background: ctaBg, color: pickInk(ctaBg, dark), fontFamily: F.body, fontWeight: F.bodySemi, fontSize: p.cta.size, whiteSpace: "nowrap", overflow: "hidden" }}>{p.cta.text}</div>
        )}
      </div>
    );
  };

  const nodes: React.ReactNode[] = [];
  const Abs = ({ r, children, style }: { r: Rect; children?: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={{ position: "absolute", display: "flex", left: Math.round(r.x), top: Math.round(r.y), width: Math.round(r.w), height: Math.round(r.h), ...style }}>{children}</div>
  );
  const PhotoView = ({ p }: { p: Photo }) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img src={p.uri} width={p.w} height={p.h} style={{ position: "absolute", left: p.x, top: p.y, width: p.w, height: p.h }} />
  );
  /** Pone el logo en una fila: `x` es el borde izquierdo (o el derecho si `right`). */
  const placeLogo = (pick: LogoPick, x: number, rowY: number, right: boolean, rowH = logoRow) => {
    const top = Math.round(rowY + (rowH - pick.h) / 2);
    nodes.push(
      <div key="logo" style={{ position: "absolute", display: "flex", top, ...(right ? { left: Math.round(x - pick.w) } : { left: Math.round(x) }) }}>
        <LogoView pick={pick} />
      </div>,
    );
  };
  /** La parte clara y oscura de la foto en un rectángulo (para elegir el logo). */
  const photoBg = (ph: Photo, r: Rect): Under => ({ bright: photoLum(ph, r, 0.9), darkest: photoLum(ph, r, 0.1) });

  /**
   * Degradado oscuro (con el tono de la marca) en las bandas donde hay texto sobre la foto, calculado para
   * que el texto blanco tenga contraste 4.5 sobre la parte más clara de esa banda.
   */
  const scrim = (ph: Photo, bands: { r: Rect; floor: number }[]) => {
    const steps = 48;
    const feather = Math.max(h * 0.16, 150 * u);
    const alphaAt = new Array<number>(steps + 1).fill(0);
    for (const band of bands) {
      if (band.r.h <= 0) continue;
      const need = scrimAlpha(grayOf(photoLum(ph, band.r, 0.94)), deep, 4.6, band.floor);
      if (need <= 0.01) continue;
      for (let i = 0; i <= steps; i++) {
        const y = (i / steps) * h;
        const y0 = band.r.y - 24 * u;
        const y1 = band.r.y + band.r.h + 24 * u;
        const k = y >= y0 && y <= y1 ? 1 : y < y0 ? Math.max(0, 1 - (y0 - y) / feather) : Math.max(0, 1 - (y - y1) / feather);
        alphaAt[i] = Math.max(alphaAt[i], need * k * k * (3 - 2 * k));
      }
    }
    if (alphaAt.every((a) => a <= 0.01)) return;
    const stops = alphaAt.map((a, i) => `${rgba(deep, Math.round(a * 1000) / 1000)} ${((i / steps) * 100).toFixed(2)}%`).join(", ");
    nodes.push(<Abs key="scrim" r={{ x: ph.x, y: 0, w: ph.w, h }} style={{ backgroundImage: `linear-gradient(to bottom, ${stops})` }} />);
  };

  const logoTop = t.logoPosition !== "abajo-derecha";
  const logoRight = t.logoPosition === "arriba-derecha";
  /** Fila de abajo: pie a la izquierda (o centrado) y, si la plantilla lo pide, el logo a la derecha. */
  const bottomRow = (textX: number, textW: number, bg: string | null, logoUnder: (r: Rect) => Under) => {
    const rowBottom = h - S.bottom - barSpace;
    const pick = !logoTop ? pickLogo(logoUnder({ x: w - m - logoMaxW, y: rowBottom - logoRow, w: logoMaxW, h: logoRow })) : null;
    const footW = pick ? Math.min(textW, w - m - pick.w - gap - textX) : textW;
    const a = pick ? "left" : align;
    const footer = planFooter(footW, bg, a);
    const rowH = Math.max(footer.h, pick ? logoRow : 0);
    return {
      rowH,
      footW,
      footY: rowBottom - footer.h,
      render: () => {
        if (footer.view) nodes.push(<Abs key="foot" r={{ x: textX, y: rowBottom - footer.h, w: footW, h: footer.h }} style={{ justifyContent: a === "center" ? "center" : "flex-start" }}>{footer.view}</Abs>);
        if (pick) placeLogo(pick, w - m, rowBottom - logoRow, true);
      },
    };
  };
  let canvasBg = c1;

  if (t.layout === "foto-completa") {
    // Foto entera con un degradado oscuro donde va el texto.
    const ph = await coverPhoto(d.photoUrl!, 0, 0, w, h, d.focus);
    nodes.push(<PhotoView key="photo" p={ph} />);
    const textW = Math.round(wide ? (center ? w * 0.72 : w * 0.6) : w - m * 2);
    const textX = center ? Math.round((w - textW) / 2) : m;
    const row = bottomRow(textX, textW, null, (r) => photoBg(ph, r));
    const top = S.top + (logoTop ? logoRow + Math.round(gap * 1.4) : 0);
    const bottom = h - S.bottom - barSpace - (row.rowH ? row.rowH + Math.round(gap * 1.3) : 0);
    const frameH = bottom - top;
    const blk = planBlock(textW, frameH * (t.textPosition === "centro" ? 0.82 : 0.74));
    const by = t.textPosition === "arriba" ? top : t.textPosition === "centro" ? top + (frameH - blk.height) / 2 : bottom - blk.height;
    const floor = t.overlay === "fuerte" ? 0.55 : t.overlay === "suave" ? 0.35 : 0;
    scrim(ph, [
      { r: { x: textX, y: by, w: textW, h: blk.height }, floor },
      { r: { x: textX, y: row.footY, w: row.footW, h: h - S.bottom - barSpace - row.footY }, floor: 0 },
    ]);
    nodes.push(<Abs key="block" r={{ x: textX, y: by, w: textW, h: blk.height }}><BlockView p={blk} color="#ffffff" bg={deep} shadow /></Abs>);
    row.render();
    if (logoTop) placeLogo(pickLogo(photoBg(ph, { x: logoRight ? w - m - logoMaxW : m, y: S.top, w: logoMaxW, h: logoRow })), logoRight ? w - m : m, S.top, logoRight);
    nodes.push(<ContactBar key="bar" under={deep} />);
  } else if (t.layout === "franja-abajo" && t.background === "blanco") {
    // Tarjeta blanca flotando sobre la foto.
    const ph = await coverPhoto(d.photoUrl!, 0, 0, w, h, d.focus);
    nodes.push(<PhotoView key="photo" p={ph} />);
    const cardW = Math.round(wide ? w * 0.5 : w - m * 2);
    const pad = Math.round((wide ? 44 : 52) * u);
    const innerW = cardW - pad * 2;
    const footer = planFooter(innerW, "#ffffff", align);
    const avail = h - S.top - S.bottom - barSpace - logoRow - gap * 2;
    const blk = planBlock(innerW, (wide ? avail : avail * 0.62) - pad * 2 - (footer.h ? footer.h + gap : 0), { capScale: 0.84 });
    const cardH = blk.height + pad * 2 + (footer.h ? footer.h + gap : 0);
    const cardY = h - S.bottom - barSpace - cardH;
    nodes.push(
      <Abs key="card" r={{ x: m, y: cardY, w: cardW, h: cardH }} style={{ flexDirection: "column", alignItems: center ? "center" : "flex-start", background: "#ffffff", borderRadius: Math.round(28 * u), padding: pad, gap, boxShadow: "0 18px 60px rgba(0,0,0,0.28)" }}>
        <BlockView p={blk} color={dark} bg="#ffffff" />
        {footer.view}
      </Abs>,
    );
    // El logo nunca va sobre la tarjeta: arriba; "abajo a la derecha" solo en formas anchas (al lado de la tarjeta).
    if (!logoTop && wide) {
      const ly = h - S.bottom - barSpace - logoRow;
      placeLogo(pickLogo(photoBg(ph, { x: w - m - logoMaxW, y: ly, w: logoMaxW, h: logoRow })), w - m, ly, true);
    } else {
      const right = logoRight || !logoTop;
      placeLogo(pickLogo(photoBg(ph, { x: right ? w - m - logoMaxW : m, y: S.top, w: logoMaxW, h: logoRow })), right ? w - m : m, S.top, right);
    }
    nodes.push(<ContactBar key="bar" under="#777777" />);
  } else if (t.layout === "franja-arriba" || t.layout === "franja-abajo" || t.layout === "mitad-izquierda") {
    // Bloque de color y foto. En formas anchas (y en "mitad" cuadrada) van lado a lado; en verticales, uno arriba del otro.
    // "Mitad" cuadrada: lado a lado, salvo que el titular no quepa en media imagen (entonces uno arriba del otro).
    const halfW = Math.round(w * 0.52) - m * 2;
    const fitsHalf = () => !planBlock(halfW, h - S.top - logoRow - Math.round(gap * 1.4) - S.bottom - barSpace - Math.round(gap * 1.3) - planFooter(halfW, panelMid, align).h, { capScale: 0.84, maxLines: 5 }).head.truncated;
    const side = wide || (t.layout === "mitad-izquierda" && !tall && fitsHalf());
    const panelFirst = t.layout !== "franja-abajo" && !(t.layout === "mitad-izquierda" && tall);
    if (side) {
      const panelW = Math.round(w * (t.layout === "mitad-izquierda" && !wide ? 0.52 : 0.47));
      const panelX = panelFirst ? 0 : w - panelW;
      const ph = await coverPhoto(d.photoUrl!, panelFirst ? panelW : 0, 0, w - panelW, h - barH, d.focus);
      nodes.push(<Abs key="panel" r={{ x: panelX, y: 0, w: panelW, h }} style={panelStyle} />);
      nodes.push(<PhotoView key="photo" p={ph} />);
      const textW = panelW - m * 2;
      const textX = panelX + m;
      const footer = planFooter(textW, panelMid, align);
      const top = S.top + logoRow + Math.round(gap * 1.4);
      const bottom = h - S.bottom - barSpace - (footer.h ? footer.h + Math.round(gap * 1.3) : 0);
      const blk = planBlock(textW, bottom - top, { capScale: 0.84, maxLines: 5 });
      const by = top + (bottom - top - blk.height) / 2;
      nodes.push(<Abs key="block" r={{ x: textX, y: by, w: textW, h: blk.height }}><BlockView p={blk} color={panelInk} bg={panelMid} /></Abs>);
      if (footer.view) nodes.push(<Abs key="foot" r={{ x: textX, y: h - S.bottom - barSpace - footer.h, w: textW, h: footer.h }} style={{ justifyContent: center ? "center" : "flex-start" }}>{footer.view}</Abs>);
      // El logo va en el bloque de color, arriba (a la derecha del bloque si la plantilla lo pide).
      const right = t.logoPosition === "arriba-derecha";
      placeLogo(pickLogo({ color: panelMid }), right ? textX + textW : textX, S.top, right);
      nodes.push(<ContactBar key="bar" under={panelMid} />);
    } else {
      // Uno arriba del otro. La franja crece con el texto (entre 40% y 60% del alto).
      const textW = w - m * 2;
      const footer = planFooter(textW, panelMid, align);
      const photoFirst = !panelFirst;
      const logoInPanel = panelFirst ? logoTop : !logoTop;
      const minBand = Math.round(h * (story ? 0.44 : 0.42));
      const maxBand = Math.round(h * 0.6);
      const padIn = Math.round(56 * u);
      const padTop = panelFirst ? S.top : padIn;
      const padBottom = panelFirst ? padIn : S.bottom + barSpace;
      const logoSpace = logoInPanel ? logoRow + Math.round(gap * 1.3) : 0;
      const fixed = padTop + padBottom + logoSpace + (footer.h ? footer.h + gap : 0);
      const blk = planBlock(textW, maxBand - fixed, { capScale: 0.9 });
      const band = Math.min(maxBand, Math.max(minBand, fixed + blk.height));
      const bandY = photoFirst ? h - band : 0;
      const ph = await coverPhoto(d.photoUrl!, 0, photoFirst ? 0 : band, w, h - band - (photoFirst || story ? 0 : barH), d.focus);
      nodes.push(<Abs key="panel" r={{ x: 0, y: bandY, w, h: band }} style={panelStyle} />);
      nodes.push(<PhotoView key="photo" p={ph} />);
      const line = accentFor(panelMid, panelInk);
      if (line !== panelInk) nodes.push(<Abs key="line" r={{ x: 0, y: (photoFirst ? bandY : band) - Math.round(5 * u), w, h: Math.round(10 * u) }} style={{ background: line }} />);
      // Dentro de la franja, de arriba a abajo: logo (si va arriba), titular, pie, logo (si va abajo).
      const innerTop = bandY + padTop + (logoInPanel && panelFirst ? logoSpace : 0);
      const innerBottom = bandY + band - padBottom - (footer.h ? footer.h + gap : 0) - (logoInPanel && !panelFirst ? logoSpace : 0);
      const by = innerTop + Math.max(0, (innerBottom - innerTop - blk.height) / 2);
      nodes.push(<Abs key="block" r={{ x: m, y: by, w: textW, h: blk.height }}><BlockView p={blk} color={panelInk} bg={panelMid} /></Abs>);
      if (footer.view) nodes.push(<Abs key="foot" r={{ x: m, y: by + blk.height + gap, w: textW, h: footer.h }} style={{ justifyContent: center ? "center" : "flex-start" }}>{footer.view}</Abs>);
      if (logoInPanel) {
        const ly = panelFirst ? S.top : bandY + band - padBottom - logoRow;
        const right = panelFirst ? logoRight : true;
        placeLogo(pickLogo({ color: panelMid }), right ? w - m : m, ly, right);
      } else {
        // Logo sobre la foto: arriba si la foto está arriba; si la foto está abajo, abajo a la derecha.
        const ly = photoFirst ? S.top : h - S.bottom - barSpace - logoRow;
        const right = photoFirst ? logoRight : true;
        placeLogo(pickLogo(photoBg(ph, { x: right ? w - m - logoMaxW : m, y: ly, w: logoMaxW, h: logoRow })), right ? w - m : m, ly, right);
      }
      nodes.push(<ContactBar key="bar" under={photoFirst ? panelMid : "#777777"} />);
    }
  } else if (t.layout === "color-solido") {
    // Una frase grande sobre el color de la marca, con detalles suaves en las esquinas (lejos del texto).
    const textW = Math.round(wide ? w * (center ? 0.74 : 0.66) : w - m * 2);
    const textX = center ? Math.round((w - textW) / 2) : m;
    nodes.push(<Abs key="bg" r={{ x: 0, y: 0, w, h }} style={panelStyle} />);
    const ring = Math.round(Math.max(w, h) * 0.6);
    const soft = t.background === "blanco" ? rgba(c1, 0.06) : rgba(panelInk === "#ffffff" ? "#ffffff" : dark, 0.06);
    nodes.push(<Abs key="ring" r={{ x: logoRight ? -ring * 0.45 : w - ring * 0.55, y: -ring * 0.42, w: ring, h: ring }} style={{ borderRadius: ring, border: `${Math.round(54 * u)}px solid ${soft}` }} />);
    if (t.accent === "circulos") {
      const cs = Math.round(ring * 0.6);
      const circle = accentOn(panelMid, [c3, c2], panelInk === "#ffffff" ? "#ffffff" : c1, 1.3);
      nodes.push(<Abs key="dot" r={{ x: logoTop ? w - cs * 0.62 : -cs * 0.4, y: h - cs * 0.5, w: cs, h: cs }} style={{ borderRadius: cs, background: rgba(circle, 0.2) }} />);
    }
    const row = bottomRow(textX, textW, panelMid, () => ({ color: panelMid }));
    const top = S.top + (logoTop ? logoRow + Math.round(gap * 1.6) : 0);
    const bottom = h - S.bottom - barSpace - (row.rowH ? row.rowH + Math.round(gap * 1.4) : 0);
    const blk = planBlock(textW, bottom - top, { capScale: 1.06 });
    const by = top + (t.textPosition === "arriba" ? 0 : t.textPosition === "centro" ? (bottom - top - blk.height) / 2 : bottom - top - blk.height);
    nodes.push(<Abs key="block" r={{ x: textX, y: by, w: textW, h: blk.height }}><BlockView p={blk} color={panelInk} bg={panelMid} /></Abs>);
    row.render();
    if (logoTop) placeLogo(pickLogo({ color: panelMid }), logoRight ? w - m : m, S.top, logoRight);
    nodes.push(<ContactBar key="bar" under={panelMid} />);
  } else {
    // Lista de pasos: fondo claro, titular oscuro y tarjetas numeradas.
    const soft = mix("#ffffff", c1, 0.05);
    canvasBg = soft;
    const photoSide = withPhoto && wide;
    const photoTopH = withPhoto && !wide ? Math.round(h * (story ? 0.3 : 0.27)) : 0;
    let ph: Photo | null = null;
    if (photoSide) ph = await coverPhoto(d.photoUrl!, Math.round(w * 0.58), 0, w - Math.round(w * 0.58), h - (story ? 0 : barH), d.focus);
    else if (photoTopH) ph = await coverPhoto(d.photoUrl!, 0, 0, w, photoTopH, d.focus);
    if (ph) nodes.push(<PhotoView key="photo" p={ph} />);
    const textW = Math.round(photoSide ? w * 0.58 - m * 2 : w - m * 2);
    const footer = planFooter(textW, soft, "left");
    const footerY = h - S.bottom - barSpace - footer.h;
    const top = photoTopH ? Math.max(photoTopH + Math.round(gap * 1.5), S.top) : S.top + logoRow + Math.round(gap * 1.4);
    const bottom = footer.h ? footerY - Math.round(gap * 1.2) : h - S.bottom - barSpace;
    const avail = bottom - top;
    // Pasos: letra de 38 a 24 (en 1080) hasta que quepan junto con un titular que se lea.
    const num = Math.round((wide ? 52 : tall ? 68 : 60) * u);
    const stepGap = Math.round(16 * u);
    const cardPad = Math.round(18 * u);
    const numGap = Math.round(22 * u);
    let stepFits: Fitted[] = [];
    let stepsH = 0;
    let blk = planBlock(textW, avail);
    for (const base of [tall ? 38 : 34, 32, 30, 28, 26, 24]) {
      const ss = Math.round(base * u);
      const sw = textW - num - numGap - cardPad * 2;
      stepFits = steps.map((s) => fitText({ text: s, maxW: sw, maxH: ss * 1.25 * 3, max: ss, min: Math.round(ss * 0.9), maxLines: 3, lineHeight: 1.25, measure: F.measureBody }));
      stepsH = stepFits.reduce((a, f) => a + Math.max(num, f.height) + cardPad * 2, 0) + Math.max(0, steps.length - 1) * stepGap;
      blk = planBlock(textW, avail - stepsH - (steps.length ? Math.round(gap * 1.2) : 0), { capScale: wide ? 0.66 : 0.82, maxLines: wide ? 3 : 4 });
      if (!blk.head.truncated) break;
    }
    const total = blk.height + (steps.length ? Math.round(gap * 1.2) + stepsH : 0);
    const by = top + Math.max(0, (avail - total) / 2);
    const numBg = [c1, accentOn("#ffffff", [c3, c2], c1), accentOn("#ffffff", [c2, c3], c1)];
    nodes.push(
      <Abs key="list" r={{ x: m, y: by, w: textW, h: total }} style={{ flexDirection: "column", gap: Math.round(gap * 1.2) }}>
        <BlockView p={blk} color={dark} bg={soft} />
        {steps.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", width: textW, gap: stepGap }}>
            {stepFits.map((f, i) => (
              <div key={i} style={{ display: "flex", width: textW, alignItems: "center", gap: numGap, background: "#ffffff", borderRadius: Math.round(18 * u), padding: cardPad, boxShadow: `0 4px 18px ${rgba(c1, 0.1)}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: num, height: num, borderRadius: num, background: numBg[i], color: pickInk(numBg[i], dark), fontFamily: F.head, fontSize: Math.round(num * 0.46), fontWeight: F.bold, flexShrink: 0 }}>{i + 1}</div>
                <div style={{ display: "flex", flexDirection: "column", fontFamily: F.body, fontSize: f.size, fontWeight: F.bodySemi, color: dark, lineHeight: 1.25 }}>
                  {f.lines.map((l, j) => (
                    <div key={j} style={{ display: "flex", whiteSpace: "pre" }}>{l}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Abs>,
    );
    if (footer.view) nodes.push(<Abs key="foot" r={{ x: m, y: footerY, w: textW, h: footer.h }}>{footer.view}</Abs>);
    if (photoTopH && ph) {
      const ly = Math.min(S.top, photoTopH - logoRow - Math.round(24 * u));
      placeLogo(pickLogo(photoBg(ph, { x: logoRight ? w - m - logoMaxW : m, y: ly, w: logoMaxW, h: logoRow })), logoRight ? w - m : m, ly, logoRight);
    } else placeLogo(pickLogo({ color: soft }), m, S.top, false);
    nodes.push(<ContactBar key="bar" under={soft} />);
  }

  const img = new ImageResponse(
    (
      <div style={{ width: w, height: h, display: "flex", position: "relative", fontFamily: F.head, background: canvasBg }}>
        {nodes}
      </div>
    ),
    { width: w, height: h, fonts: F.fonts },
  );
  const png = Buffer.from(await img.arrayBuffer());
  return sharp(png).jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
}

// ---------- Plantillas propias (subidas por el dueño) ----------

/**
 * Dibuja una plantilla propia: la imagen del dueño, la foto y el titular. Se dibuja con la forma de la
 * imagen subida; si la red pide otra forma, se centra sobre un fondo desenfocado (sin cortar el diseño).
 */
async function renderCustom(d: DesignInput, c: CustomSpec): Promise<Buffer> {
  const target = DESIGN_SHAPES[d.shape ?? "square"];
  const F = await loadFonts(d.brand, false);
  const c1 = hexOr(d.brand.color, "#126BBC");
  const deep = mix(c1, "#050a14", 0.8);
  const ratio = c.w / c.h;
  const W = ratio >= 1 ? 1200 : Math.round(1200 * ratio);
  const H = ratio >= 1 ? Math.round(1200 / ratio) : 1200;
  const u = Math.min(W, H) / 1080;
  const box = c.mode === "fondo" && c.photo !== "completa" && c.photo !== "ninguna" ? PHOTO_BOXES[c.photo] : null;
  const px = (b: Box) => ({ left: Math.round(b.x * W), top: Math.round(b.y * H), width: Math.round(b.w * W), height: Math.round(b.h * H) });
  const pb = box ? px(box) : { left: 0, top: 0, width: W, height: H };
  const [art, photo] = await Promise.all([
    loadImage(c.imageUrl, 1600),
    c.photo !== "ninguna" && d.photoUrl ? coverPhoto(d.photoUrl, pb.left, pb.top, pb.width, pb.height, d.focus) : Promise.resolve(null),
  ]);
  if (c.photo !== "ninguna" && !photo) throw new Error(`La plantilla "${d.template.name}" necesita una foto.`);
  const headline = d.headline.trim().replace(/\s+/g, " ").slice(0, 180);
  const color = c.ink === "claro" ? "#ffffff" : c.ink === "oscuro" ? "#111827" : c1;
  const tb = textBox(c);
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  const Pic = ({ src, b, radius = 0, fit = "cover" }: { src: string; b: { left: number; top: number; width: number; height: number }; radius?: number; fit?: "cover" | "fill" }) => <img src={src} width={b.width} height={b.height} style={{ position: "absolute", ...b, objectFit: fit, borderRadius: radius }} />;
  const full = { left: 0, top: 0, width: W, height: H };
  const tr = tb ? px(tb) : null;
  // El titular cabe siempre en su caja (antes podía salirse por abajo).
  const fit = tr ? fitText({ text: headline, maxW: tr.width, maxH: tr.height, max: Math.round(92 * u), min: Math.round(34 * u), maxLines: 4, lineHeight: F.headLH, measure: F.measureHead }) : null;
  // Letras claras sobre la foto: degradado debajo, calculado con la foto, para que se lean (contraste 4.5).
  let shade: React.ReactNode = null;
  if (photo && tr && fit && c.ink === "claro" && (!box || c.mode === "marco")) {
    const textTop = tb!.y < 0.2 ? tr.top : tb!.y > 0.5 ? tr.top + tr.height - fit.height : tr.top + (tr.height - fit.height) / 2;
    const a = scrimAlpha(grayOf(photoLum(photo, { x: tr.left, y: textTop, w: tr.width, h: fit.height }, 0.94)), deep, 4.6, 0.25);
    const feather = H * 0.2;
    const y0 = Math.max(0, textTop - feather);
    const y1 = Math.min(H, textTop + fit.height + feather);
    const p0 = (((textTop - y0) / (y1 - y0)) * 100).toFixed(1);
    const p1 = (((textTop + fit.height - y0) / (y1 - y0)) * 100).toFixed(1);
    shade = <div style={{ position: "absolute", display: "flex", left: 0, width: W, top: y0, height: y1 - y0, backgroundImage: `linear-gradient(to bottom, ${rgba(deep, 0)} 0%, ${rgba(deep, a)} ${p0}%, ${rgba(deep, a)} ${p1}%, ${rgba(deep, 0)} 100%)` }} />;
  }
  const img = new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", position: "relative", background: "#ffffff", fontFamily: F.head }}>
        {c.mode === "fondo" && <Pic src={art.uri} b={full} fit="fill" />}
        {photo && <Pic src={photo.uri} b={pb} radius={box ? Math.round(24 * u) : 0} />}
        {shade}
        {c.mode === "marco" && <Pic src={art.uri} b={full} fit="fill" />}
        {tr && fit && fit.lines.length > 0 && (
          <div style={{ position: "absolute", display: "flex", ...tr, alignItems: tb!.y < 0.2 ? "flex-start" : tb!.y > 0.5 ? "flex-end" : "center" }}>
            <div style={{ display: "flex", flexDirection: "column", width: tr.width, fontSize: fit.size, fontWeight: F.bold, lineHeight: F.headLH, color, letterSpacing: fit.size * headTracking(false), textShadow: c.ink === "claro" ? "0 2px 14px rgba(0,0,0,0.35)" : "none" }}>
              {fit.lines.map((l, i) => (
                <div key={i} style={{ display: "flex", whiteSpace: "pre" }}>{l}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    ),
    { width: W, height: H, fonts: F.fonts },
  );
  const png = Buffer.from(await img.arrayBuffer());
  return fitToShape(png, target.w, target.h);
}

/**
 * Lleva una imagen terminada (con texto) a otra forma SIN cortar nada: si la forma es casi igual, la
 * ajusta; si no, la centra sobre una copia desenfocada y oscurecida de sí misma.
 */
export async function fitToShape(input: Buffer, w: number, h: number): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const ratio = (meta.width ?? w) / (meta.height ?? h);
  const want = w / h;
  if (Math.abs(ratio - want) / want < 0.04) return sharp(input).resize(w, h, { fit: "cover" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  const back = await sharp(input).resize(w, h, { fit: "cover" }).blur(38).modulate({ brightness: 0.72 }).toBuffer();
  const front = await sharp(input).resize(w, h, { fit: "inside" }).toBuffer();
  return sharp(back).composite([{ input: front, gravity: "center" }]).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/** Foto de ejemplo para las vistas previas cuando el negocio todavía no tiene fotos. */
export async function samplePhoto(color: string): Promise<string> {
  const c = hexOr(color, "#126BBC");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe0f3"/><stop offset="1" stop-color="${c}"/></linearGradient></defs><rect width="1080" height="1080" fill="url(#g)"/><circle cx="780" cy="300" r="160" fill="#ffffff" opacity="0.35"/><path d="M0 820 L300 560 L520 760 L760 520 L1080 840 L1080 1080 L0 1080 Z" fill="#ffffff" opacity="0.25"/></svg>`;
  const jpg = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString("base64")}`;
}
