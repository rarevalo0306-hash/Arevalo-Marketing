// Tamaños, letras y plantillas de los diseños (sin JSX, para poder probarlos solos).
import { z } from "zod";

/**
 * Tamaños de los diseños. Los tres primeros se eligen en el compositor; los demás los usa la app sola
 * al publicar, para que cada red reciba su tamaño (ver src/lib/formats.ts).
 */
export const DESIGN_SHAPES = {
  square: { w: 1080, h: 1080, label: "Cuadrado (1:1) · Facebook e Instagram" },
  portrait: { w: 1080, h: 1350, label: "Vertical (4:5) · Instagram y Facebook" },
  story: { w: 1080, h: 1920, label: "Historia / Reel / TikTok (9:16)" },
  link: { w: 1200, h: 630, label: "Enlace (1.91:1) · Facebook, LinkedIn y X" },
  google: { w: 1200, h: 900, label: "Google (4:3) · Perfil de Negocio" },
  wide: { w: 1600, h: 900, label: "Ancho (16:9) · Artículo del sitio web" },
  email: { w: 1200, h: 600, label: "Email (2:1) · Encabezado del correo" },
} as const;
export type DesignShape = keyof typeof DESIGN_SHAPES;

/** Letras para titulares (los archivos están en src/assets/fonts). */
export const FONTS = {
  montserrat: { name: "Montserrat", semi: 600, bold: 800 },
  poppins: { name: "Poppins", semi: 600, bold: 800 },
  inter: { name: "Inter", semi: 600, bold: 800 },
  oswald: { name: "Oswald", semi: 500, bold: 700 },
  "playfair-display": { name: "Playfair Display", semi: 600, bold: 800 },
} as const;
export type FontId = keyof typeof FONTS;
export const fontId = (v: string): FontId => (v in FONTS ? (v as FontId) : "montserrat");

/**
 * Letras para el texto pequeño (teléfono, web, pasos). El kit de marca guarda el nombre libre
 * (por ejemplo "IBM Plex Sans"); si no la tenemos, se usa la letra de los titulares.
 */
export const BODY_FONTS = {
  "ibm-plex-sans": { name: "IBM Plex Sans", regular: 500, semi: 600 },
  "open-sans": { name: "Open Sans", regular: 500, semi: 600 },
  roboto: { name: "Roboto", regular: 500, semi: 700 },
  lato: { name: "Lato", regular: 400, semi: 700 },
} as const;
export type BodyFontId = keyof typeof BODY_FONTS;
export function bodyFontId(name: string): BodyFontId | null {
  const key = name.trim().toLowerCase().replace(/\s+/g, "-");
  return key in BODY_FONTS ? (key as BodyFontId) : null;
}

/**
 * Una plantilla es una receta de diseño: la IA las crea para cada marca y quedan guardadas.
 * El motor de diseño (design.tsx) dibuja cualquier combinación de estas opciones.
 */
export const LAYOUTS = ["foto-completa", "franja-arriba", "franja-abajo", "mitad-izquierda", "color-solido", "lista"] as const;
export const TemplateSpec = z.object({
  name: z.string().describe("Nombre corto en español para la plantilla, 1-3 palabras"),
  layout: z.enum(LAYOUTS).describe("foto-completa: foto de fondo con texto encima; franja-arriba: bloque de color arriba con el titular y foto abajo; franja-abajo: foto arriba y bloque de color abajo (con fondo blanco es una tarjeta blanca flotando sobre la foto); mitad-izquierda: color a la izquierda con texto y foto a la derecha; color-solido: sin foto, frase grande sobre color; lista: titular y hasta 3 pasos numerados"),
  textPosition: z.enum(["arriba", "centro", "abajo"]).describe("Dónde va el titular (en foto-completa y color-solido)"),
  align: z.enum(["izquierda", "centro"]),
  background: z.enum(["color1", "color2", "color3", "degradado", "blanco"]).describe("Color de los bloques de color"),
  overlay: z.enum(["ninguna", "suave", "fuerte"]).describe("Oscurecer la foto para que el texto se lea"),
  accent: z.enum(["barra", "circulos", "comillas", "ninguno"]).describe("Detalle decorativo"),
  headlineScale: z.number().min(0.8).max(1.3).describe("Tamaño del titular: 1 es normal"),
  uppercase: z.boolean().describe("Titular en mayúsculas"),
  contactStyle: z.enum(["pastilla", "franja", "texto"]).describe("Cómo se muestra el teléfono y el sitio web"),
  logoPosition: z.enum(["arriba-izquierda", "arriba-derecha", "abajo-derecha"]),
});
export type TemplateSpec = z.infer<typeof TemplateSpec>;

