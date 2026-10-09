// Sacar imágenes del manual de marca: la IA (Gemini) mira cada página y dice dónde hay un logo, el símbolo, un
// patrón, íconos, fotos o ejemplos de piezas; aquí se recortan, se les quita el fondo a los logos y se descartan las
// repetidas. Lo que no necesita sharp ni la IA (leer la respuesta, la cuenta del recorte, el "parecido" entre
// imágenes) son funciones puras para poder probarlas.
import sharp from "sharp";
import { z } from "zod";
import { askGemini } from "@/lib/ai";
import type { BrandAssetKind } from "@/lib/brand-assets";
import { transparentLogo } from "@/lib/brand-image";
import { isSocialPiece, type Piece, PIECES, pieceOfRatio } from "@/lib/design-ai-pieces";

/** Lo que la IA puede proponer desde el manual (todo menos "kit", que lo crea la app). */
export const BOOK_KINDS = ["logo", "logo-light", "logo-dark", "isotype", "pattern", "template", "photo", "icon"] as const satisfies readonly BrandAssetKind[];
export type BookKind = (typeof BOOK_KINDS)[number];

/** Se leen como mucho 60 páginas por manual y se proponen como mucho 40 imágenes. */
export const MAX_BOOK_PAGES = 60;
export const MAX_BOOK_PROPOSALS = 40;
/** Por página, las más importantes primero (una página de plantillas puede traer 12 posts). */
export const MAX_ITEMS_PER_PAGE = 16;

/** Lado largo mínimo del recorte (px): lo más chico no sirve para diseñar. */
export const MIN_CROP_PX = 120;
/** Lado corto mínimo (los logos horizontales son finos, pero no una raya). */
export const MIN_CROP_SHORT_PX = 32;
/** Lo que acepta el servidor en cada envío (Vercel corta en 4.5 MB por petición). */
export const MAX_PAGE_BYTES = 3.5 * 1024 * 1024;
export const MAX_BATCH_BYTES = 4.2 * 1024 * 1024;
export const MAX_BATCH_PAGES = 4;
export const PAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Qué pieza es cada ejemplo (post, historia, tarjeta…): en design-ai-pieces.ts, sin servidor, para usarlo también en pantalla.
export { isSocialAsset, isSocialPiece, type Piece, PIECES, pieceOfRatio, SOCIAL_PIECES } from "@/lib/design-ai-pieces";

/** Los que se guardan con fondo transparente. */
const LOGO_KINDS = new Set<BookKind>(["logo", "logo-light", "logo-dark", "isotype", "icon"]);
export const isLogoKind = (k: BrandAssetKind) => LOGO_KINDS.has(k as BookKind);

const Text = z.object({ es: z.string(), en: z.string() });

/** Lo que se le pide a Gemini (los tipos son flojos a propósito: la limpieza de verdad la hace parseBookReply). */
export const BookReplySchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(BOOK_KINDS).describe(
          "logo = full logo (symbol + name) shown on a light background; logo-light = white or light version shown on a dark background; logo-dark = black or single dark color version; isotype = the symbol/icon mark alone, without the name; pattern = brand pattern, texture or background graphic; icon = one of the brand's icons or pictograms; photo = brand photograph (team, place, product, mood); template = an example application of the brand (social media post, story, ad or cover; business card, letterhead, envelope, signage, vehicle, uniform, packaging, website)",
        ),
        piece: z
          .enum(PIECES)
          .describe(
            "Only for kind template (use other for every other kind): social-post = a finished social media post (square or vertical feed post); story = a vertical 9:16 story or reel cover; ad = a social or display ad/banner; cover = a social profile cover or link image (Facebook, LinkedIn, YouTube, Google Business); business-card; stationery = letterhead, envelope, folder, invoice; signage = signs, vehicles, uniforms, packaging; other",
          )
          .optional(),
        box_2d: z.array(z.number()).describe("[ymin, xmin, ymax, xmax] of the item on the page, normalized to 0-1000"),
        label: Text.describe("Short name, 2-4 words (e.g. es 'Logo horizontal', en 'Horizontal logo'). Spanish with correct accents."),
        note: Text.describe("One short sentence: what it is and where the book uses it (e.g. 'Versión blanca para fondos oscuros')."),
        confidence: z.number().describe("0 to 1: how sure you are that this is a usable, correct brand asset"),
      }),
    )
    .describe("Usable brand assets found on this page; an empty list if there are none"),
});
export type BookReply = z.infer<typeof BookReplySchema>;

