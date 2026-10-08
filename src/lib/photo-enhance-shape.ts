// Fotos mejoradas por la app (columna LibraryItem.enhanceInfo): qué se le hizo a la copia mejorada, dónde está lo
// importante de la foto (para recortar bien en cada red) y qué datos privados se taparon. La foto original (`url`)
// nunca se toca. Sin servidor ni base de datos: lo usan el servidor, la página «Tus fotos» y las pruebas.

/** Sube cuando cambia la receta de la mejora (las mejoradas con una versión vieja se pueden volver a hacer). */
export const ENHANCE_VERSION = 1;

/** Una caja en coordenadas de 0 a 1 (izquierda, arriba, ancho, alto) sobre la foto mejorada. */
export type Box = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

/** Por qué se tapó una parte de la foto. */
export const BLUR_REASONS = ["plate", "address", "document", "face", "child"] as const;
export type BlurReason = (typeof BLUR_REASONS)[number];

/** Lo que se le puede hacer a la copia mejorada (nunca se inventa ni se cambia lo que muestra). */
export const STEP_KINDS = ["orient", "straighten", "crop", "light", "contrast", "whiteBalance", "color", "sharpen", "denoise", "blur"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export type EnhanceStep = {
  kind: StepKind;
  /** straighten: grados (+ = se giró a la derecha); light: cuánto más luz (+) o menos (-), en %; color/contrast/whiteBalance: % del cambio. */
  value?: number;
  /** crop: la parte de la foto que quedó; blur: la parte tapada. */
  box?: Box;
  /** crop: por qué (bordes vacíos o al enderezar). */
  why?: "border" | "straighten";
  /** blur: qué se tapó. */
  reason?: BlurReason;
};

/** Lo que la IA vio para mejorar la foto (se guarda para poder volver a mejorarla sin preguntar otra vez). */
export type EnhanceHints = {
  /** Grados para girar la foto y dejarla derecha (+ = a la derecha). null = no sabe. */
  rotate: number | null;
  /** Centro de lo importante de la foto (0–1). */
  focus: Point | null;
  /** Datos privados para tapar, en la foto sin enderezar (0–1). */
  hide: { reason: BlurReason; box: Box }[];
  /** "review" = vino en la misma revisión de la foto (sin costo extra); "enhance" = pregunta aparte. */
  from: "review" | "enhance";
  model: string;
  at: string;
};

export type EnhanceInfo = {
  v: number;
  /** Cuándo se hizo la mejorada ("" = todavía no). */
  at: string;
  steps: EnhanceStep[];
  /** Centro de lo importante en la foto mejorada (0–1), para recortar bien en cada red. */
  focus: Point;
  focusFrom: "ai" | "auto" | "center";
  /** Tamaño de la foto de la que se partió y de la mejorada. */
  original: { w: number; h: number };
  enhanced: { w: number; h: number };
  /** Miniatura de la mejorada ("" si no hay). */
  thumb: string;
  /** Si la IA ayudó: modelo y costo aproximado en dólares (0 = venía incluido en la revisión). */
  ai: { model: string; costUsd: number } | null;
  hints: EnhanceHints | null;
  /** Por qué no se pudo mejorar ("" si salió bien). */
  error: string;
};

// ---------- Leer sin confiar ----------

const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};
const str = (v: unknown, max = 400) => (typeof v === "string" ? v.slice(0, max) : "");

export function readBox(raw: unknown): Box | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const x = num(o.x, 0, 1);
  const y = num(o.y, 0, 1);
  const w = num(o.w, 0, 1);
  const h = num(o.h, 0, 1);
  if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null;
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

export function readPoint(raw: unknown): Point | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const x = num(o.x, 0, 1);
  const y = num(o.y, 0, 1);
  return x === null || y === null ? null : { x, y };
}

const isReason = (v: unknown): v is BlurReason => (BLUR_REASONS as readonly string[]).includes(String(v));

function readStep(raw: unknown): EnhanceStep | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!(STEP_KINDS as readonly string[]).includes(String(o.kind))) return null;
  const step: EnhanceStep = { kind: o.kind as StepKind };
  const value = num(o.value, -1000, 1000);
  if (value !== null) step.value = Math.round(value * 10) / 10;
  const box = readBox(o.box);
  if (box) step.box = box;
  if (o.why === "border" || o.why === "straighten") step.why = o.why;
  if (isReason(o.reason)) step.reason = o.reason;
  if (step.kind === "blur" && (!step.box || !step.reason)) return null;
  return step;
}

