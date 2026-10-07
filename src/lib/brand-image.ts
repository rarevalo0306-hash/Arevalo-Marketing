// Arreglos de imagen para logos con sharp: quitar un fondo liso, pintar el logo de un solo color (blanco para
// fondos oscuros), recortar lo que sobra y saber si ya tiene partes transparentes.
import sharp from "sharp";

type Raw = { data: Buffer; width: number; height: number };

async function rgba(input: Buffer): Promise<Raw> {
  const { data, info } = await sharp(input).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const png = (r: Raw) => sharp(r.data, { raw: { width: r.width, height: r.height, channels: 4 } }).png();

/** ¿Tiene partes transparentes de verdad? (no solo un canal alfa lleno). */
export async function hasTransparency(input: Buffer): Promise<boolean> {
  const { data } = await rgba(await sharp(input).resize(96, 96, { fit: "inside" }).toBuffer());
  for (let i = 3; i < data.length; i += 4) if (data[i] < 200) return true;
  return false;
}

/** El color del borde de la imagen si es parejo (fondo liso), o null si el borde es variado (foto). */
export function flatBorderColor(r: Raw): [number, number, number] | null {
  const { data, width, height } = r;
  const px: [number, number, number][] = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 60));
  const take = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] > 200) px.push([data[i], data[i + 1], data[i + 2]]);
  };
  for (let x = 0; x < width; x += step) {
    take(x, 0);
    take(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    take(0, y);
    take(width - 1, y);
  }
  if (px.length < 8) return null;
  const mid = (k: 0 | 1 | 2) => px.map((p) => p[k]).sort((a, b) => a - b)[Math.floor(px.length / 2)];
  const c: [number, number, number] = [mid(0), mid(1), mid(2)];
  const near = px.filter((p) => Math.abs(p[0] - c[0]) + Math.abs(p[1] - c[1]) + Math.abs(p[2] - c[2]) < 40).length;
  return near / px.length >= 0.85 ? c : null;
}

/**
 * Quita un fondo liso (blanco, negro o de un color) desde los bordes hacia adentro, con borde suave.
 * Normalmente solo borra el fondo conectado al borde: los huecos de color igual dentro del logo se quedan (así se ve
 * igual que el original). Con `holes` también se borran esos huecos: para las versiones de un solo color (blanca),
 * donde un hueco relleno taparía la forma. Si el borde no es liso (una foto), devuelve null.
 */
export async function removeFlatBackground(input: Buffer, opts: { holes?: boolean } = {}): Promise<Buffer | null> {
  const r = await rgba(input);
  const bg = flatBorderColor(r);
  if (!bg) return null;
  const { data, width, height } = r;
  const dist = (i: number) => Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
  const HARD = 36;
  const SOFT = 90;
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const p = y * width + x;
    if (seen[p]) return;
    seen[p] = 1;
    if (dist(p * 4) < SOFT) stack.push(p);
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  if (opts.holes) for (let p = 0; p < width * height; p++) if (!seen[p] && dist(p * 4) < SOFT) {
    seen[p] = 1;
    stack.push(p);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const i = p * 4;
    const d = dist(i);
    // Muy parecido al fondo: transparente. Cerca: semitransparente (borde suave) y no se sigue avanzando.
    data[i + 3] = d < HARD ? 0 : Math.min(data[i + 3], Math.round(((d - HARD) / (SOFT - HARD)) * 255));
    if (d >= HARD) continue;
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }
  return trimTransparent(await png(r).toBuffer());
}

/** Recorta lo transparente que sobra alrededor y deja un margen pequeño. */
export async function trimTransparent(input: Buffer, padPct = 0.04): Promise<Buffer> {
  const trimmed = await sharp(input).ensureAlpha().trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }).png().toBuffer().catch(() => input);
  const m = await sharp(trimmed).metadata();
  const pad = Math.round(Math.max(m.width ?? 0, m.height ?? 0) * padPct);
  if (!pad) return trimmed;
  return sharp(trimmed).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
}

/** Pinta todo lo visible del logo de un solo color (ej. blanco para fondos oscuros), sin tocar la transparencia. */
export async function recolor(input: Buffer, hex: string): Promise<Buffer> {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  const r = await rgba(input);
  for (let i = 0; i < r.data.length; i += 4) {
    r.data[i] = (n >> 16) & 255;
    r.data[i + 1] = (n >> 8) & 255;
    r.data[i + 2] = n & 255;
  }
  return png(r).toBuffer();
}

/** Logo con fondo transparente: si ya lo tiene, solo se recorta; si tiene fondo liso, se le quita (ver `holes`). */
export async function transparentLogo(input: Buffer, opts: { holes?: boolean } = {}): Promise<{ data: Buffer; transparent: boolean }> {
  if (await hasTransparency(input)) return { data: await trimTransparent(await sharp(input).png().toBuffer()), transparent: true };
  const cut = await removeFlatBackground(input, opts);
  return cut ? { data: cut, transparent: true } : { data: await sharp(input).png().toBuffer(), transparent: false };
}
