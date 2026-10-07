"use client";

// La lectura del manual para sacar imágenes, en el navegador: abre el PDF (o la imagen), arma las páginas y las manda
// al servidor de a 3. Vive fuera de los componentes para que la puedan empezar el formulario de marca (al subir el
// manual) y la sección "Imágenes de tu manual", y las dos vean el mismo avance.
import { useSyncExternalStore } from "react";
import { readBookPages } from "@/app/actions-brand-book";
import type { KnownCrop } from "@/lib/brand-book-extract";
import type { T } from "@/lib/i18n";
import { bookPageImages, type PageImage, splitBatches } from "@/lib/pdf-pages";

export type BookRunState = {
  status: "idle" | "opening" | "reading" | "done" | "error";
  businessId: string;
  /** Páginas preparadas / leídas por la IA, y cuántas en total. */
  prepared: number;
  read: number;
  total: number;
  /** Páginas del grupo que se está leyendo. */
  from: number;
  to: number;
  /** Páginas que tiene el PDF (pueden ser más de 40). */
  totalInFile: number;
  added: number;
  failedPages: number[];
  full: boolean;
  /** Error ya en palabras simples (español e inglés). */
  error?: { es: string; en: string };
  /** Se puede seguir desde donde se quedó (las páginas siguen en memoria). */
  canResume: boolean;
};

const IDLE: BookRunState = { status: "idle", businessId: "", prepared: 0, read: 0, total: 0, from: 0, to: 0, totalInFile: 0, added: 0, failedPages: [], full: false, canResume: false };

