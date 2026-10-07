// Sacar imágenes del manual de marca: la IA (Gemini) mira cada página y dice dónde hay un logo, el símbolo, un
// patrón, íconos, fotos o ejemplos de piezas; aquí se recortan, se les quita el fondo a los logos y se descartan las
// repetidas. Lo que no necesita sharp ni la IA (leer la respuesta, la cuenta del recorte, el "parecido" entre
// imágenes) son funciones puras para poder probarlas.
import sharp from "sharp";
import { z } from "zod";
import { askGemini } from "@/lib/ai";
import type { BrandAssetKind } from "@/lib/brand-assets";
import { transparentLogo } from "@/lib/brand-image";

/** Lo que la IA puede proponer desde el manual (todo menos "kit", que lo crea la app). */
export const BOOK_KINDS = ["logo", "logo-light", "logo-dark", "isotype", "pattern", "template", "photo", "icon"] as const satisfies readonly BrandAssetKind[];
export type BookKind = (typeof BOOK_KINDS)[number];

/** Se leen como mucho 40 páginas por manual y se proponen como mucho 30 imágenes. */
export const MAX_BOOK_PAGES = 40;
export const MAX_BOOK_PROPOSALS = 30;
/** Por página, las más seguras primero. */
export const MAX_ITEMS_PER_PAGE = 8;
/** Lado largo mínimo del recorte (px): lo más chico no sirve para diseñar. */
export const MIN_CROP_PX = 120;
/** Lado corto mínimo (los logos horizontales son finos, pero no una raya). */
export const MIN_CROP_SHORT_PX = 32;
/** Lo que acepta el servidor en cada envío (Vercel corta en 4.5 MB por petición). */
export const MAX_PAGE_BYTES = 3.5 * 1024 * 1024;
export const MAX_BATCH_BYTES = 4.2 * 1024 * 1024;
export const MAX_BATCH_PAGES = 4;
export const PAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

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
          "logo = full logo (symbol + name) shown on a light background; logo-light = white or light version shown on a dark background; logo-dark = black or single dark color version; isotype = the symbol/icon mark alone, without the name; pattern = brand pattern, texture or background graphic; icon = one of the brand's icons or pictograms; photo = brand photograph (team, place, product, mood); template = an example application of the brand (social media post, business card, letterhead, envelope, signage, vehicle, uniform, packaging, website)",
        ),
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
    out.push({ kind: p.data.kind, box, label: text(p.data.label, 48) ?? DEFAULT_LABEL[p.data.kind], note: text(p.data.note, 160), confidence });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, MAX_ITEMS_PER_PAGE);
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
  const p = Math.round(Math.max(w, h) * pad) + 2;
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
  const rect = cropRect(item.box, meta.width, meta.height);
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
- template: an example application of the brand: a social media post, business card, letterhead, envelope, signage, vehicle wrap, uniform, packaging, website screen. Box the whole piece.

SKIP (never return):
- "Incorrect use" / "don't do this" examples: logos that are crossed out, marked with an X or a red sign, stretched, distorted, rotated, recolored wrongly, with effects or shadows, or on a wrong background. Brand books always have a page of these: return nothing from that page.
- Construction, clear-space, minimum-size or measurement diagrams (logos with guide lines, grids, arrows, dimensions or "x" units around them).
- Color swatches and palettes, typography specimens (alphabets, font names), paragraphs of text, tables, page numbers, headers and footers.
- Tiny items (smaller than about 4% of the page), and pages that only have text.
- The same logo drawn in a very small size next to a big one: return only the biggest clean one.

Boxes: box_2d is [ymin, xmin, ymax, xmax] normalized to 0-1000 over the whole page image. Make it tight around the item, including all of it (the whole logo with its name, the whole business card), but no surrounding captions.
Labels and notes: short, plain words for a small business owner, in Spanish (correct accents) and English.
If the page has nothing usable, return an empty list. Be strict: it is better to return nothing than a wrong or "incorrect use" example.`;

/** Pide a Gemini lo que hay en una página del manual. */
export async function findOnPage(image: Buffer, mimeType: string, page: number, total: number, businessName: string): Promise<BookItem[]> {
  const reply = await askGemini(
    BookReplySchema,
    BOOK_SYSTEM,
    `This is page ${page} of ${total} of the brand book of "${businessName}". List the reusable brand assets on this page.`,
    4000,
    [{ inlineData: { mimeType, data: image.toString("base64") } }],
  );
  return parseBookReply(reply);
}
