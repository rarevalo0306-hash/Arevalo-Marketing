// La copia mejorada de una foto real del negocio: solo arreglos de cámara (girar, enderezar, luz, color, nitidez,
// quitar bordes vacíos y tapar datos privados). Todo con sharp y cuentas simples: NUNCA un modelo que genere imágenes,
// así que lo que muestra la foto (el trabajo) no se inventa ni se cambia. La original no se toca: esto devuelve otra.
// Cada paso es prudente: se mide la foto antes y después y, si un cambio la empeora, se suaviza o no se hace.
// Sin base de datos (lo que guarda y pregunta a la IA está en photo-enhance-run.ts).
import sharp, { type OutputInfo, type Sharp } from "sharp";
import type { Box, EnhanceHints, EnhanceStep, Point } from "@/lib/photo-enhance-shape";

/** Lado más largo de la mejorada. */
export const MAX_SIDE = 2560;

/** Pixeles RGB sin comprimir. */
export type Raw = { data: Buffer; w: number; h: number };

const fromRaw = (r: Raw) => sharp(r.data, { raw: { width: r.w, height: r.h, channels: 3 } });

async function toRaw(img: Sharp): Promise<Raw> {
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`expected 3 channels, got ${info.channels}`);
  return { data, w: info.width, h: info.height };
}