let state: BookRunState = IDLE;
const listeners = new Set<() => void>();
const set = (patch: Partial<BookRunState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

/** Lo que hace falta para seguir si se cortó. */
let job: { token: { cancelled: boolean }; batches: PageImage[][]; next: number; known: KnownCrop[]; first: boolean } | null = null;

/** Si el servidor tiene la clave de Gemini (lo avisa la sección al aparecer): sin ella no se empieza solo. */
let enabled = false;
export const setBookRunEnabled = (v: boolean) => {
  enabled = v;
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useBookRun = () => useSyncExternalStore(subscribe, () => state, () => IDLE);
export const bookRunBusy = () => state.status === "opening" || state.status === "reading";

const FILE_ERRORS = {
  type: { es: "Usa un PDF o una imagen (PNG, JPG o WEBP).", en: "Use a PDF or an image (PNG, JPG, or WEBP)." },
  password: { es: "El PDF tiene contraseña. Guárdalo sin contraseña e intenta de nuevo.", en: "The PDF has a password. Save it without a password and try again." },
  broken: { es: "No pudimos abrir el archivo. Prueba con otro PDF o con una imagen PNG o JPG.", en: "We couldn't open the file. Try another PDF or a PNG or JPG image." },
  empty: { es: "El archivo está vacío.", en: "The file is empty." },
  download: { es: "No pudimos bajar tu manual guardado. Elige el archivo desde tu computadora o teléfono.", en: "We couldn't download your saved brand book. Pick the file from your computer or phone." },
};

/**
 * Empieza a sacar imágenes del manual: un archivo elegido o la dirección del manual guardado.
 * `auto`: lo empezó el formulario al subir el manual (solo si hay clave de Gemini).
 */
export async function startBookRun(businessId: string, source: Blob | string, opts: { auto?: boolean } = {}): Promise<void> {
  if (opts.auto && !enabled) return;
  if (job) job.token.cancelled = true;
  const token = { cancelled: false };
  job = null;
  state = { ...IDLE, businessId, status: "opening" };
  set({});
  let file: Blob;
  try {
    if (typeof source === "string") {
      const res = await fetch(source);
      if (!res.ok) throw new Error(String(res.status));
      file = await res.blob();
    } else file = source;
  } catch {
    if (!token.cancelled) set({ status: "error", error: FILE_ERRORS.download });
    return;
  }
  let pages: PageImage[];
  try {
    const r = await bookPageImages(file, { signal: token, onPage: (prepared, total) => !token.cancelled && set({ prepared, total }) });
    pages = r.pages;
    if (!token.cancelled) set({ totalInFile: r.totalPages, total: r.pages.length });
  } catch (e) {
    const code = (e as { code?: keyof typeof FILE_ERRORS }).code;
    if (!token.cancelled) set({ status: "error", error: FILE_ERRORS[code && code in FILE_ERRORS ? code : "broken"] });
    return;
  }
  if (token.cancelled) return;
  job = { token, batches: splitBatches(pages), next: 0, known: [], first: true };
  await run();
}

/** Sigue desde el grupo de páginas que falló. */
export async function resumeBookRun(): Promise<void> {
  if (!job || bookRunBusy()) return;
  await run();
}

async function run() {
  const j = job;
  if (!j) return;
  const total = state.total;
  set({ status: "reading", error: undefined, canResume: false });
  while (j.next < j.batches.length) {
    if (j.token.cancelled) return;
    const batch = j.batches[j.next];
    set({ from: batch[0].page, to: batch[batch.length - 1].page });
    const fd = new FormData();
    fd.set("total", String(total));
    fd.set("first", j.first ? "1" : "0");
    fd.set("known", JSON.stringify(j.known));
    for (const p of batch) {
      fd.append("page", String(p.page));
      fd.append("img", new File([p.blob], `pagina-${p.page}.jpg`, { type: "image/jpeg" }));
    }
    let r: Awaited<ReturnType<typeof readBookPages>>;
    try {
      r = await readBookPages(state.businessId, fd);
    } catch {
      r = { ok: false, message: "" };
    }
    if (j.token.cancelled) return;
    if (!r.ok) {
      const msg = r.message
        ? { es: r.message, en: r.message }
        : { es: "Se cortó la conexión mientras la IA leía tu manual.", en: "The connection dropped while the AI was reading your brand book." };
      set({ status: "error", error: msg, canResume: true });
      return;
    }
    j.first = false;
    j.known = [...j.known, ...r.known];
    j.next += 1;
    set({ read: state.read + batch.length, added: state.added + r.added, failedPages: [...state.failedPages, ...r.failedPages], full: state.full || r.full });
  }
  job = null;
  set({ status: "done" });
}

/** Cierra el aviso de "listo" o de error. */
export function clearBookRun() {
  if (bookRunBusy()) return;
  job = null;
  set({ ...IDLE });
}

/** El texto del avance en palabras simples. */
export function bookRunText(s: BookRunState, t: T): string {
  if (s.status === "opening") {
    return s.total > 1 ? t(`Abriendo tu manual: página ${s.prepared} de ${s.total}…`, `Opening your brand book: page ${s.prepared} of ${s.total}…`) : t("Abriendo tu manual…", "Opening your brand book…");
  }
  if (s.status === "reading") {
    if (s.total <= 1) return t("La IA está mirando tu manual…", "The AI is looking at your brand book…");
    return s.from === s.to
      ? t(`Leyendo la página ${s.from} de ${s.total}…`, `Reading page ${s.from} of ${s.total}…`)
      : t(`Leyendo las páginas ${s.from} a ${s.to} de ${s.total}…`, `Reading pages ${s.from} to ${s.to} of ${s.total}…`);
  }
  if (s.status === "done") {
    const n = s.added;
    let msg = n
      ? t(`Listo: encontramos ${n} ${n === 1 ? "imagen" : "imágenes"} en tu manual. Revísalas aquí abajo.`, `Done: we found ${n} ${n === 1 ? "image" : "images"} in your brand book. Review them below.`)
      : t("Terminamos de leer tu manual, pero no encontramos logos ni imágenes nuevas para sacar.", "We finished reading your brand book, but found no new logos or images to pull out.");
    if (s.totalInFile > s.total) msg += " " + t(`Leímos las primeras ${s.total} páginas de ${s.totalInFile}.`, `We read the first ${s.total} of ${s.totalInFile} pages.`);
    if (s.failedPages.length) msg += " " + t(`No pudimos leer ${s.failedPages.length === 1 ? "la página" : "las páginas"} ${s.failedPages.join(", ")}.`, `We couldn't read page${s.failedPages.length === 1 ? "" : "s"} ${s.failedPages.join(", ")}.`);
    if (s.full) msg += " " + t("Hay un máximo de 30 por manual: te mostramos las más claras.", "There's a maximum of 30 per brand book: we show you the clearest ones.");
    return msg;
  }
  return "";
}
