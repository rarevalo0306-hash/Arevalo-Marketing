// Dibuja los cuadros del video con la marca (mismas letras y colores que los diseños): cada escena con foto se
// convierte en varios cuadros con el movimiento suave hacia lo importante de la foto (Ken Burns) y el texto encima,
// dentro de la zona segura de Reels/TikTok; el cierre es una placa con logo, eslogan, teléfono y web. Los clips de
// video van tal cual. Todo se sube al almacenamiento y fal.ai (FFmpeg compose) lo une con la música.
// Solo servidor (sharp + next/og). El guion sale de video-plan.ts.
import { readFile } from "fs/promises";
import path from "path";
import { ImageResponse } from "next/og";
import { createElement as h, type CSSProperties, type ReactElement } from "react";
import sharp from "sharp";
import { fitText, gradientPair, gridMargin, inkForAll, isStory, pickInk, safeArea } from "@/lib/design-layout";
import { FONTS, fontId, hexOr, mix, rgba } from "@/lib/design-shapes";
import { measurer, parseFont } from "@/lib/font-metrics";
import { readMedia } from "@/lib/media";
import { FORMAT_SIZE, frameCounts, kenBurnsRect, type RenderJob, type Storyboard, type VideoOutro, type VideoScene } from "@/lib/video-plan";

type Size = { w: number; h: number };
type Font = { name: string; fonts: { name: string; data: Buffer; weight: 400 | 500 | 600 | 700 | 800; style: "normal" }[]; measure: (t: string, s: number) => number; measureSemi: (t: string, s: number) => number };

const fontCache = new Map<string, Font>();
/** La letra de los titulares de la marca (negrita y semi), con su medidor. */
async function brandFont(fontHeading: string): Promise<Font> {
  const id = fontId(fontHeading);
  const hit = fontCache.get(id);
  if (hit) return hit;
  const f = FONTS[id];
  const dir = path.join(process.cwd(), "src/assets/fonts");
  const [bold, semi] = await Promise.all([readFile(path.join(dir, `${id}-${f.bold}.woff`)), readFile(path.join(dir, `${id}-${f.semi}.woff`))]);
  const mb = measurer(parseFont(bold));
  const ms = measurer(parseFont(semi));
  const font: Font = {
    name: f.name,
    fonts: [
      { name: f.name, data: bold, weight: f.bold, style: "normal" },
      { name: f.name, data: semi, weight: f.semi, style: "normal" },
    ],
    measure: (t, s) => mb(t, s) * 1.04,
    measureSemi: (t, s) => ms(t, s) * 1.04,
  };
  fontCache.set(id, font);
  return font;
}

async function png(el: ReactElement, size: Size, font: Font): Promise<Buffer> {
  const res = new ImageResponse(el, { width: size.w, height: size.h, fonts: font.fonts });
  return Buffer.from(await res.arrayBuffer());
}

const div = (style: CSSProperties, ...children: (ReactElement | string | null | false)[]) => h("div", { style: { display: "flex", ...style } }, ...children.filter((c): c is ReactElement | string => Boolean(c)));

/**
 * El texto de una escena como PNG transparente del tamaño del video: en una placa del color de la marca, dentro de
 * la zona segura (en vertical: nada en el 14% de arriba ni en el 20% de abajo, donde las redes ponen sus botones).
 * El gancho va más grande y al centro; las demás, en el tercio de abajo.
 */
export async function captionOverlay(caption: string, role: VideoScene["role"], size: Size, brand: Pick<VideoOutro, "color" | "fontHeading">): Promise<Buffer | null> {
  const text = caption.trim();
  if (!text) return null;
  const font = await brandFont(brand.fontHeading);
  const { w, h: H } = size;
  const S = safeArea(w, H);
  const m = gridMargin(w, H);
  const story = isStory(w, H);
  const u = Math.min(w, H) / 1080;
  const hook = role === "hook";
  const pad = Math.round((hook ? 34 : 26) * u);
  const maxW = w - S.left - S.right - pad * 2;
  const fitted = fitText({ text, maxW, maxH: H * 0.3, max: Math.round((hook ? 104 : 76) * u), min: Math.round(40 * u), maxLines: hook ? 3 : 2, hardLines: 3, lineHeight: 1.12, measure: font.measure });
  const bg = hexOr(brand.color, "#126BBC");
  const ink = pickInk(bg);
  const boxW = Math.round(fitted.width + pad * 2);
  const boxH = Math.round(fitted.height + pad * 1.6);
  const left = story || hook ? Math.round((w - boxW) / 2) : S.left;
  const bottomLimit = H - S.bottom - Math.round(24 * u);
  const top = hook ? Math.round(Math.min(bottomLimit - boxH, Math.max(S.top, H * (story ? 0.4 : 0.38) - boxH / 2))) : Math.round(bottomLimit - boxH - (story ? Math.round(H * 0.04) : 0));
  const el = div(
    { width: w, height: H, position: "relative", fontFamily: font.name },
    div(
      {
        position: "absolute",
        left,
        top: Math.max(m, top),
        width: boxW,
        flexDirection: "column",
        alignItems: story || hook ? "center" : "flex-start",
        padding: `${Math.round(pad * 0.8)}px ${pad}px`,
        background: rgba(bg, 0.92),
        borderRadius: Math.round(22 * u),
        boxShadow: `0 ${Math.round(10 * u)}px ${Math.round(40 * u)}px rgba(0,0,0,0.35)`,
      },
      ...fitted.lines.map((line) => div({ color: ink, fontSize: fitted.size, fontWeight: 800, lineHeight: 1.12, whiteSpace: "nowrap" }, line)),
    ),
  );
  return png(el, size, font);
}