/** Una vista chica (para medir y decidir sin gastar tiempo en la foto grande). */
export async function smallRaw(r: Raw, max = 480): Promise<Raw> {
  if (Math.max(r.w, r.h) <= max) return r;
  return toRaw(fromRaw(r).resize({ width: max, height: max, fit: "inside" }));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

// ---------- Medir ----------

export type PixelStats = {
  /** Luz promedio (0–255). */
  mean: number;
  /** Luz del 0.5 % más oscuro y del 0.5 % más claro. */
  lo: number;
  hi: number;
  /** Parte de la foto quemada a negro o a blanco (0–1). */
  clipLow: number;
  clipHigh: number;
  /** Color promedio (0 = gris, 1 = color puro). */
  sat: number;
  /** Promedio de rojo, verde y azul de lo que debería ser gris o blanco (null si casi no hay). */
  neutral: [number, number, number] | null;
  /** Promedio de rojo, verde y azul de toda la foto. */
  means: [number, number, number];
};

export function pixelStats(r: Raw): PixelStats {
  const hist = new Uint32Array(256);
  const d = r.data;
  const n = r.w * r.h;
  let sum = 0;
  let satSum = 0;
  let satN = 0;
  let clipLow = 0;
  let clipHigh = 0;
  const all = [0, 0, 0];
  const neu = [0, 0, 0];
  let neuN = 0;
  for (let i = 0; i < d.length; i += 3) {
    const R = d[i];
    const G = d[i + 1];
    const B = d[i + 2];
    const l = (R * 299 + G * 587 + B * 114) / 1000;
    hist[Math.round(l)]++;
    sum += l;
    all[0] += R;
    all[1] += G;
    all[2] += B;
    if (l <= 2) clipLow++;
    if (l >= 253) clipHigh++;
    const mx = Math.max(R, G, B);
    const mn = Math.min(R, G, B);
    if (mx > 20) {
      const s = (mx - mn) / mx;
      satSum += s;
      satN++;
      if (l > 40 && l < 235 && s < 0.35) {
        neu[0] += R;
        neu[1] += G;
        neu[2] += B;
        neuN++;
      }
    }
  }
  const pct = (p: number) => {
    const target = n * p;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };
  return {
    mean: n ? sum / n : 0,
    lo: pct(0.005),
    hi: pct(0.995),
    clipLow: n ? clipLow / n : 0,
    clipHigh: n ? clipHigh / n : 0,
    sat: satN ? satSum / satN : 0,
    neutral: neuN > n * 0.05 ? [neu[0] / neuN, neu[1] / neuN, neu[2] / neuN] : null,
    means: n ? [all[0] / n, all[1] / n, all[2] / n] : [0, 0, 0],
  };
}

// ---------- Luz y color ----------

export type TonePlan = {
  /** Ganancia de rojo, verde y azul (balance de blancos). */
  gains: [number, number, number];
  /** Niveles: (v - lo) * scale + base. */
  lo: number;
  scale: number;
  base: number;
  /** Curva de luz: < 1 aclara los medios tonos, > 1 los oscurece. */
  gamma: number;
  /** Cuánto más color (0 = nada), protegiendo los grises y lo que ya tiene mucho color. */
  vibrance: number;
};

export const IDENTITY: TonePlan = { gains: [1, 1, 1], lo: 0, scale: 1, base: 0, gamma: 1, vibrance: 0 };

/** Balance de blancos: lo que debería ser gris, que sea gris. Con límites y a medias (nunca del todo). */
export function whiteBalanceGains(s: PixelStats): [number, number, number] {
  // Con zonas grises se corrige el 75 %; sin ellas (escenas de un solo color) apenas un 35 % del promedio.
  const ref = s.neutral ?? s.means;
  const k = s.neutral ? 0.75 : 0.35;
  const avg = (ref[0] + ref[1] + ref[2]) / 3;
  if (avg < 8 || ref.some((c) => c < 4)) return [1, 1, 1];
  let g = ref.map((c) => clamp(1 + (avg / c - 1) * k, 0.8, 1.25)) as [number, number, number];
  // Sin cambiar la luz.
  const luma = 0.299 * g[0] + 0.587 * g[1] + 0.114 * g[2];
  g = g.map((x) => x / luma) as [number, number, number];
  return Math.max(...g.map((x) => Math.abs(x - 1))) < 0.03 ? [1, 1, 1] : g;
}

/** Decide luz y color mirando una vista chica de la foto. */
export function planTone(preview: Raw): TonePlan {
  const s0 = pixelStats(preview);
  const gains = whiteBalanceGains(s0);
  const s = pixelStats(applyTone(preview, { ...IDENTITY, gains }));

  // Niveles: estirar lo que hay entre el 0.5 % más oscuro y el 0.5 % más claro, como mucho ×1.35.
  let lo = s.lo;
  let scale = 1;
  let base = 0;
  const range = Math.max(1, s.hi - s.lo);
  if (range < 235) {
    scale = Math.min(1.35, 255 / range);
    // Más contraste alrededor de la luz promedio (la luz la arregla la curva de abajo), sin salirse de 0–255.
    const left = 255 - range * scale;
    base = clamp(s.mean - (s.mean - s.lo) * scale, 0, left);
  } else {
    lo = 0;
  }
  const level = (v: number) => clamp((v - lo) * scale + base, 0, 255);

  // Medios tonos: aclarar la foto oscura (poco si es muy oscura, para no subir el grano), bajar un poco la quemada.
  const m = level(s.mean);
  let gamma = 1;
  if (m < 100 && m > 3) {
    const target = m + Math.min(40, (112 - m) * 0.7);
    gamma = clamp(Math.log(target / 255) / Math.log(m / 255), s.mean < 35 ? 0.72 : 0.6, 1);
  } else if (m > 165) {
    const target = m - Math.min(22, (m - 150) * 0.5);
    gamma = clamp(Math.log(target / 255) / Math.log(m / 255), 1, 1.3);
  }

  // Color: un poco más a las fotos apagadas; nada a las que ya tienen mucho.
  const vibrance = s.sat < 0.12 ? 0 : s.sat < 0.35 ? 0.2 : s.sat < 0.5 ? 0.1 : 0;
  return { gains, lo, scale, base, gamma, vibrance };
}

/** El mismo plan, más suave (k = 0 no hace nada, 1 completo). */
export function softer(p: TonePlan, k: number): TonePlan {
  const mix = (a: number, b: number) => a + (b - a) * k;
  return {
    gains: p.gains.map((g) => mix(1, g)) as [number, number, number],
    lo: p.lo,
    scale: mix(1, p.scale),
    base: mix(p.lo, p.base),
    gamma: mix(1, p.gamma),
    vibrance: p.vibrance * k,
  };
}

function luts(p: TonePlan): [Uint8Array, Uint8Array, Uint8Array] {
  return [0, 1, 2].map((c) => {
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      let x = clamp(v * p.gains[c], 0, 255);
      x = clamp((x - p.lo) * p.scale + p.base, 0, 255);
      if (p.gamma !== 1) x = 255 * Math.pow(x / 255, p.gamma);
      lut[v] = Math.round(clamp(x, 0, 255));
    }
    return lut;
  }) as [Uint8Array, Uint8Array, Uint8Array];
}