/**
 * Plantilla propia que sube el dueño: una imagen (marco con una parte transparente, o un fondo) y
 * dónde van la foto y el titular. Se guarda en Template.spec junto con los campos de TemplateSpec,
 * así el resto de la app la trata como cualquier otra plantilla.
 */
export const PHOTO_SPOTS = ["completa", "arriba", "abajo", "izquierda", "derecha", "centro", "ninguna"] as const;
export const TEXT_SPOTS = ["arriba", "centro", "abajo", "ninguno"] as const;
export const CustomSpec = z.object({
  imageUrl: z.string().max(2000),
  /** Tamaño original de la imagen subida (para respetar su forma). */
  w: z.number().int().min(100).max(10000),
  h: z.number().int().min(100).max(10000),
  /** marco: la imagen va ENCIMA de la foto (tiene partes transparentes). fondo: la imagen va DEBAJO y la foto en un recuadro. */
  mode: z.enum(["marco", "fondo"]),
  photo: z.enum(PHOTO_SPOTS),
  text: z.enum(TEXT_SPOTS),
  /** Color de las letras del titular. */
  ink: z.enum(["claro", "oscuro", "marca"]),
});
export type CustomSpec = z.infer<typeof CustomSpec>;
export type Box = { x: number; y: number; w: number; h: number };
/** Dónde va la foto en una plantilla de fondo (en fracciones del lienzo). */
export const PHOTO_BOXES: Record<Exclude<CustomSpec["photo"], "completa" | "ninguna">, Box> = {
  arriba: { x: 0.06, y: 0.06, w: 0.88, h: 0.5 },
  abajo: { x: 0.06, y: 0.44, w: 0.88, h: 0.5 },
  izquierda: { x: 0.06, y: 0.06, w: 0.44, h: 0.88 },
  derecha: { x: 0.5, y: 0.06, w: 0.44, h: 0.88 },
  centro: { x: 0.12, y: 0.18, w: 0.76, h: 0.5 },
};
/** Dónde va el titular (en fracciones del lienzo). Si la foto ocupa un lado, el titular va en el otro. */
export function textBox(c: Pick<CustomSpec, "photo" | "text">): Box | null {
  if (c.text === "ninguno") return null;
  if (c.photo === "izquierda") return { x: 0.54, y: c.text === "arriba" ? 0.08 : c.text === "centro" ? 0.3 : 0.54, w: 0.4, h: 0.38 };
  if (c.photo === "derecha") return { x: 0.06, y: c.text === "arriba" ? 0.08 : c.text === "centro" ? 0.3 : 0.54, w: 0.4, h: 0.38 };
  return { x: 0.07, y: c.text === "arriba" ? 0.07 : c.text === "centro" ? 0.36 : 0.6, w: 0.86, h: 0.25 };
}

export const StoredTemplate = TemplateSpec.extend({ custom: CustomSpec.optional() });
export type StoredTemplate = z.infer<typeof StoredTemplate>;

/** Los campos de TemplateSpec para una plantilla propia (para que el resto de la app sepa si necesita foto). */
export function customBase(name: string, c: CustomSpec): StoredTemplate {
  return {
    name,
    layout: c.photo === "ninguna" ? "color-solido" : "foto-completa",
    textPosition: c.text === "ninguno" ? "abajo" : c.text,
    align: "izquierda",
    background: "color1",
    overlay: "ninguna",
    accent: "ninguno",
    headlineScale: 1,
    uppercase: false,
    contactStyle: "texto",
    logoPosition: "arriba-izquierda",
    custom: c,
  };
}

/**
 * Plantillas de fábrica (se usan si el negocio todavía no tiene plantillas propias).
 * Limpias y legibles: mucho aire, una sola idea por imagen, el titular grande y el contacto discreto.
 */