/** Caja en fracciones de la página (0 a 1), ya ordenada y dentro de la página. */
export type Box = { x0: number; y0: number; x1: number; y1: number };

export type BookItem = {
  kind: BookKind;
  /** Solo "template": qué pieza es. */
  piece?: Piece;
  box: Box;
  label: { es: string; en: string };
  note?: { es: string; en: string };
  confidence: number;
};

const DEFAULT_LABEL: Record<BookKind, { es: string; en: string }> = {
  logo: { es: "Logo", en: "Logo" },
  "logo-light": { es: "Logo para fondos oscuros", en: "Logo for dark backgrounds" },
  "logo-dark": { es: "Logo en un color", en: "One-color logo" },
  isotype: { es: "Símbolo", en: "Symbol" },
  pattern: { es: "Patrón de la marca", en: "Brand pattern" },
  template: { es: "Ejemplo de pieza", en: "Example piece" },
  photo: { es: "Foto de la marca", en: "Brand photo" },
  icon: { es: "Ícono", en: "Icon" },
};

const ItemIn = z.object({
  kind: z.enum(BOOK_KINDS),
  piece: z.unknown().optional(),
  box_2d: z.array(z.unknown()),
  label: z.object({ es: z.unknown(), en: z.unknown() }).partial().optional(),
  note: z.object({ es: z.unknown(), en: z.unknown() }).partial().optional(),
  confidence: z.unknown().optional(),
});

const short = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function text(v: { es?: unknown; en?: unknown } | undefined, max: number): { es: string; en: string } | undefined {
  const es = short(v?.es, max);
  const en = short(v?.en, max);
  return es || en ? { es: es || en, en: en || es } : undefined;
}

/**
 * La caja de Gemini [ymin, xmin, ymax, xmax] (0–1000) en fracciones de la página. Corrige lo que a veces llega mal:
 * fuera de rango (se recorta al borde), al revés (se ordena), en fracciones 0–1 en vez de 0–1000. Devuelve null si
 * no es una caja (faltan números) o es demasiado chica para ser algo útil.
 */
export function normalizeBox(raw: unknown[]): Box | null {
  if (raw.length !== 4) return null;
  const n = raw.map((v) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN));
  if (n.some((v) => !Number.isFinite(v))) return null;
  // Si todo está entre 0 y 1 y hay decimales, la IA mandó fracciones (0.25) en vez de milésimas (250).
  const scale = n.every((v) => v >= 0 && v <= 1) && n.some((v) => !Number.isInteger(v)) ? 1 : 1000;
  const c = n.map((v) => Math.min(1, Math.max(0, v / scale)));
  const [ya, xa, yb, xb] = c;
  const box = { x0: Math.min(xa, xb), y0: Math.min(ya, yb), x1: Math.max(xa, xb), y1: Math.max(ya, yb) };
  // Menos del 1.5 % de la página en un lado: es una línea o un punto.
  if (box.x1 - box.x0 < 0.015 || box.y1 - box.y0 < 0.015) return null;
  return box;
}

/** Lee la respuesta de la IA sin confiar en ella: descarta lo que no sirve y deja como mucho 8 por página. */
export function parseBookReply(raw: unknown, minConfidence = 0.35): BookItem[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  const out: BookItem[] = [];
  for (const v of list) {
    const p = ItemIn.safeParse(v);
    if (!p.success) continue;
    const box = normalizeBox(p.data.box_2d);
    if (!box) continue;
    let confidence = typeof p.data.confidence === "number" && Number.isFinite(p.data.confidence) ? p.data.confidence : 0.5;
    if (confidence > 1 && confidence <= 100) confidence /= 100;
    confidence = Math.min(1, Math.max(0, confidence));
    if (confidence < minConfidence) continue;
    const piece = p.data.kind === "template" ? ((PIECES as readonly string[]).includes(String(p.data.piece)) ? (p.data.piece as Piece) : "other") : undefined;
    out.push({ kind: p.data.kind, ...(piece ? { piece } : {}), box, label: text(p.data.label, 48) ?? DEFAULT_LABEL[p.data.kind], note: text(p.data.note, 160), confidence });
  }
  return sortByPriority(out).slice(0, MAX_ITEMS_PER_PAGE);
}