/** Aplica el plan a los pixeles (devuelve otros; no cambia los que recibe). */
export function applyTone(r: Raw, p: TonePlan): Raw {
  const [lr, lg, lb] = luts(p);
  const src = r.data;
  const out = Buffer.allocUnsafe(src.length);
  const vib = p.vibrance;
  for (let i = 0; i < src.length; i += 3) {
    let R = lr[src[i]];
    let G = lg[src[i + 1]];
    let B = lb[src[i + 2]];
    if (vib > 0) {
      const mx = Math.max(R, G, B);
      if (mx > 0) {
        const s = (mx - Math.min(R, G, B)) / mx;
        // Más a los colores medios; casi nada a los grises (el metal sigue gris) ni a lo muy saturado.
        const k = 1 + vib * 4 * s * (1 - s);
        const l = (R * 299 + G * 587 + B * 114) / 1000;
        R = l + (R - l) * k;
        G = l + (G - l) * k;
        B = l + (B - l) * k;
      }
    }
    out[i] = R < 0 ? 0 : R > 255 ? 255 : R;
    out[i + 1] = G < 0 ? 0 : G > 255 ? 255 : G;
    out[i + 2] = B < 0 ? 0 : B > 255 ? 255 : B;
  }
  return { data: out, w: r.w, h: r.h };
}

/** ¿El cambio empeora la foto? Más quemado a blanco o negro, un salto de luz enorme o colores chillones. */
export function worse(before: PixelStats, after: PixelStats): boolean {
  return (
    after.clipHigh - before.clipHigh > 0.02 ||
    after.clipLow - before.clipLow > 0.03 ||
    Math.abs(after.mean - before.mean) > 60 ||
    (after.sat > 0.7 && after.sat > before.sat + 0.05)
  );
}

/** El plan de luz y color, ya probado en la vista chica: completo, a la mitad, o nada si igual empeora. */
export function safeTone(preview: Raw): { plan: TonePlan; before: PixelStats; after: PixelStats } {
  const before = pixelStats(preview);
  const full = planTone(preview);
  for (const k of [1, 0.5]) {
    const plan = k === 1 ? full : softer(full, k);
    const after = pixelStats(applyTone(preview, plan));
    if (!worse(before, after)) return { plan, before, after };
  }
  return { plan: IDENTITY, before, after: before };
}

// ---------- Enderezar ----------

export type Tilt = { deg: number; confidence: number };

/**
 * Cuánto está girada la foto (grados, + = girada a la derecha), mirando las líneas casi horizontales y casi
 * verticales (horizonte, marcos, puertas, paredes). `confidence` 0–1: qué tanto las líneas están de acuerdo.
 */
