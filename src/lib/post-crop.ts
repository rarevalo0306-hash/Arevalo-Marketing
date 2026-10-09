// Recorte inteligente con punto importante: cuando una foto se recorta al tamaño de una red (4:5, 9:16, 16:9…),
// el recorte se centra en lo importante de la foto (LibraryItem.enhanceInfo.focus o Post.media[].focus) y nunca
// se sale de la foto. Sin punto conocido, sharp busca lo que llama la atención (strategy.attention).
import sharp from "sharp";
import type { Focus } from "@/lib/post-media";

export type CropBox = { left: number; top: number; width: number; height: number };

/**
 * La parte de una foto de `iw`×`ih` que se queda al recortarla a la proporción `tw`:`th`, lo más grande posible
 * y con `focus` (0–1) lo más al centro que se pueda sin salirse de la foto.
 */
export function focusCropBox(iw: number, ih: number, tw: number, th: number, focus: Focus): CropBox {
  const want = tw / th;
  let width = iw;
  let height = Math.round(iw / want);
  if (height > ih) {
    height = ih;
    width = Math.round(ih * want);
  }
  width = Math.max(1, Math.min(iw, width));
  height = Math.max(1, Math.min(ih, height));
  const fx = Math.min(1, Math.max(0, focus.x)) * iw;
  const fy = Math.min(1, Math.max(0, focus.y)) * ih;
  const left = Math.round(Math.min(iw - width, Math.max(0, fx - width / 2)));
  const top = Math.round(Math.min(ih - height, Math.max(0, fy - height / 2)));
  return { left, top, width, height };
}

/** Recorta (y lleva al tamaño `w`×`h`) una foto: con el punto importante si se conoce; si no, recorte de sharp. */
export async function smartCrop(src: Buffer, w: number, h: number, focus?: Focus): Promise<Buffer> {
  const rotated = await sharp(src).rotate().toBuffer();
  if (!focus) return sharp(rotated).resize(w, h, { fit: "cover", position: sharp.strategy.attention }).flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  const meta = await sharp(rotated).metadata();
  const box = focusCropBox(meta.width ?? w, meta.height ?? h, w, h, focus);
  return sharp(rotated).extract(box).resize(w, h, { fit: "fill" }).flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}
