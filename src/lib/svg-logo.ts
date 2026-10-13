// Logos en SVG: se limpian y se convierten en un PNG grande y nítido (2000 px del lado más largo) para los diseños y
// el kit. El SVG nunca se guarda ni se publica tal cual (puede traer código o enlaces a otros archivos): solo el PNG.
import sharp from "sharp";
import { bi } from "@/lib/i18n";

export const SVG_MAX_BYTES = 1024 * 1024;
export const SVG_PNG_SIDE = 2000;

const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,/i;

/**
 * Deja solo el dibujo: sin scripts, eventos (onload…), foreignObject, @import ni enlaces a archivos de afuera (solo
 * `#id` e imágenes incrustadas). Rechaza DOCTYPE y ENTITY (pueden leer archivos o inflar el archivo sin fin).
 * null si no es un SVG o es demasiado grande.
 */
export function cleanSvg(text: string): string | null {
  if (Buffer.byteLength(text) > SVG_MAX_BYTES) return null;
  let s = text.replace(/^﻿/, "").trim();
  if (/<!DOCTYPE|<!ENTITY/i.test(s) || !/<svg[\s>]/i.test(s)) return null;
  s = s.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").replace(/<script\b[^>]*\/>/gi, "");
  s = s.replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, "").replace(/<foreignObject\b[^>]*\/>/gi, "");
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/\s(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (m, a: string | undefined, b: string | undefined) => {
    const v = (a ?? b ?? "").trim();
    return v.startsWith("#") || SAFE_DATA_IMAGE.test(v) ? m : "";
  });
  s = s.replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (m, _q: string, v: string) => (v.trim().startsWith("#") || SAFE_DATA_IMAGE.test(v.trim()) ? m : "none"));
  s = s.replace(/@import[^;]*;?/gi, "");
  return s;
}

/** Convierte un logo SVG en PNG con fondo transparente, con `side` px en su lado más largo. */
export async function svgToPng(text: string, side = SVG_PNG_SIDE): Promise<Buffer> {
  const clean = cleanSvg(text);
  if (!clean) throw bi("Ese archivo no es un SVG que se pueda usar (o pesa más de 1 MB).", "That file isn't a usable SVG (or it's over 1 MB).");
  const buf = Buffer.from(clean);
  const meta = await sharp(buf, { limitInputPixels: 40_000_000 })
    .metadata()
    .catch(() => null);
  const long = Math.max(meta?.width ?? 0, meta?.height ?? 0);
  if (!long) throw bi("No se pudo leer el tamaño del SVG.", "Couldn't read the SVG's size.");
  // A 72 puntos por pulgada el SVG mide `long` px: se dibuja más denso para que salga nítido al tamaño pedido.
  const density = Math.min(2400, Math.max(1, (72 * side) / long));
  return sharp(buf, { density, limitInputPixels: 100_000_000 }).resize({ width: side, height: side, fit: "inside" }).png().toBuffer();
}
