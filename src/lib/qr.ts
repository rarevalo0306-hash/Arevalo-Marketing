// Código QR sin librerías (para el link de reseñas de Google y la tarjeta para imprimir). PURO: sin servidor ni red.
// Modo byte (UTF-8), versiones 1 a 40, corrección de errores L/M/Q/H (por defecto M: aguanta ~15 % de daño).
// Sigue la norma ISO/IEC 18004 (mismo orden de pasos que la implementación de referencia de Project Nayuki).
// Se prueba en tests/directories.test.ts con un decodificador propio (lee el formato, quita la máscara, junta los
// bloques, revisa Reed-Solomon y lee el texto) y con el ejemplo conocido de Reed-Solomon de la norma.

export type QrEcc = "L" | "M" | "Q" | "H";
export type QrCode = { version: number; ecc: QrEcc; mask: number; size: number; /** [fila][columna], true = oscuro. */ modules: boolean[][] };

const ECC_ORDINAL: Record<QrEcc, number> = { L: 0, M: 1, Q: 2, H: 3 };
/** Los 2 bits del nivel en la información de formato (L=01, M=00, Q=11, H=10). */
const ECC_FORMAT_BITS: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Por versión (índice 0 sin usar): bytes de corrección por bloque y cuántos bloques, para L, M, Q y H.
const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

export const QR_MIN_VERSION = 1;
export const QR_MAX_VERSION = 40;

/** Módulos que llevan datos (y corrección) en una versión: todo menos los patrones fijos. */
export function numRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

/** Bytes de datos (sin la corrección) que caben en una versión y nivel. */
export function numDataCodewords(ver: number, ecc: QrEcc): number {
  const e = ECC_ORDINAL[ecc];
  return Math.floor(numRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[e][ver] * NUM_ERROR_CORRECTION_BLOCKS[e][ver];
}

/** Cuántos bytes de texto caben (modo byte) en una versión y nivel. */
export function byteCapacity(ver: number, ecc: QrEcc): number {
  const ccBits = ver < 10 ? 8 : 16;
  return Math.floor((numDataCodewords(ver, ecc) * 8 - 4 - ccBits) / 8);
}

/** Bloques de una versión y nivel (para quien quiera leer el código): bytes de corrección por bloque y cuántos. */
export function blockLayout(ver: number, ecc: QrEcc): { blocks: number; eccPerBlock: number } {
  const e = ECC_ORDINAL[ecc];
  return { blocks: NUM_ERROR_CORRECTION_BLOCKS[e][ver], eccPerBlock: ECC_CODEWORDS_PER_BLOCK[e][ver] };
}

// ---------- Reed-Solomon en GF(256) con el polinomio 0x11D ----------

export function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** Polinomio generador de grado `degree` (sin el coeficiente principal, que es 1). */
export function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** Los bytes de corrección de un bloque de datos. */
export function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMultiply(coef, factor)));
  }
  return result;
}

// ---------- Datos ----------

/** Posiciones (fila y columna) de los patrones de alineación de una versión. */
export function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 17 - 7; out.length < numAlign; pos -= step) out.splice(1, 0, pos);
  return out;
}

/** Los bytes de datos (modo byte, con relleno) para una versión: lo que va antes de la corrección. */
export function dataCodewords(bytes: Uint8Array, ver: number, ecc: QrEcc): number[] {
  const bits: number[] = [];
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = numDataCodewords(ver, ecc) * 8;
  if (bits.length > capacity) throw new Error("QR: el texto no cabe en esta versión");
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return out;
}

/** Divide en bloques, agrega la corrección de cada uno y los intercala (como se escriben en el código). */
export function addEccAndInterleave(data: number[], ver: number, ecc: QrEcc): number[] {
  const { blocks: numBlocks, eccPerBlock } = blockLayout(ver, ecc);
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(eccPerBlock);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - eccPerBlock + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const rem = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(rem));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - eccPerBlock || j >= numShortBlocks) out.push(block[i]);
    });
  return out;
}

// ---------- Matriz ----------

