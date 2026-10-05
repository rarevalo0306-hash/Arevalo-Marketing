// Tamaños, letras y plantillas de los diseños (sin JSX, para poder probarlos solos).
import { z } from "zod";

export const DESIGN_SHAPES = {
  square: { w: 1080, h: 1080, label: "Cuadrado (1:1) · Facebook e Instagram" },
  portrait: { w: 1080, h: 1350, label: "Vertical (4:5) · Instagram" },
  story: { w: 1080, h: 1920, label: "Historia / Reel (9:16)" },
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
 * Una plantilla es una receta de diseño: la IA las crea para cada marca y quedan guardadas.
 * El motor de diseño (design.tsx) dibuja cualquier combinación de estas opciones.
 */
export const LAYOUTS = ["foto-completa", "franja-arriba", "franja-abajo", "mitad-izquierda", "color-solido", "lista"] as const;
export const TemplateSpec = z.object({
  name: z.string().describe("Nombre corto en español para la plantilla, 1-3 palabras"),
  layout: z.enum(LAYOUTS).describe("foto-completa: foto de fondo con texto encima; franja-arriba: bloque de color arriba con el titular y foto abajo; franja-abajo: foto arriba y bloque de color abajo; mitad-izquierda: color a la izquierda con texto y foto a la derecha; color-solido: sin foto, frase grande sobre color; lista: titular y hasta 3 pasos numerados"),
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

/** Plantillas de fábrica (se usan si el negocio todavía no tiene plantillas propias). */
export const BUILTIN_TEMPLATES: TemplateSpec[] = [
  { name: "Consejo", layout: "foto-completa", textPosition: "abajo", align: "izquierda", background: "color1", overlay: "fuerte", accent: "barra", headlineScale: 1, uppercase: false, contactStyle: "pastilla", logoPosition: "arriba-izquierda" },
  { name: "Titular arriba", layout: "franja-arriba", textPosition: "abajo", align: "izquierda", background: "degradado", overlay: "ninguna", accent: "ninguno", headlineScale: 0.9, uppercase: false, contactStyle: "pastilla", logoPosition: "arriba-izquierda" },
  { name: "Pregunta", layout: "color-solido", textPosition: "centro", align: "izquierda", background: "degradado", overlay: "ninguna", accent: "comillas", headlineScale: 1.15, uppercase: false, contactStyle: "pastilla", logoPosition: "arriba-izquierda" },
  { name: "Pasos", layout: "lista", textPosition: "arriba", align: "izquierda", background: "degradado", overlay: "suave", accent: "ninguno", headlineScale: 0.8, uppercase: false, contactStyle: "pastilla", logoPosition: "arriba-izquierda" },
];

export const needsPhoto = (t: TemplateSpec) => !["color-solido", "lista"].includes(t.layout);

/**
 * Elige la plantilla para un post. Con una elegida, la usa (si es de pasos pero no hay pasos, o
 * necesita foto y no hay, busca otra). En automático: lista si hay 2+ pasos, color si es pregunta
 * o no hay foto, y si no rota entre las de foto.
 */
export function pickTemplate(list: TemplateSpec[], chosen: number, opts: { headline: string; steps?: string[]; hasPhoto: boolean; seed?: number }): TemplateSpec {
  const all = list.length ? list : BUILTIN_TEMPLATES;
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
  return find(() => true)[0] ?? BUILTIN_TEMPLATES[2];
}

/** Titulares más largos usan letra más chica para que siempre quepan. */
export function headlineSize(text: string, width: number): number {
  const n = text.length;
  const base = n <= 28 ? 84 : n <= 45 ? 70 : n <= 65 ? 58 : 50;
  return Math.round((base * width) / 1080);
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export const hexOr = (v: string | undefined, fallback: string) => (v && HEX.test(v) ? v : fallback);
