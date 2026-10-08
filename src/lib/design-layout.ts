// Las cuentas del diseñador (sin JSX ni archivos, para poder probarlas solas): márgenes y zonas seguras de
// cada red, cómo partir el titular en líneas parejas, qué tamaño de letra cabe, qué color de letra se lee
// sobre cada fondo y cuánto oscurecer una foto para que el texto se lea siempre (contraste WCAG).
import { contrast, luminance, mix } from "@/lib/design-shapes";

/** Ancho en px de `text` a `size` px. */
export type Measure = (text: string, size: number) => number;

// ---------- Márgenes y zonas seguras ----------

export type Insets = { top: number; right: number; bottom: number; left: number };

/** Unidad del diseño: 1 en una imagen de 1080 px de lado corto. */
export const unitOf = (w: number, h: number) => Math.min(w, h) / 1080;

/** Margen de la cuadrícula: el mismo aire en los cuatro lados (7.4% del lado corto, 80 px en 1080). */
export const gridMargin = (w: number, h: number) => Math.round(Math.min(w, h) * 0.074);

/** Es una historia/reel (9:16): Instagram, Facebook y TikTok tapan arriba (nombre, barra) y abajo (responder, botones). */
export const isStory = (w: number, h: number) => h / w > 1.6;

/** Partes de la historia que tapan los botones de la red: arriba ~14% y abajo ~20%. */
export const STORY_SAFE = { top: 0.14, bottom: 0.2 } as const;

/**
 * Zona donde puede ir el texto y el logo. En historias se deja libre lo que tapan los botones de Instagram,
 * Facebook y TikTok; en las demás formas, el margen de la cuadrícula.
 */
export function safeArea(w: number, h: number): Insets {
  const m = gridMargin(w, h);
  if (!isStory(w, h)) return { top: m, right: m, bottom: m, left: m };
  return { top: Math.max(m, Math.round(h * STORY_SAFE.top)), right: m, bottom: Math.max(m, Math.round(h * STORY_SAFE.bottom)), left: m };
}

// ---------- Partir el texto en líneas ----------

/** Palabras cortas que no deben quedar solas al final de una línea (se pegan a la siguiente). */
const STICKY = new Set(
  "a al con de del el en la las lo los mi por que se su sus te tu un una y o e u para sin the an of to in on for and or your our my at by is it we".split(" "),
);

/** Separa el texto en "piezas" que no se cortan: las palabras cortas van unidas a la siguiente. */
export function tokens(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let carry = "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const bare = w.toLowerCase().replace(/[¿¡"“«(]/g, "");
    if (i < words.length - 1 && (STICKY.has(bare) || bare.length <= 1)) {
      carry = carry ? `${carry} ${w}` : w;
      continue;
    }
    out.push(carry ? `${carry} ${w}` : w);
    carry = "";
  }
  if (carry) out.push(carry);
  return out;
}