/** Lo más útil primero: plantillas de redes sociales, después logos, después el resto (cada grupo por seguridad). */
export function itemPriority(i: { kind: string; piece?: string; confidence: number }): number {
  const group = i.kind === "template" && isSocialPiece(i.piece) ? 3 : i.kind.startsWith("logo") || i.kind === "isotype" ? 2 : i.kind === "template" ? 0.5 : 1;
  return group + i.confidence * 0.9;
}
export const sortByPriority = <T extends { kind: string; piece?: string; confidence: number }>(list: T[]): T[] => [...list].sort((a, b) => itemPriority(b) - itemPriority(a));

// ---------- Cuadrículas de posts (una página con 12 posts) ----------

/**
 * Parte una página (o una caja) que tiene una cuadrícula de piezas separadas por espacios claros: primero en filas
 * (renglones casi todos de fondo), después cada fila en columnas. De las celdas, se queda con el grupo más grande de
 * celdas del mismo tamaño (los posts); los títulos, pies e íconos chicos quedan afuera. Cajas en fracciones de la región.
 */
export function splitGrid(data: ArrayLike<number>, width: number, height: number, channels = 3): Box[] {
  const bgAt = (x: number, y: number) => {
    const i = (y * width + x) * channels;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    return Math.max(r, g, b) - Math.min(r, g, b) <= 22 && Math.min(r, g, b) >= 222;
  };
  /** Tramos de línea casi toda de fondo ("canaletas") como [inicio, fin). */
  const gapRuns = (len: number, isGutter: (k: number) => boolean): [number, number][] => {
    const out: [number, number][] = [];
    let start = -1;
    for (let k = 0; k <= len; k++) {
      const g = k < len && isGutter(k);
      if (g && start < 0) start = k;
      if (!g && start >= 0) {
        out.push([start, k]);
        start = -1;
      }
    }
    return out;
  };
  /** Los tramos con contenido entre canaletas de al menos `minGap` (las más finas no cortan) y de largo `min`. */
  const between = (len: number, gaps: [number, number][], minGap: number, min: number): [number, number][] => {
    const cuts = gaps.filter(([a, b]) => b - a >= minGap || a === 0 || b === len);
    const out: [number, number][] = [];
    let pos = 0;
    for (const [a, b] of cuts) {
      if (a - pos >= min) out.push([pos, a]);
      pos = Math.max(pos, b);
    }
    if (len - pos >= min) out.push([pos, len]);
    return out;
  };
  const rowFull = (y: number, x0 = 0, x1 = width) => {
    let c = 0;
    for (let x = x0; x < x1; x++) if (bgAt(x, y)) c++;
    return c / Math.max(1, x1 - x0) >= 0.97;
  };
  const colFullIn = (y0: number, y1: number) => (x: number) => {
    let c = 0;
    for (let y = y0; y < y1; y++) if (bgAt(x, y)) c++;
    return c / Math.max(1, y1 - y0) >= 0.97;
  };
  const minBand = Math.max(8, height * 0.08);
  const minCol = Math.max(8, width * 0.1);
  const rowGaps = gapRuns(height, (y) => rowFull(y));
  // El ancho típico de la canaleta entre columnas (en la fila más alta): una franja blanca dentro de los posts más
  // fina que eso no corta la fila (por ejemplo los pies blancos de todos los posts a la misma altura).
  const first = between(height, rowGaps, 1, minBand).sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
  let gutter = 0;
  if (first) {
    const inner = gapRuns(width, colFullIn(first[0], first[1])).filter(([a, b]) => a > 0 && b < width).map(([a, b]) => b - a).sort((a, b) => a - b);
    gutter = inner.length ? inner[Math.floor(inner.length / 2)] : 0;
  }
  const bands = between(height, rowGaps, Math.max(2, Math.round(gutter * 0.6)), minBand);
  const cells: Box[] = [];
  for (const [y0, y1] of bands) {
    const colFull = colFullIn(y0, y1);
    for (const [x0, x1] of between(width, gapRuns(width, colFull), 1, minCol)) {
      // Una pieza más baja que su fila se ajusta a su contenido (solo si sobra mucho: los pies blancos de un post se quedan).
      let a = y0;
      let b = y1;
      while (a < b - 1 && rowFull(a, x0, x1)) a++;
      while (b > a + 1 && rowFull(b - 1, x0, x1)) b--;
      if (y1 - y0 - (b - a) < (y1 - y0) * 0.15) [a, b] = [y0, y1];
      const w = x1 - x0;
      const h = b - a;
      if (h < height * 0.06 || w / h < 0.4 || w / h > 2.2) continue;
      cells.push({ x0: x0 / width, y0: a / height, x1: x1 / width, y1: b / height });
    }
  }
  // El grupo más grande de celdas del mismo tamaño (±12%).
  const size = (c: Box) => [(c.x1 - c.x0) * width, (c.y1 - c.y0) * height];
  let best: Box[] = [];
  for (const c of cells) {
    const [w, h] = size(c);
    const group = cells.filter((o) => {
      const [ow, oh] = size(o);
      return Math.abs(ow - w) / w <= 0.12 && Math.abs(oh - h) / h <= 0.12;
    });
    const area = (g: Box[]) => g.reduce((s, o) => s + size(o)[0] * size(o)[1], 0);
    if (group.length > best.length || (group.length === best.length && area(group) > area(best))) best = group;
  }
  return best.length >= 2 ? best : [];
}