/** Logo como data URI (PNG si tiene transparencia) y si es oscuro o claro. */
async function logoUri(url: string): Promise<{ uri: string; w: number; h: number; opaque: boolean } | null> {
  if (!url) return null;
  try {
    const input = await readMedia(url);
    const meta = await sharp(input).metadata();
    const { data, info } = await sharp(input).rotate().resize({ width: 700, height: 700, fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    return { uri: `data:image/png;base64,${data.toString("base64")}`, w: info.width, h: info.height, opaque: !meta.hasAlpha };
  } catch {
    return null;
  }
}

/** La placa del cierre: color de la marca, logo, eslogan, teléfono y web (JPEG del tamaño del video). */
export async function outroFrame(outro: VideoOutro, caption: string, size: Size): Promise<Buffer> {
  const font = await brandFont(outro.fontHeading);
  const { w, h: H } = size;
  const S = safeArea(w, H);
  const u = Math.min(w, H) / 1080;
  const c1 = hexOr(outro.color, "#126BBC");
  const [g1, g2] = gradientPair(c1, hexOr(outro.color2, ""));
  const deep = mix(g2, "#050a14", 0.25);
  const ink = inkForAll([g1, deep]);
  const dark = ink === "#ffffff";
  const logo = (await logoUri(dark && outro.logoLightUrl ? outro.logoLightUrl : outro.logoUrl)) ?? (outro.logoLightUrl ? await logoUri(outro.logoLightUrl) : null);
  const maxLogoW = Math.round((isStory(w, H) ? 620 : 520) * u);
  const maxLogoH = Math.round(260 * u);
  const scale = logo ? Math.min(maxLogoW / logo.w, maxLogoH / logo.h, 1.6) : 1;
  const innerW = w - S.left - S.right;
  const line = caption.trim() || outro.slogan || outro.name;
  const head = fitText({ text: line, maxW: innerW, maxH: H * 0.25, max: Math.round(88 * u), min: Math.round(40 * u), maxLines: 3, lineHeight: 1.12, measure: font.measure });
  // Sin emojis: la letra de la marca no los trae (y next/og los buscaría en internet).
  const contact = [outro.phone, outro.website && outro.website.replace(/^https?:\/\//i, "").replace(/\/+$/, "")].filter(Boolean) as string[];
  const small = Math.round(46 * u);
  const el = div(
    {
      width: w,
      height: H,
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: `${S.top}px ${S.right}px ${S.bottom}px ${S.left}px`,
      backgroundImage: `linear-gradient(160deg, ${g1} 0%, ${deep} 100%)`,
      fontFamily: font.name,
      color: ink,
    },
    logo
      ? div(
          { padding: logo.opaque || (dark && !outro.logoLightUrl) ? Math.round(22 * u) : 0, background: logo.opaque || (dark && !outro.logoLightUrl) ? "#ffffff" : "transparent", borderRadius: Math.round(24 * u), marginBottom: Math.round(48 * u) },
          h("img", { src: logo.uri, width: Math.round(logo.w * scale), height: Math.round(logo.h * scale), style: { objectFit: "contain" } }),
        )
      : div({ fontSize: Math.round(64 * u), fontWeight: 800, marginBottom: Math.round(36 * u) }, outro.name),
    div({ flexDirection: "column", alignItems: "center" }, ...head.lines.map((l) => div({ fontSize: head.size, fontWeight: 800, lineHeight: 1.12, textAlign: "center" }, l))),
    contact.length > 0 &&
      div(
        { flexDirection: "column", alignItems: "center", marginTop: Math.round(56 * u), gap: Math.round(14 * u) },
        ...contact.map((c) => div({ fontSize: small, fontWeight: 600, opacity: 0.95 }, c)),
      ),
  );
  return sharp(await png(el, size, font)).flatten({ background: c1 }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}

/** Lo que el render necesita de afuera (leer y guardar archivos): así se puede probar sin internet. */
export type RenderDeps = {
  read: (url: string) => Promise<Buffer>;
  /** Guarda un cuadro y devuelve su dirección pública (https). */
  upload: (data: Buffer, contentType: string) => Promise<string>;
  /** La dirección pública de un clip de video (se copia de Drive si hace falta). */
  clipUrl: (mediaId: string, url: string) => Promise<string>;
};

/** Ejecuta `fn` sobre la lista con `limit` a la vez, conservando el orden. */
async function pool<T, R>(list: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (next < list.length) {
        const i = next++;
        out[i] = await fn(list[i], i);
      }
    }),
  );
  return out;
}

/**
 * Dibuja y sube todos los cuadros del guion. Devuelve la línea de tiempo para FFmpeg compose (en milisegundos).
 * Fotos: la foto se decodifica una sola vez y cada cuadro es un recorte que se acerca o se mueve, con el texto.
 */
export async function renderKeyframes(sb: Storyboard, deps: RenderDeps, opts: { fps?: number; maxFrames?: number } = {}): Promise<{ keyframes: RenderJob["keyframes"]; totalMs: number; frames: number }> {
  const size = FORMAT_SIZE[sb.format];
  const media = new Map(sb.media.map((m) => [m.id, m]));
  const kinds = new Map(sb.media.map((m) => [m.id, m.kind]));
  const counts = frameCounts(sb.scenes, kinds, opts.fps, opts.maxFrames);
  const keyframes: RenderJob["keyframes"] = [];
  let t = 0;
  let frames = 0;
  for (const [i, scene] of sb.scenes.entries()) {
    const ms = Math.round(scene.durationSec * 1000);
    if (scene.role === "outro") {
      const url = await deps.upload(await outroFrame(sb.outro, scene.caption, size), "image/jpeg");
      keyframes.push({ url, timestamp: t, duration: ms });
      frames++;
    } else {
      const m = media.get(scene.mediaId);
      if (!m) continue;
      if (m.kind === "video") {
        // Los clips van tal cual (el texto encima solo se pone en las fotos).
        keyframes.push({ url: await deps.clipUrl(m.id, m.url), timestamp: t, duration: ms });
      } else {
        const overlay = await captionOverlay(scene.caption, scene.role, size, sb.outro);
        const decoded = await sharp(await deps.read(m.url)).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const src = { w: decoded.info.width, h: decoded.info.height };
        const raw = { width: src.w, height: src.h, channels: decoded.info.channels as 3 };
        const n = counts[i];
        const each = Math.floor(ms / n);
        const urls = await pool(Array.from({ length: n }, (_, k) => k), 6, async (k) => {
          const rect = kenBurnsRect(scene.motion, n === 1 ? 0.5 : k / (n - 1), src, size, m.focus);
          let img = sharp(decoded.data, { raw }).extract(rect).resize(size.w, size.h, { fit: "fill" });
          if (overlay) img = img.composite([{ input: overlay }]);
          return deps.upload(await img.jpeg({ quality: 80, mozjpeg: true }).toBuffer(), "image/jpeg");
        });
        urls.forEach((url, k) => keyframes.push({ url, timestamp: t + k * each, duration: k === n - 1 ? ms - each * (n - 1) : each }));
        frames += n;
      }
    }
    t += ms;
  }
  return { keyframes, totalMs: t, frames };
}

/** Un cuadro de muestra de una escena (para revisar el diseño sin crear el video). */
export async function sceneStill(sb: Storyboard, sceneId: string, deps: Pick<RenderDeps, "read">): Promise<Buffer> {
  const size = FORMAT_SIZE[sb.format];
  const scene = sb.scenes.find((s) => s.id === sceneId) ?? sb.scenes[0];
  if (scene.role === "outro") return outroFrame(sb.outro, scene.caption, size);
  const m = sb.media.find((x) => x.id === scene.mediaId);
  if (!m || m.kind === "video") return outroFrame(sb.outro, scene.caption, size);
  const decoded = await sharp(await deps.read(m.url)).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const src = { w: decoded.info.width, h: decoded.info.height };
  const overlay = await captionOverlay(scene.caption, scene.role, size, sb.outro);
  let img = sharp(decoded.data, { raw: { width: src.w, height: src.h, channels: decoded.info.channels as 3 } }).extract(kenBurnsRect(scene.motion, 0.5, src, size, m.focus)).resize(size.w, size.h, { fit: "fill" });
  if (overlay) img = img.composite([{ input: overlay }]);
  return img.jpeg({ quality: 85 }).toBuffer();
}