/** Reparte las piezas en líneas de como mucho `maxW` (la primera que no cabe pasa a la siguiente línea). */
export function wrap(pieces: string[], maxW: number, size: number, measure: Measure): string[] {
  const lines: string[] = [];
  let cur = "";
  // Una pieza unida que no cabe sola en la línea se vuelve a separar en palabras.
  const list = pieces.flatMap((p) => (p.includes(" ") && measure(p, size) > maxW ? p.split(" ") : [p]));
  for (const p of list) {
    const next = cur ? `${cur} ${p}` : p;
    if (cur && measure(next, size) > maxW) {
      lines.push(cur);
      cur = p;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Líneas parejas: entre los anchos que dan el mismo número de líneas, elige el reparto más parejo (sin una
 * línea muy corta, ni una palabra sola al final). Nunca pasa de `maxW`.
 */
export function balance(text: string, maxW: number, size: number, measure: Measure): string[] {
  const pieces = tokens(text);
  const first = wrap(pieces, maxW, size, measure);
  if (first.length < 2) return first;
  // El ancho más angosto con el mismo número de líneas.
  let lo = maxW * 0.3;
  let hi = maxW;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (wrap(pieces, mid, size, measure).length <= first.length) hi = mid;
    else lo = mid;
  }
  // Entre ese ancho y el máximo, el reparto con menos diferencia entre líneas.
  const score = (lines: string[]) => {
    const ws = lines.map((l) => measure(l, size));
    const top = Math.max(...ws);
    const body = ws.slice(0, -1).reduce((a, x) => a + (top - x) ** 2, 0);
    const last = ws[ws.length - 1];
    // La última línea puede ser algo más corta, pero no una palabra suelta.
    return body + (last < top * 0.45 ? (top - last) ** 2 * 2 : 0);
  };
  let best = first;
  let bestScore = score(first);
  for (let i = 0; i <= 16; i++) {
    const wdt = hi + ((maxW - hi) * i) / 16;
    const lines = wrap(pieces, wdt, size, measure);
    if (lines.length !== first.length || lines.some((l) => measure(l, size) > maxW)) continue;
    const sc = score(lines);
    if (sc < bestScore - 0.5) {
      best = lines;
      bestScore = sc;
    }
  }
  return best;
}

export type Fitted = { size: number; lines: string[]; width: number; height: number; truncated: boolean };

/**
 * El tamaño de letra más grande (entre `min` y `max`) con el que el texto cabe en `maxW` × `maxH` en como
 * mucho `maxLines` líneas parejas. Si ni con la letra más chica cabe, se corta en una palabra entera con «…».
 */
export function fitText(o: { text: string; maxW: number; maxH: number; max: number; min: number; maxLines: number; lineHeight: number; measure: Measure; hardLines?: number }): Fitted {
  const text = o.text.trim().replace(/\s+/g, " ");
  const tryAt = (size: number, t: string, maxLines = o.maxLines): Fitted | null => {
    const lines = balance(t, o.maxW, size, o.measure);
    const height = lines.length * size * o.lineHeight;
    const width = Math.max(0, ...lines.map((l) => o.measure(l, size)));
    if (lines.length > maxLines || height > o.maxH || width > o.maxW) return null;
    return { size, lines, width, height, truncated: t !== text };
  };
  if (!text) return { size: o.min, lines: [], width: 0, height: 0, truncated: false };
  const step = Math.max(1, Math.round(o.max / 60));
  // Primero con las líneas preferidas; si no cabe ni con la letra más chica, se permiten más líneas
  // (en columnas angostas) antes de cortar el texto.
  for (const lim of [o.maxLines, Math.max(o.maxLines, o.hardLines ?? o.maxLines)]) {
    for (let s = Math.floor(o.max); s >= o.min; s -= step) {
      const f = tryAt(s, text, lim);
      if (f) return f;
    }
    if (lim === (o.hardLines ?? o.maxLines)) break;
  }
  // No cabe ni con la letra más chica: se quitan palabras del final.
  const words = text.split(" ");
  for (let n = words.length - 1; n >= 1; n--) {
    const t = words.slice(0, n).join(" ").replace(/[,;:.\-–—·]+$/, "") + "…";
    const f = tryAt(o.min, t, Math.max(o.maxLines, o.hardLines ?? 0));
    if (f) return f;
  }
  // Una sola palabra enorme: se deja en la letra más chica (no debería pasar con titulares reales).
  const lines = [text];
  return { size: o.min, lines, width: Math.min(o.maxW, o.measure(text, o.min)), height: o.min * o.lineHeight, truncated: false };
}

// ---------- Colores que se leen ----------

/** Casi negro con un toque del color de la marca (para textos sobre fondos claros). */
export const inkDark = (brand: string) => mix("#0f172a", brand, 0.12);

/** Color de letra que se lee sobre `bg`: blanco o casi negro, el que dé más contraste. */
export function pickInk(bg: string, dark = "#0f172a"): string {
  return contrast(bg, "#ffffff") >= contrast(bg, dark) ? "#ffffff" : dark;
}

/** El primer color de la lista que se distingue del fondo (3:1 para detalles gráficos, WCAG 1.4.11); si ninguno, `fallback`. */
export function accentOn(bg: string, candidates: string[], fallback: string, min = 3): string {
  return candidates.find((c) => c && contrast(c, bg) >= min) ?? fallback;
}

/**
 * Los dos colores del degradado. El segundo color de la marca solo se usa si combina (luz parecida); si no,
 * el degradado va del color principal a un tono más oscuro (o más claro) de sí mismo, que nunca queda feo.
 */
export function gradientPair(c1: string, c2?: string): [string, string] {
  const shade = luminance(c1) > 0.5 ? mix(c1, "#ffffff", 0.35) : mix(c1, "#000000", 0.3);
  if (!c2 || c2.toLowerCase() === c1.toLowerCase()) return [c1, shade];
  return contrast(c1, c2) <= 1.6 ? [c1, c2] : [c1, shade];
}

/** Un color de letra que se lea sobre los dos extremos del degradado (o sobre un color liso). */
export function inkForAll(bgs: string[], dark = "#0f172a"): string {
  const worst = (ink: string) => Math.min(...bgs.map((b) => contrast(ink, b)));
  return worst("#ffffff") >= worst(dark) ? "#ffffff" : dark;
}

/** Luminancia relativa de un color mezclado: `a` sobre fondo de luminancia `under`. */
function blendLum(underHex: string, overHex: string, alpha: number) {
  return luminance(mix(underHex, overHex, alpha));
}

/**
 * Cuánto oscurecer la foto (0-1) con `scrim` para que el texto blanco tenga contraste `target` aun sobre la
 * parte más clara de la foto (`brightest`, un color hex). `floor` es lo mínimo que pide la plantilla.
 */
export function scrimAlpha(brightest: string, scrim: string, target = 4.5, floor = 0): number {
  const ok = (a: number) => (1.05 / (blendLum(brightest, scrim, a) + 0.05)) >= target;
  if (ok(floor)) return floor;
  let lo = floor;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return Math.min(1, Math.ceil(hi * 100) / 100);
}

/** El color hex de una luminancia gris (para pasar la parte más clara de una foto a scrimAlpha). */
export function grayOf(lum: number): string {
  const s = lum <= 0.0031308 ? lum * 12.92 : 1.055 * lum ** (1 / 2.4) - 0.055;
  const v = Math.max(0, Math.min(255, Math.round(s * 255)));
  const h = v.toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
}

// ---------- Textos de la marca ----------

/** ¿El texto está en español? (para elegir el eslogan en el idioma del post). */
export function guessLang(text: string): "es" | "en" {
  const t = ` ${text.toLowerCase()} `;
  if (/[ñ¿¡áéíóú]/.test(t)) return "es";
  const es = (t.match(/ (el|la|los|las|de|del|que|y|en|tu|para|con|por|una?|su|es|más|nuestro|nuestra) /g) ?? []).length;
  const en = (t.match(/ (the|and|of|to|your|our|for|with|is|are|you|we|a|in|on) /g) ?? []).length;
  return en > es ? "en" : "es";
}

/**
 * El eslogan de la marca, leído con cuidado de Business.brandIdentity (JSON que guarda la sección Marca):
 * `slogan` puede ser texto o { es, en }. Devuelve "" si no hay.
 */
export function sloganFrom(identity: unknown, lang: "es" | "en"): string {
  if (!identity || typeof identity !== "object") return "";
  const s = (identity as { slogan?: unknown }).slogan;
  if (typeof s === "string") return s.trim().slice(0, 80);
  if (s && typeof s === "object") {
    const o = s as Record<string, unknown>;
    const pick = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
    return (pick(lang) || pick(lang === "es" ? "en" : "es")).slice(0, 80);
  }
  return "";
}

/** Dirección web corta para mostrar en el diseño: sin https://, sin www. y sin la ruta. */
export const shortHost = (url = "") => url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/[/?#].*$/, "").toLowerCase();
