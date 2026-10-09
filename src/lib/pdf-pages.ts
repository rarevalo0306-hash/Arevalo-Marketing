// Convierte el manual de marca en imágenes de página EN EL NAVEGADOR (PDF con pdf.js, o una imagen tal cual), para
// mandarlas al servidor de a poco (Vercel corta en 4.5 MB por petición). pdf.js se carga solo cuando se usa.
// `splitBatches` es pura (se prueba en Node); lo demás necesita el navegador.

export const BOOK_MAX_PAGES = 60;
/** Lado largo de cada página (px) y calidad JPEG. */
export const PAGE_LONG_SIDE = 1600;
export const IMAGE_LONG_SIDE = 2000;
export const PAGE_QUALITY = 0.85;
/** Cada envío al servidor: como mucho 3 páginas y 3.4 MB. */
export const BATCH_MAX_BYTES = 3.4 * 1024 * 1024;
export const BATCH_MAX_PAGES = 3;
/** Una página no debería pasar de esto (si pasa, se comprime más). */
const PAGE_MAX_BYTES = 1.6 * 1024 * 1024;

export const BOOK_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

export type PageImage = { page: number; blob: Blob; width: number; height: number; bytes: number };

/** Agrupa en envíos que no pasen de `maxBytes` ni de `maxCount` elementos, en orden. Uno solo muy grande va solo. */
export function splitBatches<T extends { bytes: number }>(items: T[], maxBytes = BATCH_MAX_BYTES, maxCount = BATCH_MAX_PAGES): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const it of items) {
    if (cur.length && (cur.length >= maxCount || size + it.bytes > maxBytes)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(it);
    size += it.bytes;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Por qué no se pudo abrir el archivo (el que llama lo dice en palabras simples). */
export class BookFileError extends Error {
  constructor(readonly code: "type" | "password" | "broken" | "empty") {
    super(code);
  }
}

/** ¿Es un PDF? (por el tipo o por cómo empieza el archivo). */
export async function isPdf(file: Blob): Promise<boolean> {
  if (file.type === "application/pdf") return true;
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === "%PDF-";
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new BookFileError("broken"))), "image/jpeg", quality));
}

/** JPEG de la página; si queda muy pesado, con menos calidad y luego más chico. */
async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  let blob = await toJpeg(canvas, PAGE_QUALITY);
  if (blob.size > PAGE_MAX_BYTES) blob = await toJpeg(canvas, 0.7);
  while (blob.size > PAGE_MAX_BYTES && canvas.width > 600) {
    const smaller = document.createElement("canvas");
    smaller.width = Math.round(canvas.width * 0.8);
    smaller.height = Math.round(canvas.height * 0.8);
    const ctx = smaller.getContext("2d")!;
    ctx.drawImage(canvas, 0, 0, smaller.width, smaller.height);
    canvas = smaller;
    blob = await toJpeg(canvas, 0.75);
  }
  return blob;
}

const page = async (n: number, canvas: HTMLCanvasElement): Promise<PageImage> => {
  const blob = await encode(canvas);
  return { page: n, blob, width: canvas.width, height: canvas.height, bytes: blob.size };
};

/** Una imagen como una sola página (más chica si es enorme, sobre blanco). */
async function imagePage(file: Blob): Promise<PageImage> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new BookFileError("broken");
  }
  const scale = Math.min(1, IMAGE_LONG_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return page(1, canvas);
}

/**
 * Las páginas del manual como imágenes JPEG (lado largo ~1600 px), como mucho 40.
 * `onPage(hechas, total)` avisa el avance. `totalPages` son las páginas que tiene el PDF (pueden ser más de 40).
 */
export async function bookPageImages(
  file: Blob,
  opts: { maxPages?: number; onPage?: (done: number, total: number) => void; signal?: { cancelled: boolean } } = {},
): Promise<{ pages: PageImage[]; totalPages: number }> {
  const { maxPages = BOOK_MAX_PAGES, onPage, signal } = opts;
  if (!file.size) throw new BookFileError("empty");
  if (!(await isPdf(file))) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new BookFileError("type");
    onPage?.(0, 1);
    const p = await imagePage(file);
    onPage?.(1, 1);
    return { pages: [p], totalPages: 1 };
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // El "worker" de pdf.js: webpack lo copia como archivo aparte y aquí queda su dirección final.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  // Letras estándar, mapas de caracteres y decodificadores de imágenes raras (JPEG 2000): solo se bajan si el PDF los usa.
  const cdn = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}`;
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      cMapUrl: `${cdn}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${cdn}/standard_fonts/`,
      wasmUrl: `${cdn}/wasm/`,
    }).promise;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    throw new BookFileError(name === "PasswordException" ? "password" : "broken");
  }
  try {
    const total = Math.min(doc.numPages, maxPages);
    if (!total) throw new BookFileError("empty");
    const pages: PageImage[] = [];
    onPage?.(0, total);
    for (let n = 1; n <= total; n++) {
      if (signal?.cancelled) break;
      try {
        const p = await doc.getPage(n);
        const base = p.getViewport({ scale: 1 });
        const scale = Math.min(PAGE_LONG_SIDE / Math.max(base.width, base.height), 6);
        const viewport = p.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await p.render({ canvas, viewport }).promise;
        pages.push(await page(n, canvas));
        p.cleanup();
      } catch {
        // Una página dañada no frena el resto.
      }
      onPage?.(n, total);
    }
    if (!pages.length) throw new BookFileError("broken");
    return { pages, totalPages: doc.numPages };
  } finally {
    void doc.destroy();
  }
}