/** La caja de una celda de la región, en fracciones de la página. */
const inRegion = (r: Box, c: Box): Box => ({ x0: r.x0 + c.x0 * (r.x1 - r.x0), y0: r.y0 + c.y0 * (r.y1 - r.y0), x1: r.x0 + c.x1 * (r.x1 - r.x0), y1: r.y0 + c.y1 * (r.y1 - r.y0) });
const boxIou = (a: Box, b: Box) => {
  const w = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const i = w * h;
  return i / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i);
};
const covers = (a: Box, b: Box) => a.x0 <= b.x0 + 0.01 && a.y0 <= b.y0 + 0.01 && a.x1 >= b.x1 - 0.01 && a.y1 >= b.y1 - 0.01;

/**
 * En una página de plantillas de redes (la IA encontró al menos una), las celdas de la cuadrícula reemplazan a las cajas
 * de la IA (son exactas al píxel) y se agregan las que la IA no vio. Una caja de la IA que abarca varias celdas se quita.
 */
export function mergeGridCells(items: BookItem[], cells: Box[], pageW: number, pageH: number): BookItem[] {
  const social = items.filter((i) => i.kind === "template" && isSocialPiece(i.piece));
  if (!social.length || cells.length < 2) return items;
  const rest = items.filter((i) => !social.includes(i));
  const out: BookItem[] = [];
  cells.forEach((cell, n) => {
    const match = social.find((i) => boxIou(i.box, cell) > 0.45);
    const piece = pieceOfRatio((cell.x1 - cell.x0) * pageW, (cell.y1 - cell.y0) * pageH);
    out.push(
      match
        ? { ...match, box: cell, piece: isSocialPiece(match.piece) ? match.piece : piece }
        : { kind: "template", piece, box: cell, label: { es: `Post para redes ${n + 1}`, en: `Social post ${n + 1}` }, confidence: 0.6 },
    );
  });
  // Las de la IA que no coinciden con ninguna celda y no abarcan varias (otra pieza suelta en la página).
  for (const i of social) if (!cells.some((c) => boxIou(i.box, c) > 0.45) && cells.filter((c) => covers(i.box, c)).length < 2) out.push(i);
  return sortByPriority([...out, ...rest.filter((r) => !(r.kind === "photo" && cells.some((c) => covers(c, r.box))))]);
}

/** Busca la cuadrícula de posts en la página (con sharp) y la junta con lo que encontró la IA. */
export async function withGridCells(page: Buffer, items: BookItem[]): Promise<BookItem[]> {
  if (!items.some((i) => i.kind === "template" && isSocialPiece(i.piece))) return items;
  try {
    const { data, info } = await sharp(page).removeAlpha().resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    const cells = splitGrid(data, info.width, info.height, info.channels).map((c) => inRegion({ x0: 0, y0: 0, x1: 1, y1: 1 }, c));
    return mergeGridCells(items, cells, info.width, info.height).slice(0, MAX_ITEMS_PER_PAGE);
  } catch {
    return items;
  }
}

export type CropRect = { left: number; top: number; width: number; height: number };

/**
 * La caja en píxeles para recortar, con un margen pequeño (para no comerse el borde del logo) y sin salirse de la
 * imagen. null si queda muy chica.
 */
