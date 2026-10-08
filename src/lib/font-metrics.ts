// Medidas reales de las letras (ancho de cada carácter) leídas de los archivos .woff de src/assets/fonts.
// Con esto el diseñador sabe cuánto ocupa cada línea del titular ANTES de dibujarla: así elige el tamaño
// justo, reparte las líneas parejas y nunca deja que el texto se salga ni pise el logo.
import { unzlibSync } from "fflate";

export type FontMetrics = {
  unitsPerEm: number;
  /** Ancho de avance de un carácter, en unidades de la letra (0 si no está). */
  advance: (codePoint: number) => number;
  /** Ancho medio (para caracteres que la letra no trae). */
  fallback: number;
};

/** Lee head, hhea, hmtx y cmap de un archivo WOFF 1.0 (o TTF/OTF sin comprimir). */
export function parseFont(buf: Uint8Array): FontMetrics {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sig = dv.getUint32(0);
  const tables = new Map<string, DataView>();
  const tagAt = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (sig === 0x774f4646) {
    // 'wOFF'
    const n = dv.getUint16(12);
    for (let i = 0; i < n; i++) {
      const e = 44 + i * 20;
      const tag = tagAt(e);
      if (!["head", "hhea", "hmtx", "cmap"].includes(tag)) continue;
      const off = dv.getUint32(e + 4);
      const comp = dv.getUint32(e + 8);
      const orig = dv.getUint32(e + 12);
      const raw = buf.subarray(off, off + comp);
      const data = comp < orig ? unzlibSync(raw) : raw;
      tables.set(tag, new DataView(data.buffer, data.byteOffset, data.byteLength));
    }
  } else {
    const n = dv.getUint16(4);
    for (let i = 0; i < n; i++) {
      const e = 12 + i * 16;
      const off = dv.getUint32(e + 8);
      const len = dv.getUint32(e + 12);
      tables.set(tagAt(e), new DataView(buf.buffer, buf.byteOffset + off, len));
    }
  }
  const head = tables.get("head");
  const hhea = tables.get("hhea");
  const hmtx = tables.get("hmtx");
  const cmap = tables.get("cmap");
  if (!head || !hhea || !hmtx || !cmap) throw new Error("font tables missing");
  const unitsPerEm = head.getUint16(18);
  const numH = hhea.getUint16(34);
  const adv = (gid: number) => hmtx.getUint16(Math.min(gid, numH - 1) * 4);

  // cmap: formato 12 (3,10) o formato 4 (3,1 / 0,x).
  let lookup: (cp: number) => number = () => 0;
  const subs = cmap.getUint16(2);
  let best: { off: number; fmt: number } | null = null;
  for (let i = 0; i < subs; i++) {
    const pid = cmap.getUint16(4 + i * 8);
    const eid = cmap.getUint16(6 + i * 8);
    const off = cmap.getUint32(8 + i * 8);
    const fmt = cmap.getUint16(off);
    if (fmt === 12 && (pid === 3 || pid === 0)) best = { off, fmt };
    else if (fmt === 4 && (pid === 3 || pid === 0) && (eid === 1 || pid === 0) && best?.fmt !== 12) best = { off, fmt };
  }
  if (best?.fmt === 4) {
    const o = best.off;
    const segX2 = cmap.getUint16(o + 6);
    const ends = o + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    lookup = (cp) => {
      if (cp > 0xffff) return 0;
      for (let s = 0; s < segX2; s += 2) {
        const end = cmap.getUint16(ends + s);
        if (cp > end) continue;
        const start = cmap.getUint16(starts + s);
        if (cp < start) return 0;
        const delta = cmap.getInt16(deltas + s);
        const ro = cmap.getUint16(ranges + s);
        if (!ro) return (cp + delta) & 0xffff;
        const g = cmap.getUint16(ranges + s + ro + (cp - start) * 2);
        return g ? (g + delta) & 0xffff : 0;
      }
      return 0;
    };
  } else if (best?.fmt === 12) {
    const o = best.off;
    const groups = cmap.getUint32(o + 12);
    lookup = (cp) => {
      for (let i = 0; i < groups; i++) {
        const g = o + 16 + i * 12;
        const s = cmap.getUint32(g);
        const e = cmap.getUint32(g + 4);
        if (cp >= s && cp <= e) return cmap.getUint32(g + 8) + (cp - s);
      }
      return 0;
    };
  }
  const cache = new Map<number, number>();
  const fallback = adv(lookup(0x6e)) || unitsPerEm * 0.55; // "n"
  return {
    unitsPerEm,
    fallback,
    advance: (cp) => {
      const hit = cache.get(cp);
      if (hit !== undefined) return hit;
      const g = lookup(cp);
      const a = g ? adv(g) : 0;
      cache.set(cp, a);
      return a;
    },
  };
}

/**
 * Función para medir texto con una letra: ancho en px de `text` a `size` px, con `tracking` (espacio extra
 * entre letras, en px). Los caracteres que la letra no trae cuentan como una "n".
 */
export function measurer(m: FontMetrics) {
  return (text: string, size: number, tracking = 0): number => {
    let units = 0;
    let n = 0;
    for (const ch of text) {
      const a = m.advance(ch.codePointAt(0)!);
      units += a || m.fallback;
      n++;
    }
    return (units / m.unitsPerEm) * size + Math.max(0, n - 1) * tracking;
  };
}
