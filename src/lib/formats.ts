// Tamaño de foto que pide cada red. Al publicar, la app manda a cada canal su versión
// (ver mediaForChannel en src/lib/media-formats.ts). Sin JSX ni servidor: se puede usar en pantalla.
import { DESIGN_SHAPES, type DesignShape } from "@/lib/design-shapes";

export type ChannelFormat = {
  /** Tamaño ideal (el diseño se vuelve a dibujar así). */
  shape: DesignShape;
  /** Proporciones (ancho/alto) que la red acepta tal cual; fuera de esto hay que adaptar la foto. */
  min: number;
  max: number;
  es: string;
  en: string;
};

/**
 * Formatos por canal (octubre 2026):
 * - Instagram feed: 1080×1350 (4:5) es lo que más ocupa en pantalla; acepta de 4:5 a 1.91:1.
 * - Facebook feed: 1080×1350 (4:5) también; acepta casi todo.
 * - Historias, Reels y TikTok: 1080×1920 (9:16) — TikTok solo acepta video.
 * - Google (Perfil de Negocio): 1200×900 (4:3).
 * - Artículo del sitio web: 1600×900 (16:9).
 * - Email: 1200×600 (2:1) arriba del correo.
 * - LinkedIn: 1080×1080 (1:1; acepta de 1:1.91 a 1.91:1); X: 1600×900 (16:9).
 * - Historias de Instagram y Facebook: 1080×1920 (9:16), ver STORY_FORMAT.
 */
export const CHANNEL_FORMATS: Partial<Record<string, ChannelFormat>> = {
  instagram: { shape: "portrait", min: 0.8, max: 1.91, es: "Instagram: vertical 4:5 (1080×1350)", en: "Instagram: portrait 4:5 (1080×1350)" },
  facebook: { shape: "portrait", min: 0.5, max: 2, es: "Facebook: vertical 4:5 (1080×1350)", en: "Facebook: portrait 4:5 (1080×1350)" },
  google: { shape: "google", min: 0.75, max: 1.8, es: "Google: 4:3 (1200×900)", en: "Google: 4:3 (1200×900)" },
  seo: { shape: "wide", min: 1.6, max: 1.9, es: "Sitio web: ancho 16:9 (1600×900)", en: "Website: wide 16:9 (1600×900)" },
  email: { shape: "email", min: 1.2, max: 2.2, es: "Email: ancho 2:1 (1200×600)", en: "Email: wide 2:1 (1200×600)" },
  linkedin: { shape: "square", min: 0.8, max: 1.91, es: "LinkedIn: cuadrada (1080×1080)", en: "LinkedIn: square (1080×1080)" },
  x: { shape: "wide", min: 0.75, max: 2, es: "X: ancho 16:9 (1600×900)", en: "X: wide 16:9 (1600×900)" },
};

/** Para videos: Reels, historias y TikTok van en 9:16. */
export const VIDEO_FORMAT = { w: 1080, h: 1920, es: "Video: vertical 9:16 (1080×1920) · Reels, historias y TikTok", en: "Video: vertical 9:16 (1080×1920) · Reels, Stories and TikTok" };

/** Historias (Instagram y Facebook): vertical 9:16, siempre en el tamaño exacto. */
export const STORY_FORMAT: ChannelFormat = { shape: "story", min: 0.55, max: 0.58, es: "Historia: vertical 9:16 (1080×1920)", en: "Story: portrait 9:16 (1080×1920)" };

/** Canales que publican historias de verdad; en los demás una historia sale como publicación normal. */
export const STORY_CHANNELS = ["instagram", "facebook"] as const;

/** El nombre del formato de un canal para un tipo de publicación: "instagram:story" para historias. */
export const formatKey = (channel: string, kind?: string): string => (kind === "story" && (STORY_CHANNELS as readonly string[]).includes(channel) ? `${channel}:story` : channel);

/** El formato de un canal ("instagram") o de su historia ("instagram:story"). */
export const formatFor = (channel: string): ChannelFormat | null => {
  const [c, kind] = channel.split(":");
  if (kind === "story") return (STORY_CHANNELS as readonly string[]).includes(c) ? STORY_FORMAT : null;
  return kind ? null : (CHANNEL_FORMATS[c] ?? null);
};
export const shapeSize = (shape: DesignShape) => DESIGN_SHAPES[shape];

/**
 * Cómo adaptar una foto de proporción `ratio` (ancho/alto) al canal:
 * - "keep": ya sirve tal cual.
 * - "crop": recortar al tamaño ideal (solo fotos sin letras, y si no se pierde demasiado; con `focus` se recorta
 *   alrededor de lo importante y se acepta perder un poco más).
 * - `exact`: la red necesita el tamaño exacto (carruseles: todas las fotos con la misma forma; historias).
 * - "fit": centrar sin cortar sobre un fondo desenfocado (diseños con letras o recortes grandes).
 */
export function adaptPlan(ratio: number, f: ChannelFormat, opts: { hasText: boolean; exact?: boolean; focus?: boolean }): "keep" | "crop" | "fit" {
  const { w, h } = DESIGN_SHAPES[f.shape];
  const want = w / h;
  if (Math.abs(ratio - want) / want < 0.03) return "keep";
  if (!opts.exact && ratio >= f.min - 0.005 && ratio <= f.max + 0.005 && opts.hasText) return "keep";
  if (opts.hasText) return "fit";
  // Parte de la foto que queda al recortar a la proporción ideal.
  const kept = ratio > want ? want / ratio : ratio / want;
  // Con el punto importante conocido se puede recortar un poco más sin perder lo que importa.
  return kept >= (opts.focus ? 0.4 : 0.6) ? "crop" : "fit";
}