export function detectTilt(r: Raw): Tilt {
  const { w, h, data } = r;
  if (w < 32 || h < 32) return { deg: 0, confidence: 0 };
  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; j < gray.length; i += 3, j++) gray[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  const mags: number[] = [];
  const pts: { m: number; o: number; x: number; y: number; v: boolean }[] = [];
  const m = 3;
  for (let y = m; y < h - m; y++) {
    for (let x = m; x < w - m; x++) {
      const p = y * w + x;
      const gx = gray[p - w + 1] + 2 * gray[p + 1] + gray[p + w + 1] - gray[p - w - 1] - 2 * gray[p - 1] - gray[p + w - 1];
      const gy = gray[p + w - 1] + 2 * gray[p + w] + gray[p + w + 1] - gray[p - w - 1] - 2 * gray[p - w] - gray[p - w + 1];
      const mag = Math.hypot(gx, gy);
      if (mag < 40) continue;
      // Dirección de la línea (perpendicular al cambio de luz), entre -90 y 90; 0 = horizontal.
      let o = (Math.atan2(gy, gx) * 180) / Math.PI + 90;
      while (o >= 90) o -= 180;
      while (o < -90) o += 180;
      // Desvío de la horizontal o de la vertical más cercana.
      const dev = Math.abs(o) <= 45 ? o : o > 0 ? o - 90 : o + 90;
      if (Math.abs(dev) > 10) continue;
      mags.push(mag);
      pts.push({ m: mag, o: dev, x, y, v: Math.abs(o) > 45 });
    }
  }
  if (pts.length < 200) return { deg: 0, confidence: 0 };
  // Solo los bordes fuertes (el 30 % más marcado).
  const cut = [...mags].sort((a, b) => b - a)[Math.floor(mags.length * 0.3)];
  const BIN = 0.25;
  const bins = new Float64Array(Math.round(20 / BIN) + 1);
  let total = 0;
  for (const p of pts) {
    if (p.m < cut) continue;
    bins[Math.round((p.o + 10) / BIN)] += p.m;
    total += p.m;
  }
  if (!total) return { deg: 0, confidence: 0 };
  // El pico (sumando ±0.75°).
  let best = 0;
  let bestAt = 0;
  const win = Math.round(0.75 / BIN);
  for (let i = 0; i < bins.length; i++) {
    let s = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(bins.length - 1, i + win); j++) s += bins[j];
    if (s > best) {
      best = s;
      bestAt = i;
    }
  }
  // Centro del pico, más fino.
  let ws = 0;
  let wo = 0;
  for (let j = Math.max(0, bestAt - win); j <= Math.min(bins.length - 1, bestAt + win); j++) {
    ws += bins[j];
    wo += bins[j] * (j * BIN - 10);
  }
  const rough = ws ? wo / ws : 0;
  const confidence = Math.min(1, best / total);
  return { deg: Math.round(refineTilt(pts.filter((p) => p.m >= cut && Math.abs(p.o - rough) <= 2), rough) * 100) / 100, confidence };
}

/**
 * Afina el ángulo: prueba giros de 0.05° alrededor del primero y se queda con el que deja los bordes más alineados
 * en filas (líneas horizontales) y columnas (verticales). El cambio de luz de Sobel solo, se queda corto.
 */