export const BUILTIN_TEMPLATES: TemplateSpec[] = [
  { name: "Consejo", layout: "foto-completa", textPosition: "abajo", align: "izquierda", background: "color1", overlay: "fuerte", accent: "barra", headlineScale: 1, uppercase: false, contactStyle: "texto", logoPosition: "arriba-izquierda" },
  { name: "Tarjeta", layout: "franja-abajo", textPosition: "abajo", align: "izquierda", background: "blanco", overlay: "ninguna", accent: "barra", headlineScale: 1, uppercase: false, contactStyle: "texto", logoPosition: "arriba-izquierda" },
  { name: "Titular arriba", layout: "franja-arriba", textPosition: "arriba", align: "izquierda", background: "degradado", overlay: "ninguna", accent: "ninguno", headlineScale: 1, uppercase: false, contactStyle: "texto", logoPosition: "arriba-izquierda" },
  { name: "Mitad y mitad", layout: "mitad-izquierda", textPosition: "centro", align: "izquierda", background: "color1", overlay: "ninguna", accent: "barra", headlineScale: 1, uppercase: false, contactStyle: "texto", logoPosition: "arriba-izquierda" },
  { name: "Pregunta", layout: "color-solido", textPosition: "centro", align: "izquierda", background: "degradado", overlay: "ninguna", accent: "comillas", headlineScale: 1.1, uppercase: false, contactStyle: "texto", logoPosition: "arriba-izquierda" },
  { name: "Pasos", layout: "lista", textPosition: "arriba", align: "izquierda", background: "degradado", overlay: "suave", accent: "ninguno", headlineScale: 0.9, uppercase: false, contactStyle: "franja", logoPosition: "arriba-izquierda" },
];

/** Nombres en inglés de las plantillas de fábrica, solo para mostrarlas en la app. */
const BUILTIN_NAME_EN: Record<string, string> = {
  Consejo: "Tip",
  Tarjeta: "Card",
  "Titular arriba": "Headline on top",
  "Mitad y mitad": "Split",
  Pregunta: "Question",
  Pasos: "Steps",
};
/** Nombre de una plantilla de fábrica en el idioma de la app (las propias se muestran como están). */
export const builtinTemplateName = (name: string, lang: "es" | "en") => (lang === "en" ? (BUILTIN_NAME_EN[name] ?? name) : name);

export const needsPhoto = (t: TemplateSpec) => !["color-solido", "lista"].includes(t.layout);

/**
 * Elige la plantilla para un post. Con una elegida, la usa (si es de pasos pero no hay pasos, o
 * necesita foto y no hay, busca otra). En automático: lista si hay 2+ pasos, color si es pregunta
 * o no hay foto, y si no rota entre las de foto.
 */
export function pickTemplate<T extends TemplateSpec>(list: T[], chosen: number, opts: { headline: string; steps?: string[]; hasPhoto: boolean; seed?: number }): T | TemplateSpec {
  const all: (T | TemplateSpec)[] = list.length ? list : BUILTIN_TEMPLATES;
  const steps = (opts.steps ?? []).filter((s) => s.trim()).length;
  const ok = (t: TemplateSpec) => (t.layout === "lista" ? steps >= 2 : true) && (needsPhoto(t) ? opts.hasPhoto : true);
  const picked = all[chosen];
  if (picked && ok(picked)) return picked;
  const find = (pred: (t: TemplateSpec) => boolean) => all.filter((t) => pred(t) && ok(t));
  const lists = find((t) => t.layout === "lista");
  if (steps >= 2 && lists.length) return lists[0];
  const solids = find((t) => t.layout === "color-solido");
  if ((/\?\s*$/.test(opts.headline.trim()) || !opts.hasPhoto) && solids.length) return solids[(opts.seed ?? 0) % solids.length];
  const photos = find((t) => needsPhoto(t));
  if (photos.length) return photos[(opts.seed ?? 0) % photos.length];
  return find(() => true)[0] ?? BUILTIN_TEMPLATES[4];
}

/** Titulares más largos usan letra más chica para que siempre quepan. `width` es el ancho del texto en una imagen de 1080. */
export function headlineSize(text: string, width: number): number {
  const n = text.length;
  const base = n <= 24 ? 96 : n <= 36 ? 84 : n <= 50 ? 74 : n <= 66 ? 64 : 56;
  return Math.round((base * width) / 1080);
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export const hexOr = (v: string | undefined, fallback: string) => (v && HEX.test(v) ? v : fallback);

// ---------- Colores (contraste y mezclas) ----------

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
/** Mezcla dos colores: t=0 da `a`, t=1 da `b`. */
export const mix = (a: string, b: string, t: number) => {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
};
/** Luminancia relativa (WCAG). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** Color del texto encima de un color: blanco si se lee bien; si no, casi negro. */
export const inkOn = (bg: string, dark = "#0f172a") => (contrast(bg, "#ffffff") >= 3 ? "#ffffff" : dark);
/** rgba() de un color hex. */
export const rgba = (hex: string, a: number) => `rgba(${rgb(hex).join(",")},${a})`;