export function cropRect(box: Box, imgW: number, imgH: number, opts: { pad?: number; minPx?: number; minShortPx?: number } = {}): CropRect | null {
  const { pad = 0.03, minPx = MIN_CROP_PX, minShortPx = MIN_CROP_SHORT_PX } = opts;
  const w = (box.x1 - box.x0) * imgW;
  const h = (box.y1 - box.y0) * imgH;
  // pad 0: justo en el borde (las piezas de redes); si no, un margen pequeño para no comerse el borde del logo.
  const p = pad ? Math.round(Math.max(w, h) * pad) + 2 : 0;
  const left = Math.max(0, Math.floor(box.x0 * imgW) - p);
  const top = Math.max(0, Math.floor(box.y0 * imgH) - p);
  const right = Math.min(imgW, Math.ceil(box.x1 * imgW) + p);
  const bottom = Math.min(imgH, Math.ceil(box.y1 * imgH) + p);
  const width = right - left;
  const height = bottom - top;
  if (Math.max(width, height) < minPx || Math.min(width, height) < minShortPx) return null;
  return { left, top, width, height };
}

// ---------- Parecido entre imágenes (para no proponer la misma dos veces) ----------

/**
 * "Huella" de 64 bits (dHash): la imagen en gris a 9×8 y, por fila, si cada punto es más claro que el siguiente.
 * Dos imágenes casi iguales (otro tamaño, otra compresión) dan huellas casi iguales.
 */