export function readHints(raw: unknown): EnhanceHints | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const hide = (Array.isArray(o.hide) ? o.hide : [])
    .map((h) => {
      const r = h && typeof h === "object" ? (h as Record<string, unknown>) : {};
      const box = readBox(r.box);
      return box && isReason(r.reason) ? { reason: r.reason, box } : null;
    })
    .filter((h): h is { reason: BlurReason; box: Box } => h !== null)
    .slice(0, 20);
  return {
    rotate: num(o.rotate, -45, 45),
    focus: readPoint(o.focus),
    hide,
    from: o.from === "enhance" ? "enhance" : "review",
    model: str(o.model, 80),
    at: str(o.at, 40),
  };
}

/**
 * Lo que contesta la IA sobre una foto (giro, centro y cajas en el formato de Gemini: [ymin, xmin, ymax, xmax] de 0 a
 * 1000) pasado a EnhanceHints. Acepta la respuesta de la revisión de fotos o la de la pregunta aparte. null si no hay
 * nada útil (por ejemplo, una respuesta vieja sin estos campos).
 */
export function hintsFromAnswer(raw: unknown, from: EnhanceHints["from"], model: string, at = new Date()): EnhanceHints | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const has = "straighten" in o || "focusX" in o || "hide" in o;
  if (!has) return null;
  const rot = num(o.straighten, -45, 45);
  const fx = num(o.focusX, 0, 1);
  const fy = num(o.focusY, 0, 1);
  const hide = (Array.isArray(o.hide) ? o.hide : [])
    .map((h): { reason: BlurReason; box: Box } | null => {
      const r = h && typeof h === "object" ? (h as Record<string, unknown>) : {};
      if (!isReason(r.what) || !Array.isArray(r.box) || r.box.length !== 4) return null;
      const [y0, x0, y1, x1] = r.box.map((v) => num(v, 0, 1000));
      if (y0 === null || x0 === null || y1 === null || x1 === null) return null;
      const box = readBox({ x: Math.min(x0, x1) / 1000, y: Math.min(y0, y1) / 1000, w: Math.abs(x1 - x0) / 1000, h: Math.abs(y1 - y0) / 1000 });
      // Cajas diminutas no sirven; las enormes (más de media foto) serían tapar la foto entera: se ignoran.
      return box && box.w * box.h >= 0.0002 && box.w * box.h <= 0.5 ? { reason: r.what, box } : null;
    })
    .filter((h): h is { reason: BlurReason; box: Box } => h !== null)
    .slice(0, 20);
  return {
    rotate: rot === null || Math.abs(rot) > 15 ? null : Math.round(rot * 10) / 10,
    focus: fx === null || fy === null || (fx === 0 && fy === 0) ? null : { x: fx, y: fy },
    hide,
    from,
    model: model.slice(0, 80),
    at: at.toISOString(),
  };
}

const size = (raw: unknown) => {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { w: Math.round(num(o.w, 0, 100_000) ?? 0), h: Math.round(num(o.h, 0, 100_000) ?? 0) };
};

/** Lee la columna `enhanceInfo` sin confiar en lo guardado. null si no hay nada que leer. */
export function readEnhanceInfo(raw: unknown): EnhanceInfo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const steps = (Array.isArray(o.steps) ? o.steps : []).map(readStep).filter((s): s is EnhanceStep => s !== null).slice(0, 40);
  const ai = o.ai && typeof o.ai === "object" ? (o.ai as Record<string, unknown>) : null;
  const focusFrom = o.focusFrom === "ai" || o.focusFrom === "auto" ? o.focusFrom : "center";
  return {
    v: Math.round(num(o.v, 0, 1000) ?? 0),
    at: str(o.at, 40),
    steps,
    focus: readPoint(o.focus) ?? { x: 0.5, y: 0.5 },
    focusFrom: readPoint(o.focus) ? focusFrom : "center",
    original: size(o.original),
    enhanced: size(o.enhanced),
    thumb: str(o.thumb, 1000),
    ai: ai ? { model: str(ai.model, 80), costUsd: num(ai.costUsd, 0, 100) ?? 0 } : null,
    hints: readHints(o.hints),
    error: str(o.error, 600),
  };
}