class Grid {
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];
  constructor(readonly size: number) {
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  setFunction(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

function drawFunctionPatterns(g: Grid, ver: number) {
  const size = g.size;
  for (let i = 0; i < size; i++) {
    g.setFunction(6, i, i % 2 === 0);
    g.setFunction(i, 6, i % 2 === 0);
  }
  const finder = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) g.setFunction(xx, yy, dist !== 2 && dist !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const pos = alignmentPositions(ver);
  const n = pos.length;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) g.setFunction(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  drawFormatBits(g, "M", 0);
  drawVersion(g, ver);
}

/** Los 15 bits de formato (nivel + máscara, con su corrección BCH y la máscara 0x5412). */
export function formatBits(ecc: QrEcc, mask: number): number {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormatBits(g: Grid, ecc: QrEcc, mask: number) {
  const bits = formatBits(ecc, mask);
  const size = g.size;
  for (let i = 0; i <= 5; i++) g.setFunction(8, i, bit(bits, i));
  g.setFunction(8, 7, bit(bits, 6));
  g.setFunction(8, 8, bit(bits, 7));
  g.setFunction(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) g.setFunction(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) g.setFunction(size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) g.setFunction(8, size - 15 + i, bit(bits, i));
  g.setFunction(8, size - 8, true);
}

function drawVersion(g: Grid, ver: number) {
  if (ver < 7) return;
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (ver << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const a = g.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    g.setFunction(a, b, bit(bits, i));
    g.setFunction(b, a, bit(bits, i));
  }
}

function drawCodewords(g: Grid, data: number[]) {
  const size = g.size;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!g.isFunction[y][x] && i < data.length * 8) {
          g.modules[y][x] = bit(data[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
  }
}

/** ¿Se invierte el módulo (x = columna, y = fila) con esta máscara? */
export function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      throw new Error("QR: máscara inválida");
  }
}

function applyMask(g: Grid, mask: number) {
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (!g.isFunction[y][x] && maskBit(mask, x, y)) g.modules[y][x] = !g.modules[y][x];
}

/** Puntaje de "qué tan difícil de leer" (las 4 reglas de la norma). Se elige la máscara con menos puntos. */
function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const lineScore = (get: (i: number) => boolean) => {
    let s = 0;
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) s += 3 + (run - 5);
        run = 1;
      }
    }
    // Parecido a un patrón de búsqueda: 1011101 con 4 claros a un lado.
    const a = [true, false, true, true, true, false, true, false, false, false, false];
    const b = [false, false, false, false, true, false, true, true, true, false, true];
    for (let i = 0; i + 11 <= size; i++) {
      let ma = true;
      let mb = true;
      for (let k = 0; k < 11 && (ma || mb); k++) {
        const v = get(i + k);
        if (v !== a[k]) ma = false;
        if (v !== b[k]) mb = false;
      }
      if (ma) s += 40;
      if (mb) s += 40;
    }
    return s;
  };
  for (let y = 0; y < size; y++) score += lineScore((i) => m[y][i]);
  for (let x = 0; x < size; x++) score += lineScore((i) => m[i][x]);
  for (let y = 0; y + 1 < size; y++)
    for (let x = 0; x + 1 < size; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  score += Math.max(0, k) * 10;
  return score;
}

/**
 * Arma el código QR de un texto (UTF-8). Elige la versión más chica donde cabe y la mejor máscara.
 * `mask` fija la máscara (0-7) si se quiere. Lanza un error si el texto es demasiado largo.
 */
export function encodeQr(text: string, opts: { ecc?: QrEcc; minVersion?: number; mask?: number } = {}): QrCode {
  const ecc = opts.ecc ?? "M";
  const bytes = new TextEncoder().encode(text);
  let ver = Math.max(QR_MIN_VERSION, Math.min(QR_MAX_VERSION, opts.minVersion ?? 1));
  while (ver <= QR_MAX_VERSION && byteCapacity(ver, ecc) < bytes.length) ver++;
  if (ver > QR_MAX_VERSION) throw new Error("QR: el texto es demasiado largo");
  const codewords = addEccAndInterleave(dataCodewords(bytes, ver, ecc), ver, ecc);
  const base = new Grid(ver * 4 + 17);
  drawFunctionPatterns(base, ver);
  drawCodewords(base, codewords);
  const tryMask = (mask: number) => {
    const g = new Grid(base.size);
    for (let y = 0; y < g.size; y++) {
      g.modules[y] = [...base.modules[y]];
      g.isFunction[y] = [...base.isFunction[y]];
    }
    applyMask(g, mask);
    drawFormatBits(g, ecc, mask);
    return g;
  };
  let best: { g: Grid; mask: number; score: number } | null = null;
  const masks = opts.mask !== undefined ? [opts.mask] : [0, 1, 2, 3, 4, 5, 6, 7];
  for (const mask of masks) {
    const g = tryMask(mask);
    const score = penalty(g.modules);
    if (!best || score < best.score) best = { g, mask, score };
  }
  const chosen = best as { g: Grid; mask: number };
  return { version: ver, ecc, mask: chosen.mask, size: chosen.g.size, modules: chosen.g.modules };
}

/**
 * El QR como SVG (un solo <path>, sin texto ni scripts). `margin` en módulos (la norma pide 4).
 * Colores como texto CSS (se limpian: solo #hex o nombres simples).
 */
export function qrSvg(text: string, opts: { ecc?: QrEcc; margin?: number; dark?: string; light?: string; size?: number } = {}): string {
  const qr = encodeQr(text, { ecc: opts.ecc ?? "M" });
  const margin = Math.max(0, Math.min(10, Math.round(opts.margin ?? 4)));
  const safe = (c: string | undefined, fallback: string) => (c && /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(c.trim()) ? c.trim() : fallback);
  const dark = safe(opts.dark, "#000000");
  const light = safe(opts.light, "#ffffff");
  const dim = qr.size + margin * 2;
  let d = "";
  for (let y = 0; y < qr.size; y++) {
    let x = 0;
    while (x < qr.size) {
      if (!qr.modules[y][x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < qr.size && qr.modules[y][x + run]) run++;
      d += `M${x + margin} ${y + margin}h${run}v1h-${run}z`;
      x += run;
    }
  }
  const px = opts.size ? ` width="${Math.round(opts.size)}" height="${Math.round(opts.size)}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}"${px} shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