function refineTilt(pts: { m: number; x: number; y: number; v: boolean }[], rough: number): number {
  if (pts.length < 50) return rough;
  let best = rough;
  let bestScore = -1;
  for (let a = rough - 1.5; a <= rough + 1.5 + 1e-9; a += 0.05) {
    const r = (a * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const rows = new Map<number, number>();
    const cols = new Map<number, number>();
    for (const p of pts) {
      if (p.v) {
        const k = Math.round(p.x * c + p.y * s);
        cols.set(k, (cols.get(k) ?? 0) + p.m);
      } else {
        const k = Math.round(p.y * c - p.x * s);
        rows.set(k, (rows.get(k) ?? 0) + p.m);
      }
    }
    let score = 0;
    for (const v of rows.values()) score += v * v;
    for (const v of cols.values()) score += v * v;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

/** Lo que se considera una inclinación clara de las líneas. */
const CONFIDENT = 0.3;
/** Grados más allá de los cuales no se endereza (la foto se tomó así a propósito o no se sabe). */
export const MAX_STRAIGHTEN = 7;

/**
 * Cuántos grados girar para enderezar (+ = a la derecha), o 0. Prefiere las líneas de la foto; usa lo que dijo la IA
 * solo si las líneas apuntan para el mismo lado. Si las dos fuentes no están de acuerdo, no se gira.
 */
export function chooseRotation(tilt: Tilt | null, ai: number | null): number {
  const local = tilt ? -tilt.deg : 0;
  const sure = Boolean(tilt && tilt.confidence >= CONFIDENT && Math.abs(local) >= 0.5 && Math.abs(local) <= MAX_STRAIGHTEN);
  if (sure) {
    if (ai !== null && Math.abs(ai) >= 1 && Math.abs(ai - local) > 3) return 0;
    return round1(local);
  }
  if (ai !== null && Math.abs(ai) >= 1 && Math.abs(ai) <= 5 && tilt && Math.sign(local) === Math.sign(ai) && Math.abs(local - ai) <= 2 && tilt.confidence >= 0.12) {
    return round1(ai);
  }
  return 0;
}

/** Tamaño del rectángulo más grande (misma forma) que cabe dentro de la foto girada `deg` grados. */
export function inscribed(w: number, h: number, deg: number): { w: number; h: number } {
  const a = (Math.abs(deg) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = Math.min(w / (w * c + h * s), h / (w * s + h * c));
  // 2 px menos por el borde suavizado del giro.
  return { w: Math.max(1, Math.floor(w * k) - 2), h: Math.max(1, Math.floor(h * k) - 2) };
}

/** Cómo se mueve un punto (0–1) de la foto al girarla y recortarla. */
export type FrameMap = (p: Point) => Point;
const same: FrameMap = (p) => p;

function rotationMap(w: number, h: number, W: number, H: number, deg: number, cut: { left: number; top: number; w: number; h: number }): FrameMap {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (p) => {
    const dx = p.x * w - w / 2;
    const dy = p.y * h - h / 2;
    const x = W / 2 + dx * c - dy * s - cut.left;
    const y = H / 2 + dx * s + dy * c - cut.top;
    return { x: x / cut.w, y: y / cut.h };
  };
}

function cropMap(w: number, h: number, cut: { left: number; top: number; w: number; h: number }): FrameMap {
  return (p) => ({ x: (p.x * w - cut.left) / cut.w, y: (p.y * h - cut.top) / cut.h });
}

/** Una caja pasada al nuevo marco (la caja que encierra sus 4 esquinas), recortada a la foto. null si quedó fuera. */
export function mapBox(b: Box, f: FrameMap): Box | null {
  const pts = [f({ x: b.x, y: b.y }), f({ x: b.x + b.w, y: b.y }), f({ x: b.x, y: b.y + b.h }), f({ x: b.x + b.w, y: b.y + b.h })];
  const x0 = clamp(Math.min(...pts.map((p) => p.x)), 0, 1);
  const y0 = clamp(Math.min(...pts.map((p) => p.y)), 0, 1);
  const x1 = clamp(Math.max(...pts.map((p) => p.x)), 0, 1);
  const y1 = clamp(Math.max(...pts.map((p) => p.y)), 0, 1);
  if (x1 - x0 < 0.002 || y1 - y0 < 0.002) return null;
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  return { x: r4(x0), y: r4(y0), w: r4(x1 - x0), h: r4(y1 - y0) };
}

/** Gira la foto y le quita las esquinas vacías que deja el giro. */
export async function straighten(r: Raw, deg: number): Promise<{ raw: Raw; map: FrameMap; box: Box }> {
  const rot = await toRaw(fromRaw(r).rotate(deg, { background: { r: 0, g: 0, b: 0 } }));
  const size = inscribed(r.w, r.h, deg);
  const cut = { left: Math.round((rot.w - size.w) / 2), top: Math.round((rot.h - size.h) / 2), w: size.w, h: size.h };
  const raw = await toRaw(fromRaw(rot).extract({ left: cut.left, top: cut.top, width: cut.w, height: cut.h }));
  // La parte de la foto girada que quedó (para contarlo).
  const box = { x: cut.left / rot.w, y: cut.top / rot.h, w: cut.w / rot.w, h: cut.h / rot.h };
  return { raw, map: rotationMap(r.w, r.h, rot.w, rot.h, deg, cut), box };
}

// ---------- Bordes vacíos ----------

/**
 * Bordes que sobran: franjas negras o blancas parejas en dos lados opuestos (o en los cuatro), como en una captura o
 * un escaneo. Devuelve la parte a dejar en pixeles de la foto, o null si no hay nada claro que quitar.
 */
export async function junkBorders(r: Raw): Promise<{ left: number; top: number; w: number; h: number } | null> {
  const prev = await smallRaw(r, 600);
  const corner = [prev.data[0], prev.data[1], prev.data[2]];
  const l = (corner[0] * 299 + corner[1] * 587 + corner[2] * 114) / 1000;
  const chroma = Math.max(...corner) - Math.min(...corner);
  if (!((l < 24 || l > 232) && chroma < 18)) return null;
  let info: OutputInfo;
  try {
    info = (await fromRaw(prev).trim({ threshold: 14 }).raw().toBuffer({ resolveWithObject: true })).info;
  } catch {
    return null;
  }
  const left = -(info.trimOffsetLeft ?? 0);
  const top = -(info.trimOffsetTop ?? 0);
  const right = prev.w - info.width - left;
  const bottom = prev.h - info.height - top;
  const fx = (v: number) => v / prev.w;
  const fy = (v: number) => v / prev.h;
  const lr = fx(left) >= 0.01 && fx(right) >= 0.01;
  const tb = fy(top) >= 0.01 && fy(bottom) >= 0.01;
  if (!lr && !tb) return null;
  if ([fx(left), fx(right), fy(top), fy(bottom)].some((v) => v > 0.35)) return null;
  if ((info.width * info.height) / (prev.w * prev.h) < 0.5) return null;
  // En pixeles de la foto grande, 1 px hacia adentro para no dejar una línea del borde.
  const kx = r.w / prev.w;
  const ky = r.h / prev.h;
  const x0 = Math.min(r.w - 1, Math.ceil(left * kx) + 1);
  const y0 = Math.min(r.h - 1, Math.ceil(top * ky) + 1);
  const x1 = Math.max(x0 + 1, Math.floor((left + info.width) * kx) - 1);
  const y1 = Math.max(y0 + 1, Math.floor((top + info.height) * ky) - 1);
  return { left: x0, top: y0, w: Math.min(r.w, x1) - x0, h: Math.min(r.h, y1) - y0 };
}

// ---------- Tapar datos privados ----------

/** Desenfoca fuerte (pixelado y difuminado) cada caja, con bordes suaves que salen un poco de la caja. */
export async function blurBoxes(r: Raw, boxes: Box[]): Promise<Raw> {
  if (!boxes.length) return r;
  const out = Buffer.from(r.data);
  for (const b of boxes) {
    const bx0 = Math.floor(b.x * r.w);
    const by0 = Math.floor(b.y * r.h);
    const bx1 = Math.ceil((b.x + b.w) * r.w);
    const by1 = Math.ceil((b.y + b.h) * r.h);
    const bw = bx1 - bx0;
    const bh = by1 - by0;
    if (bw < 2 || bh < 2) continue;
    const pad = Math.max(4, Math.round(0.08 * Math.max(bw, bh)));
    const rx0 = Math.max(0, bx0 - pad);
    const ry0 = Math.max(0, by0 - pad);
    const rx1 = Math.min(r.w, bx1 + pad);
    const ry1 = Math.min(r.h, by1 + pad);
    const rw = rx1 - rx0;
    const rh = ry1 - ry0;
    // Pixelado (unos 10 cuadros a lo ancho de la caja) y después difuminado: ilegible.
    const cells = Math.max(3, Math.round(Math.min(bw, bh) / Math.max(4, Math.min(bw, bh) / 10)));
    const sw = Math.max(2, Math.round((rw / Math.min(bw, bh)) * cells));
    const sh = Math.max(2, Math.round((rh / Math.min(bw, bh)) * cells));
    const sigma = Math.max(3, Math.min(bw, bh) / 6);
    const region = await toRaw(fromRaw(r).extract({ left: rx0, top: ry0, width: rw, height: rh }));
    const blurred = await toRaw(fromRaw(region).resize(sw, sh, { fit: "fill", kernel: "cubic" }).resize(rw, rh, { fit: "fill", kernel: "cubic" }).blur(sigma));
    for (let y = 0; y < rh; y++) {
      const gy = ry0 + y;
      const dy = gy < by0 ? by0 - gy : gy >= by1 ? gy - by1 + 1 : 0;
      for (let x = 0; x < rw; x++) {
        const gx = rx0 + x;
        const dx = gx < bx0 ? bx0 - gx : gx >= bx1 ? gx - bx1 + 1 : 0;
        // Dentro de la caja: tapado del todo; afuera, se desvanece hasta el borde del margen.
        const d = Math.max(dx, dy);
        const a = d === 0 ? 1 : Math.max(0, 1 - d / pad);
        if (a <= 0) continue;
        const o = (gy * r.w + gx) * 3;
        const s = (y * rw + x) * 3;
        for (let c = 0; c < 3; c++) out[o + c] = Math.round(blurred.data[s + c] * a + out[o + c] * (1 - a));
      }
    }
  }
  return { data: out, w: r.w, h: r.h };
}

// ---------- Lo importante de la foto ----------

/** Centro de lo importante según sharp (dónde hay más detalle, color y piel), 0–1. */
export async function attentionPoint(r: Raw): Promise<Point> {
  const prev = await smallRaw(r, 400);
  const side = 64;
  const scale = Math.max(side / prev.w, side / prev.h);
  const { info } = await fromRaw(prev).resize({ width: side, height: side, fit: "cover", position: sharp.strategy.attention }).toBuffer({ resolveWithObject: true });
  const ax = (info as { attentionX?: number }).attentionX;
  const ay = (info as { attentionY?: number }).attentionY;
  if (typeof ax !== "number" || typeof ay !== "number") return { x: 0.5, y: 0.5 };
  const r3 = (v: number) => Math.round(clamp(v, 0, 1) * 1000) / 1000;
  return { x: r3(ax / Math.round(prev.w * scale)), y: r3(ay / Math.round(prev.h * scale)) };
}

// ---------- Todo junto ----------

export type EnhanceOutput = {
  /** La mejorada en JPG (sin datos de GPS ni de la cámara). */
  data: Buffer;
  /** Miniatura de 512 px. */
  thumb: Buffer;
  width: number;
  height: number;
  steps: EnhanceStep[];
  focus: Point;
  focusFrom: "ai" | "auto" | "center";
  /** Tamaño de la foto recibida (ya girada como se tomó). */
  original: { w: number; h: number };
};

/**
 * Hace la copia mejorada. `hints` = lo que vio la IA (giro, centro, datos privados) en la foto girada como se tomó.
 * El orden: girar según la cámara → achicar a 2560 px → tapar datos privados → quitar bordes vacíos → luz y color
 * (probado antes) → enderezar → nitidez → JPG. Nunca agranda la foto.
 */
export async function enhancePhoto(input: Buffer, o: { hints?: EnhanceHints | null; maxSide?: number } = {}): Promise<EnhanceOutput> {
  const maxSide = o.maxSide ?? MAX_SIDE;
  const meta = await sharp(input, { failOn: "none" }).metadata();
  const swap = (meta.orientation ?? 1) >= 5;
  const original = { w: (swap ? meta.height : meta.width) ?? 0, h: (swap ? meta.width : meta.height) ?? 0 };
  const steps: EnhanceStep[] = [];
  if ((meta.orientation ?? 1) > 1) steps.push({ kind: "orient" });

  let raw = await toRaw(
    sharp(input, { failOn: "none" })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb"),
  );
  // Cómo se mueve un punto de la foto recibida a la mejorada.
  let map: FrameMap = same;
  const hints = o.hints ?? null;

  // 1) Datos privados (en la foto sin enderezar, como los vio la IA).
  const hide = (hints?.hide ?? []).filter((x) => x.box.w > 0 && x.box.h > 0);
  if (hide.length) raw = await blurBoxes(raw, hide.map((x) => x.box));

  // 2) Bordes vacíos.
  const border = await junkBorders(raw);
  if (border) {
    const before = { w: raw.w, h: raw.h };
    raw = await toRaw(fromRaw(raw).extract({ left: border.left, top: border.top, width: border.w, height: border.h }));
    const m1 = cropMap(before.w, before.h, border);
    const prevMap = map;
    map = (p) => m1(prevMap(p));
    steps.push({ kind: "crop", why: "border", box: { x: border.left / before.w, y: border.top / before.h, w: border.w / before.w, h: border.h / before.h } });
  }

  // 3) Luz y color, decididos y probados en una vista chica.
  const preview = await smallRaw(raw, 480);
  const tone = safeTone(preview);
  const p = tone.plan;
  if (p !== IDENTITY) {
    raw = applyTone(raw, p);
    const dLight = tone.after.mean - tone.before.mean;
    if (Math.abs(dLight) >= 5) steps.push({ kind: "light", value: Math.round((dLight / Math.max(20, tone.before.mean)) * 100) });
    if (p.scale >= 1.05) steps.push({ kind: "contrast", value: Math.round((p.scale - 1) * 100) });
    const wb = Math.max(...p.gains.map((g) => Math.abs(g - 1)));
    if (wb >= 0.03) steps.push({ kind: "whiteBalance", value: Math.round(wb * 100) });
    if (p.vibrance >= 0.05) steps.push({ kind: "color", value: Math.round(p.vibrance * 100) });
  }

  // 4) Enderezar (las líneas de la foto, y lo que dijo la IA si está de acuerdo).
  const tilt = detectTilt(await smallRaw(raw, 480));
  const deg = chooseRotation(tilt, hints?.rotate ?? null);
  if (deg) {
    const st = await straighten(raw, deg);
    raw = st.raw;
    const prevMap = map;
    map = (q) => st.map(prevMap(q));
    steps.push({ kind: "straighten", value: deg }, { kind: "crop", why: "straighten", box: st.box });
  }

  // 5) Menos grano en fotos oscuras que se aclararon; un poco de nitidez a todas (menos a las chicas).
  let img = fromRaw(raw);
  const dark = tone.before.mean < 70 && p.gamma < 0.9;
  if (dark) {
    img = img.median(3);
    steps.push({ kind: "denoise" });
  }
  if (Math.max(raw.w, raw.h) >= 400) {
    const sigma = 0.6 + 0.6 * Math.min(1, Math.max(raw.w, raw.h) / 2560);
    img = img.sharpen({ sigma, m1: 0.4, m2: dark ? 0.6 : 1 });
    steps.push({ kind: "sharpen" });
  }

  // Sin datos de la cámara ni GPS (sharp no copia los metadatos si no se le pide).
  const { data, info } = await img.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  const thumb = await sharp(data).resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();

  // Las cajas tapadas, dichas sobre la mejorada.
  for (const x of hide) {
    const box = mapBox(x.box, map);
    if (box) steps.push({ kind: "blur", reason: x.reason, box });
  }

  // Lo importante: lo que dijo la IA (pasado al nuevo marco) o lo que ve sharp.
  let focus: Point = { x: 0.5, y: 0.5 };
  let focusFrom: EnhanceOutput["focusFrom"] = "center";
  if (hints?.focus) {
    const f = map(hints.focus);
    if (f.x >= 0 && f.x <= 1 && f.y >= 0 && f.y <= 1) {
      focus = { x: Math.round(f.x * 1000) / 1000, y: Math.round(f.y * 1000) / 1000 };
      focusFrom = "ai";
    }
  }
  if (focusFrom === "center") {
    try {
      focus = await attentionPoint(raw);
      focusFrom = "auto";
    } catch {
      // Queda al centro.
    }
  }

  return { data, thumb, width: info.width, height: info.height, steps, focus, focusFrom, original };
}