// ---------- La foto que se usa ----------

/** Lo mínimo para saber qué foto usar en una publicación. */
export type PhotoUrlInput = { url: string; enhancedUrl?: string | null; useEnhanced?: boolean | null };

/** La dirección de la foto que va en las publicaciones: la mejorada si existe y el dueño no eligió la original. */
export function libraryPhotoUrl(item: PhotoUrlInput): string {
  return item.useEnhanced !== false && item.enhancedUrl ? item.enhancedUrl : item.url;
}

/** Qué avisos de privacidad (de la revisión) tapa la mejorada. */
const FLAG_REASON: Record<string, BlurReason> = { faces: "face", address: "address", plate: "plate", document: "document", child: "child" };

/**
 * ¿La mejorada tapa algo de cada aviso de privacidad? Solo informativo: la regla para usar una foto con avisos sigue
 * siendo que el dueño la apruebe (la IA puede no haber marcado todas las placas o caras).
 */
export function coveredFlags(privacy: string[], info: EnhanceInfo | null): string[] {
  if (!info) return [];
  const blurred = new Set(info.steps.filter((s) => s.kind === "blur").map((s) => s.reason));
  return privacy.filter((f) => FLAG_REASON[f] && (blurred.has(FLAG_REASON[f]) || (f === "child" && blurred.has("face"))));
}

// ---------- En palabras ----------

const BLUR_WORD: Record<BlurReason, { es: string; en: string }> = {
  plate: { es: "Placa tapada", en: "License plate hidden" },
  address: { es: "Dirección tapada", en: "Address hidden" },
  document: { es: "Documento tapado", en: "Document hidden" },
  face: { es: "Cara tapada", en: "Face hidden" },
  child: { es: "Niño tapado", en: "Child hidden" },
};

/** Lo que se hizo, en palabras simples («Más luz», «Enderezada 2°», «Placa tapada»…). Sin repetir. */
export function stepWords(steps: EnhanceStep[], lang: "es" | "en"): string[] {
  const out: string[] = [];
  const add = (es: string, en: string) => {
    const w = lang === "en" ? en : es;
    if (!out.includes(w)) out.push(w);
  };
  for (const s of steps) {
    switch (s.kind) {
      case "orient":
        add("Girada como se tomó", "Turned the right way up");
        break;
      case "straighten": {
        const d = Math.abs(s.value ?? 0);
        const deg = d >= 10 ? Math.round(d) : Math.round(d * 10) / 10;
        add(`Enderezada ${deg}°`, `Straightened ${deg}°`);
        break;
      }
      case "crop":
        if (s.why === "border") add("Sin bordes vacíos", "Empty borders removed");
        else add("Recortada al enderezar", "Trimmed after straightening");
        break;
      case "light":
        if ((s.value ?? 0) >= 0) add("Más luz", "More light");
        else add("Menos brillo", "Less glare");
        break;
      case "contrast":
        add("Más definida", "Clearer contrast");
        break;
      case "whiteBalance":
        add("Colores más naturales", "More natural colors");
        break;
      case "color":
        add("Colores más vivos", "Livelier colors");
        break;
      case "sharpen":
        add("Más nítida", "Sharper");
        break;
      case "denoise":
        add("Menos grano", "Less grain");
        break;
      case "blur":
        if (s.reason) add(BLUR_WORD[s.reason].es, BLUR_WORD[s.reason].en);
        break;
    }
  }
  return out;
}

/** Costo en palabras: «incluido en la revisión» o «≈ US$0.001». */
export function costWords(ai: EnhanceInfo["ai"], lang: "es" | "en"): string {
  if (!ai) return lang === "en" ? "No AI used (free)" : "Sin IA (gratis)";
  if (!ai.costUsd) return lang === "en" ? "AI included in the photo review (no extra cost)" : "IA incluida en la revisión de la foto (sin costo extra)";
  return lang === "en" ? `AI ≈ US$${ai.costUsd.toFixed(4)}` : `IA ≈ US$${ai.costUsd.toFixed(4)}`;
}