export function dHash(gray: ArrayLike<number>, w = 9, h = 8): string {
  if (gray.length < w * h) throw new Error("dHash: faltan píxeles");
  let hex = "";
  let nibble = 0;
  let bits = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      nibble = (nibble << 1) | (gray[y * w + x] > gray[y * w + x + 1] ? 1 : 0);
      if (++bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return hex;
}

/** Cuántos bits distintos tienen dos huellas (0 = iguales). */
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Una imagen ya recortada (propuesta o aceptada) para comparar. `locked`: aceptada, nunca se reemplaza. */
export type KnownCrop = { id: string; kind: string; hash: string; w: number; h: number; locked?: boolean };

/** Casi iguales: mismo tipo, forma parecida y huella casi igual. */
export function sameImage(a: KnownCrop, b: KnownCrop, maxDist = 6): boolean {
  if (a.kind !== b.kind || !a.w || !a.h || !b.w || !b.h) return false;
  const ra = a.w / a.h;
  const rb = b.w / b.h;
  if (Math.max(ra, rb) / Math.min(ra, rb) > 1.2) return false;
  return hamming(a.hash, b.hash) <= maxDist;
}

/**
 * Entre lo que ya hay (`known`) y lo nuevo (`fresh`), qué nuevas se agregan y qué propuestas viejas se quitan porque
 * llegó una copia más grande. De varias casi iguales se queda la más grande; las aceptadas nunca se tocan.
 */
export function dedupe(known: KnownCrop[], fresh: KnownCrop[], maxDist = 6): { add: string[]; remove: string[] } {
  const pool = [...known];
  const add: string[] = [];
  const remove: string[] = [];
  const area = (c: KnownCrop) => c.w * c.h;
  for (const c of [...fresh].sort((a, b) => area(b) - area(a))) {
    const i = pool.findIndex((k) => sameImage(k, c, maxDist));
    if (i < 0) {
      pool.push(c);
      add.push(c.id);
      continue;
    }
    const match = pool[i];
    if (match.locked || area(match) >= area(c)) continue;
    // La nueva es más grande: reemplaza a la que había.
    pool[i] = c;
    const j = add.indexOf(match.id);
    if (j >= 0) add.splice(j, 1);
    else remove.push(match.id);
    add.push(c.id);
  }
  return { add, remove };
}

// ---------- Con sharp ----------

/** Huella de una imagen guardada. Las transparentes se ponen sobre gris para que un logo blanco no quede "vacío". */
export async function imageHash(data: Buffer): Promise<string> {
  const gray = await sharp(data).flatten({ background: { r: 128, g: 128, b: 128 } }).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  return dHash(gray);
}

export type Crop = { data: Buffer; contentType: "image/png" | "image/jpeg"; w: number; h: number; transparent: boolean; hash: string };

/** Recorta un elemento de la página. Los logos e íconos salen con fondo transparente. null si no sirve. */
export async function cropItem(page: Buffer, item: BookItem): Promise<Crop | null> {
  const meta = await sharp(page).metadata();
  if (!meta.width || !meta.height) return null;
  // Las piezas de redes se recortan justo en su borde (sin margen de la página alrededor).
  const rect = cropRect(item.box, meta.width, meta.height, item.kind === "template" && isSocialPiece(item.piece) ? { pad: 0 } : {});
  if (!rect) return null;
  const cut = await sharp(page).extract(rect).toBuffer();
  // Un recorte de un solo color (un hueco en blanco) no es nada.
  const stats = await sharp(cut).stats();
  if (Math.max(...stats.channels.slice(0, 3).map((c) => c.stdev)) < 4) return null;
  let data: Buffer;
  let transparent = false;
  let contentType: Crop["contentType"];
  if (isLogoKind(item.kind)) {
    // Las versiones de un solo color (blanca o negra) pierden también los huecos de fondo de adentro.
    const r = await transparentLogo(cut, { holes: item.kind === "logo-light" || item.kind === "logo-dark" });
    data = r.data;
    transparent = r.transparent;
    contentType = "image/png";
  } else {
    data = await sharp(cut).flatten({ background: "#ffffff" }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    contentType = "image/jpeg";
  }
  const m = await sharp(data).metadata();
  const w = m.width ?? 0;
  const h = m.height ?? 0;
  // Después de quitar el fondo puede quedar muy chico.
  if (Math.max(w, h) < MIN_CROP_PX * 0.8 || Math.min(w, h) < 16) return null;
  return { data, contentType, w, h, transparent, hash: await imageHash(data) };
}

// ---------- La IA ----------

export const BOOK_SYSTEM = `You are a senior brand designer extracting reusable image assets from one page of a company's brand book (brand guidelines manual).
Find the assets a designer would cut out and reuse, and give each one a tight bounding box.

Return ONLY these kinds:
- logo: the full logo (symbol + name), the main version on a light background.
- logo-light: a white or light version of the logo shown on a dark or colored background.
- logo-dark: a black or single dark color version.
- isotype: the symbol / mark alone, without the name.
- pattern: a brand pattern, texture or decorative background graphic.
- icon: a brand icon or pictogram (each one separately, only if large and clear; at most 6 per page).
- photo: a brand photograph (team, place, product, mood).
- template: an example application of the brand. MOST IMPORTANT: finished SOCIAL MEDIA pieces (feed posts, stories / reel covers, ads, profile covers). They always contain sample photos, headlines, buttons and the logo: that is expected, ALWAYS return them. When a page shows a grid of several posts, return EACH post separately with its own tight box around the whole post (its outer edge, including its footer band), never one box for the whole grid. Set piece = social-post, story, ad or cover. Also (less important): business card, letterhead, envelope, signage, vehicle wrap, uniform, packaging, website screen (piece = business-card, stationery, signage or other). Box the whole piece.

SKIP (never return):
- "Incorrect use" / "don't do this" examples: logos that are crossed out, marked with an X or a red sign, stretched, distorted, rotated, recolored wrongly, with effects or shadows, or on a wrong background. Brand books always have a page of these: return nothing from that page.
- Construction, clear-space, minimum-size or measurement diagrams (logos with guide lines, grids, arrows, dimensions or "x" units around them).
- Color swatches and palettes, typography specimens (alphabets, font names), paragraphs of text, tables, page numbers, headers and footers.
- Tiny items (smaller than about 4% of the page), and pages that only have paragraphs of text with no images (a social post with text on it is NOT a text page: return it).
- Page headers and footers, small format icons or lists of sizes (e.g. "Post 1080×1080, Story 1080×1920").
- The same logo drawn in a very small size next to a big one: return only the biggest clean one.

Boxes: box_2d is [ymin, xmin, ymax, xmax] normalized to 0-1000 over the whole page image. Make it tight around the item, including all of it (the whole logo with its name, the whole business card), but no surrounding captions.
Labels and notes: short, plain words for a small business owner, in Spanish (correct accents) and English.
For every kind other than template, set piece = other.
If the page has nothing usable, return an empty list. Be strict with logos (better nothing than a wrong or "incorrect use" example), but never skip finished social media posts.`;

/** Pide a Gemini lo que hay en una página del manual. */
export async function findOnPage(image: Buffer, mimeType: string, page: number, total: number, businessName: string): Promise<BookItem[]> {
  const reply = await askGemini(
    BookReplySchema,
    BOOK_SYSTEM,
    `This is page ${page} of ${total} of the brand book of "${businessName}". List the reusable brand assets on this page.`,
    4000,
    [{ inlineData: { mimeType, data: image.toString("base64") } }],
  );
  // Una página con una cuadrícula de posts: las cajas exactas salen de los espacios entre los posts.
  return withGridCells(image, parseBookReply(reply));
}
