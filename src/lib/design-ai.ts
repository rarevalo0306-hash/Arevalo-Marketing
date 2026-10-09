// Diseños maestros con IA: una IA de diseño de primer nivel crea UNA vez el diseño principal de la marca (un fondo con
// un espacio vacío para la foto y otro para el titular); después cada post lo usa como plantilla propia y el motor de
// diseño (design.tsx) pone la foto, el titular y el logo real, casi gratis. Aquí está lo que no necesita servidor:
// la tabla de modelos, el texto que se le pide a la IA, cómo se arma cada pedido, y cómo se leen las cajas.
//
// ============================== Investigación (octubre 2026) ==============================
// Precios por imagen en las páginas oficiales de fal.ai y en developer.ideogram.ai (esquemas OpenAPI de fal:
// https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>). Todos permiten uso comercial («Commercial use»
// en fal.ai; Ideogram: «you're free to use them for any purpose, including commercial use»).
//
// • Ideogram 3.0 directo (api.ideogram.ai, clave IDEOGRAM_API_KEY, encabezado `Api-Key`)
//   POST https://api.ideogram.ai/v2/image/generate/ideogram-3 — JSON, o multipart para `style_reference_images`.
//   Campos: prompt, negative_prompt, aspect_ratio ("1x1" | "4x5" | "9x16" | …), rendering_speed ("turbo" | "default" |
//   "quality"), magic_prompt ("auto" | "on" | "off"), style_type ("auto" | "general" | "realistic" | "design" | …),
//   color_palette ({ members: [{ color_hex, color_weight }] } o { name }), style_reference_images (hasta 10),
//   num_images, seed, async (true → generation_id; se consulta GET /v2/generations/{id}: pending | completed | failed).
//   Errores: 401 clave, 402 sin créditos (reject_reason insufficient_funds…), 422 seguridad, 429 límite.
//   Las URLs de las imágenes caducan: se descargan y se guardan enseguida. Precio: Turbo US$0.03, Default US$0.06,
//   Quality US$0.09 (con referencia de personaje US$0.10/0.15/0.20). Usamos Quality.
//   (Ideogram 4.0 / 4.5 también existen —/v2/image/generate/ideogram-4-5, ~US$0.22 en calidad alta según terceros—,
//   pero todavía no aceptan paleta de colores, negative prompt ni referencias de estilo; por eso usamos 3.0.)
// • fal-ai/ideogram/v3 — lo mismo vía fal.ai: rendering_speed TURBO US$0.03 | BALANCED US$0.06 | QUALITY US$0.09;
//   style "DESIGN", color_palette { members: [{ rgb: {r,g,b}, color_weight }] }, negative_prompt, image_urls (estilo),
//   expand_prompt, image_size (presets o { width, height }).
// • fal-ai/nano-banana-pro (Google Gemini 3 Pro Image) — US$0.15 por imagen en 1K/2K (4K el doble). aspect_ratio
//   "1:1" | "4:5" | "9:16" | …, resolution "1K" | "2K" | "4K", output_format. Con imágenes de referencia:
//   fal-ai/nano-banana-pro/edit (image_urls, hasta 14). Muy buena composición; marca de agua SynthID invisible.
// • fal-ai/gpt-image-2 (OpenAI GPT Image 2) — calidad alta: 1024×1024 US$0.211, 1024×1536 US$0.165, 1024×768 US$0.145
//   (media US$0.053). image_size preset o { width, height } (múltiplos de 16). Con referencia:
//   fal-ai/gpt-image-2/image-to-image (image_urls). Sin paleta ni negative prompt.
// • fal-ai/recraft/v4/pro/text-to-image (Recraft V4 Pro) — US$0.25; fal-ai/recraft/v4/text-to-image US$0.04.
//   colors [{r,g,b}], background_color, image_size. Pensado para sistemas de marca. Sin negative prompt ni referencia.
//   (Recraft v3: US$0.04 raster / US$0.08 vector, con style_id y estilos.)
//
// Decisiones: el diseño maestro NO lleva letras (ni titular, ni nombre, ni eslogan) y ninguna IA dibuja el logo: el
// logo real lo pone la app en su caja (logoBox) y el titular se dibuja con las letras de la marca. Así nunca hay logos
// inventados ni nombres mal escritos. La foto va en un rectángulo gris liso (#D9D9D9) que luego se tapa con la foto
// (modo «fondo»): así la caja se encuentra sola aunque falle la IA que mira la imagen.
// Para «Hacer más con este estilo» se manda el diseño aceptado como referencia de estilo a los modelos que la aceptan.
// =========================================================================================
import { z } from "zod";
import { falPoll, falSubmit, type FalJob } from "@/lib/fal";
import { BODY_FONTS, bodyFontId, contrast, fontId, FONTS, hexOr, MASTER_SHAPES, type Box, type MasterShape } from "@/lib/design-shapes";
import { bi } from "@/lib/i18n";
import { colorName } from "@/lib/imagegen";

export { MASTER_SHAPES, type MasterShape };

// ---------- Tabla de modelos (cambiar modelos o precios sin tocar código: DESIGN_AI_MODELS) ----------

export type DesignModel = {
  /** Id corto que se guarda y se usa en DESIGN_AI_MODELS. */
  id: string;
  name: string;
  maker: string;
  provider: "fal" | "ideogram";
  /** Modelo de fal.ai o ruta de la API de Ideogram. */
  endpoint: string;
  /** El que se usa cuando se manda una imagen de referencia de estilo (si es otro). */
  refEndpoint?: string;
  /** Precio por imagen (US$) en cada forma. */
  usd: Record<MasterShape, number>;
  /** Precio aproximado (la página oficial no lista esa forma exacta). */
  approx?: boolean;
  env: "FAL_KEY" | "IDEOGRAM_API_KEY";
  palette: boolean;
  negative: boolean;
  styleRef: boolean;
  maxPrompt?: number;
  /** Segundos típicos (para la barra de avance). */
  etaSec: number;
  /** Si este está disponible, se esconde el otro (Ideogram directo gana sobre Ideogram por fal.ai). */
  replaces?: string;
  /** Marcado al abrir «Comparar modelos». */
  defaultOn: boolean;
  /**
   * Editar una imagen (para «Convertir en plantilla» una pieza del manual: quitar el texto de ejemplo y poner la caja
   * gris donde iba la foto, sin cambiar nada más). Precio por imagen.
   */
  edit?: { endpoint: string; usd: number; approx?: boolean; name?: string };
  good: { es: string; en: string };
};

const flat = (usd: number): Record<MasterShape, number> => ({ square: usd, portrait: usd, story: usd });

export const DESIGN_MODELS: DesignModel[] = [
  {
    id: "ideogram",
    name: "Ideogram 3.0",
    maker: "Ideogram",
    provider: "ideogram",
    endpoint: "v2/image/generate/ideogram-3",
    usd: flat(0.09),
    env: "IDEOGRAM_API_KEY",
    palette: true,
    negative: true,
    styleRef: true,
    etaSec: 25,
    replaces: "ideogram-fal",
    defaultOn: true,
    // Ideogram 4.5 «Precise Edit»: copia exacto lo que no se pide cambiar (calidad media ~US$0.06, precio de terceros).
    edit: { endpoint: "v2/image/precise-edit/ideogram-4-5", usd: 0.06, approx: true, name: "Ideogram 4.5 Precise Edit" },
    good: { es: "Diseño gráfico y colores exactos de tu marca", en: "Graphic design and your exact brand colors" },
  },
  {
    id: "ideogram-fal",
    name: "Ideogram 3.0",
    maker: "Ideogram (fal.ai)",
    provider: "fal",
    endpoint: "fal-ai/ideogram/v3",
    usd: flat(0.09),
    env: "FAL_KEY",
    palette: true,
    negative: true,
    styleRef: true,
    etaSec: 30,
    defaultOn: true,
    good: { es: "Diseño gráfico y colores exactos de tu marca", en: "Graphic design and your exact brand colors" },
  },
  {
    id: "nano-banana-pro",
    name: "Nano Banana Pro",
    maker: "Google (fal.ai)",
    provider: "fal",
    endpoint: "fal-ai/nano-banana-pro",
    refEndpoint: "fal-ai/nano-banana-pro/edit",
    usd: flat(0.15),
    env: "FAL_KEY",
    palette: false,
    negative: false,
    styleRef: true,
    etaSec: 40,
    defaultOn: true,
    edit: { endpoint: "fal-ai/nano-banana-pro/edit", usd: 0.15 },
    good: { es: "Composición muy cuidada", en: "Very polished composition" },
  },
  {
    id: "gpt-image-2",
    name: "GPT Image 2",
    maker: "OpenAI (fal.ai)",
    provider: "fal",
    endpoint: "fal-ai/gpt-image-2",
    refEndpoint: "fal-ai/gpt-image-2/image-to-image",
    usd: { square: 0.22, portrait: 0.22, story: 0.17 },
    approx: true,
    env: "FAL_KEY",
    palette: false,
    negative: false,
    styleRef: true,
    etaSec: 60,
    defaultOn: true,
    edit: { endpoint: "fal-ai/gpt-image-2/image-to-image", usd: 0.22, approx: true },
    good: { es: "Sigue muy bien las instrucciones", en: "Follows instructions very closely" },
  },
  {
    id: "recraft-v4-pro",
    name: "Recraft V4 Pro",
    maker: "Recraft (fal.ai)",
    provider: "fal",
    endpoint: "fal-ai/recraft/v4/pro/text-to-image",
    usd: flat(0.25),
    env: "FAL_KEY",
    palette: true,
    negative: false,
    styleRef: false,
    maxPrompt: 1000,
    etaSec: 35,
    defaultOn: true,
    good: { es: "Pensado para sistemas de marca", en: "Built for brand systems" },
  },
  {
    id: "recraft-v4",
    name: "Recraft V4",
    maker: "Recraft (fal.ai)",
    provider: "fal",
    endpoint: "fal-ai/recraft/v4/text-to-image",
    usd: flat(0.04),
    env: "FAL_KEY",
    palette: true,
    negative: false,
    styleRef: false,
    maxPrompt: 1000,
    etaSec: 25,
    defaultOn: false,
    good: { es: "La opción económica", en: "The budget option" },
  },
];

const DEFAULT_LIST = "ideogram,ideogram-fal,nano-banana-pro,gpt-image-2,recraft-v4-pro,recraft-v4";

type Env = Record<string, string | undefined>;

/** "ideogram,gpt-image-2:0.25" → ids en orden, con precio propio opcional (US$ por imagen). Los ids desconocidos se ignoran. */
export function parseModelList(raw: string | undefined): { id: string; usd?: number }[] {
  const out: { id: string; usd?: number }[] = [];
  for (const part of (raw || DEFAULT_LIST).split(",")) {
    const [id, price] = part.trim().split(":").map((x) => x.trim());
    if (!id || out.some((o) => o.id === id) || !DESIGN_MODELS.some((m) => m.id === id)) continue;
    const usd = price ? Number(price) : NaN;
    out.push(Number.isFinite(usd) && usd > 0 && usd < 10 ? { id, usd } : { id });
  }
  return out;
}

/** Los modelos que se pueden usar con las claves del servidor, en el orden de DESIGN_AI_MODELS. */
export function designModels(env: Env = process.env): DesignModel[] {
  const list = parseModelList(env.DESIGN_AI_MODELS)
    .map(({ id, usd }) => {
      const m = DESIGN_MODELS.find((x) => x.id === id)!;
      return usd ? { ...m, usd: flat(usd), approx: false } : m;
    })
    .filter((m) => Boolean(env[m.env]?.trim()));
  const hidden = new Set(list.map((m) => m.replaces).filter(Boolean));
  return list.filter((m) => !hidden.has(m.id));
}

export const designModel = (id: string, env: Env = process.env) => designModels(env).find((m) => m.id === id) ?? null;

/** Orden para editar piezas del manual: el que mejor respeta todo lo demás primero. */
const EDIT_ORDER = ["ideogram", "nano-banana-pro", "gpt-image-2"];
/** Los modelos que pueden editar una imagen, con las claves del servidor, el mejor primero. */
export function editModels(env: Env = process.env): (DesignModel & { edit: NonNullable<DesignModel["edit"]> })[] {
  return designModels(env)
    .filter((m): m is DesignModel & { edit: NonNullable<DesignModel["edit"]> } => Boolean(m.edit))
    .sort((a, b) => EDIT_ORDER.indexOf(a.id) - EDIT_ORDER.indexOf(b.id));
}

/** Tope de gasto por cada vez que se pide crear diseños (US$). DESIGN_AI_MAX_USD, por defecto 1.00. */
export function maxUsd(env: Env = process.env): number {
  const n = Number(env.DESIGN_AI_MAX_USD);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Lo que cuesta crear estos diseños (cada modelo en cada forma). */
export function estimateUsd(models: Pick<DesignModel, "usd">[], shapes: MasterShape[]): number {
  return Math.round(models.reduce((a, m) => a + shapes.reduce((b, s) => b + m.usd[s], 0), 0) * 1000) / 1000;
}
export const usdText = (usd: number) => `US$${usd.toFixed(2)}`;

// ---------- Lo que se le pide a la IA (director de arte) ----------

export type MasterBrief = {
  name: string;
  /** Qué hace el negocio (perfil del negocio, una o dos frases). */
  about: string;
  color: string;
  color2?: string;
  color3?: string;
  fontHeading?: string;
  fontBody?: string;
  /** Personalidad de la marca (identidad): "cercana", "experta"… */
  personality?: string[];
  /** Estilo de fotos de la identidad (para el ánimo del diseño). */
  photoStyle?: string;
  audience?: string;
};

const FONT_STYLE: Record<string, string> = {
  montserrat: "a geometric, modern and confident sans-serif",
  poppins: "a friendly, rounded geometric sans-serif",
  inter: "a clean, neutral contemporary sans-serif",
  oswald: "a tall, condensed, bold industrial sans-serif",
  "playfair-display": "an elegant, high-contrast editorial serif",
  "ibm-plex-sans": "a precise, technical sans-serif",
  "open-sans": "an open, friendly humanist sans-serif",
  roboto: "a straightforward, modern sans-serif",
  lato: "a warm, balanced humanist sans-serif",
};

/** Cómo se ven las letras de la marca, en palabras (las IAs de imagen no conocen los nombres de todas). */
export function fontStyleText(heading?: string, body?: string): string {
  const h = fontId(heading ?? "");
  const b = bodyFontId(body ?? "");
  const head = `headings in ${FONTS[h].name} (${FONT_STYLE[h]})`;
  return b ? `${head}, body text in ${BODY_FONTS[b].name} (${FONT_STYLE[b]})` : head;
}

const SHAPE_TEXT: Record<MasterShape, { ratio: string; label: string; layout: string }> = {
  square: {
    ratio: "1:1",
    label: "square social media post (1080×1080)",
    layout:
      "Photo area: one large rectangle in the upper part, about 85-90% of the width and 50-58% of the height, with even margins. Headline area: a calm empty band below the photo area, about 22-28% of the height. Logo spot: a small empty space (about 25% wide, 8% tall) in a corner that touches neither area.",
  },
  portrait: {
    ratio: "4:5",
    label: "vertical social media post (1080×1350, 4:5)",
    layout:
      "Photo area: one large rectangle in the upper part, about 85-90% of the width and 50-55% of the height, with even margins. Headline area: a calm empty band below the photo area, about 25% of the height. Logo spot: a small empty space (about 25% wide, 7% tall) in a corner that touches neither area.",
  },
  story: {
    ratio: "9:16",
    label: "full-screen vertical story (1080×1920, 9:16)",
    layout:
      "Keep the top 14% and the bottom 20% free of important elements (the apps put their buttons there; decoration only). Photo area: one large rectangle in the middle, about 85-90% of the width and 38-45% of the height. Headline area: a calm empty band right below the photo area, about 18-22% of the height, still above the bottom 20%. Logo spot: a small empty space (about 30% wide, 6% tall) just below the top 14%.",
  },
};

/** Gris de la caja de la foto: se pide liso para poder encontrarla en la imagen sin otra IA. */
export const PLACEHOLDER = "#D9D9D9";

const NEGATIVE =
  "text, letters, words, typography, numbers, captions, slogans, brand names, logos, logo marks, monograms, watermarks, signatures, icons with letters, people, faces, hands, photographs, mockups, devices, anything inside the gray photo area, clutter, busy background, low contrast, blurry, 3D render";

/**
 * El pedido del director de arte: la marca (qué hace, colores, letras, personalidad), la forma, y la instrucción de
 * diseño (caja gris vacía para la foto, zona limpia para el titular, rincón para el logo, nada de letras).
 */
export function masterPrompt(b: MasterBrief, shape: MasterShape, opts: { styleRef?: boolean | "book"; compact?: boolean } = {}): { prompt: string; negative: string } {
  const s = SHAPE_TEXT[shape];
  const colors = [b.color, b.color2, b.color3].map((c) => hexOr(c, "")).filter(Boolean);
  const named = colors.map((c, i) => `${["primary", "secondary", "accent"][i]} ${c.toUpperCase()}${colorName(c) ? ` (${colorName(c)})` : ""}`);
  const about = b.about.replace(/\s+/g, " ").trim().slice(0, opts.compact ? 160 : 420);
  const mood = (b.personality ?? []).filter(Boolean).slice(0, 5).join(", ");
  const photoMood = (b.photoStyle ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
  const ref =
    opts.styleRef === "book"
      ? "The reference images are this brand's own social media templates from its brand book: follow their visual style exactly (colors, shapes, decoration, footer band, finish), but create a new clean layout following the instructions below, without copying their text, photos or logo. "
      : opts.styleRef
        ? "Use the reference image as the style guide: the same design system, colors, shapes, decoration and finish, re-composed for this new canvas shape. "
        : "";
  if (opts.compact) {
    return {
      prompt: `${ref}Flat graphic-design master template for a ${s.label} for "${b.name}"${about ? `, ${about}` : ""}. Brand colors ${named.join(", ")}. ${s.layout} Photo area is a flat solid light gray (${PLACEHOLDER}) rectangle, completely empty. Headline area completely empty. Decorate only around them with subtle shapes, lines and corner accents in the brand colors; premium, modern, generous margins. Absolutely no text, letters, numbers, logos or people.`.slice(0, 1000),
      negative: NEGATIVE,
    };
  }
  const prompt = [
    `${ref}You are a senior brand designer. Create a reusable MASTER TEMPLATE (a background design) for a ${s.label} (aspect ratio ${s.ratio}) for the business "${b.name}"${about ? ` — ${about}` : ""}.`,
    `Brand colors: ${named.join(", ")}. Use exactly these colors as the dominant palette; white and a near-black are allowed as neutrals.`,
    `Typography feel of the brand: ${fontStyleText(b.fontHeading, b.fontBody)}; echo that personality in the shapes (no actual letters).`,
    mood ? `Brand personality: ${mood}.` : "",
    b.audience ? `It speaks to: ${b.audience.replace(/\s+/g, " ").slice(0, 200)}.` : "",
    photoMood ? `The photos that will go in it look like this: ${photoMood}` : "",
    `LAYOUT (most important): ${s.layout}`,
    `- The photo area is ONE clean, clearly bounded rectangle filled with flat solid light gray ${PLACEHOLDER}: nothing inside it, no texture, no gradient, no shadow inside, crisp edges (slightly rounded corners are fine). A real photo will be placed there later.`,
    "- The headline area is a calm, flat, uncluttered panel (a brand color or white) with strong contrast, completely EMPTY: no text, no lines, no shapes inside it. The real headline will be typeset there later.",
    "- The logo spot is empty too; the real logo is added later.",
    "- Decorate only around these areas: subtle geometric shapes, thin lines, frames, dots, corner accents, a light texture or gradient in the brand colors. Professional, modern, premium and balanced, with generous margins, like a top agency's social media template.",
    "- Absolutely no text, letters, numbers, words, fake logos, brand names, icons with letters, watermarks, mockups, people or photographs anywhere.",
    "Style: flat graphic design, vector-like, crisp edges, print quality.",
  ]
    .filter(Boolean)
    .join("\n");
  return { prompt, negative: NEGATIVE };
}

// ---------- Cómo se arma cada pedido ----------

const rgbOf = (hex: string) => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });
/** Los colores de la marca (válidos, sin repetir) con su peso: el principal pesa más. */
export function paletteOf(b: Pick<MasterBrief, "color" | "color2" | "color3">): { hex: string; weight: number }[] {
  const list = [...new Set([b.color, b.color2, b.color3].map((c) => hexOr(c, "").toUpperCase()).filter(Boolean))];
  const weights = [0.6, 0.3, 0.15];
  return list.map((hex, i) => ({ hex, weight: weights[i] }));
}

const FAL_SIZE: Record<MasterShape, unknown> = { square: "square_hd", portrait: { width: 896, height: 1120 }, story: "portrait_16_9" };
const GPT_SIZE: Record<MasterShape, { width: number; height: number }> = { square: { width: 1024, height: 1024 }, portrait: { width: 1024, height: 1280 }, story: { width: 864, height: 1536 } };
const RECRAFT_SIZE: Record<MasterShape, unknown> = { square: "square_hd", portrait: { width: 1024, height: 1280 }, story: "portrait_16_9" };
const COLON: Record<MasterShape, string> = { square: "1:1", portrait: "4:5", story: "9:16" };
const IDEO_RATIO: Record<MasterShape, string> = { square: "1x1", portrait: "4x5", story: "9x16" };

export type MasterAsk = {
  brief: MasterBrief;
  shape: MasterShape;
  /** Imágenes de referencia de estilo (URL https o data:): el maestro aceptado, o 1-2 plantillas del manual. */
  styleRefUrls?: string[];
  /** De dónde son las referencias (cambia lo que se le pide). */
  refKind?: "master" | "book";
};
const refsOf = (m: DesignModel, ask: MasterAsk) => (m.styleRef ? (ask.styleRefUrls ?? []).filter(Boolean).slice(0, 2) : []);

/** El modelo de fal.ai y lo que se le manda. */
export function falRequest(m: DesignModel, ask: MasterAsk): { endpoint: string; input: Record<string, unknown> } {
  const refs = refsOf(m, ask);
  const ref = refs.length > 0;
  const { prompt, negative } = masterPrompt(ask.brief, ask.shape, { styleRef: ref ? (ask.refKind === "book" ? "book" : true) : false, compact: Boolean(m.maxPrompt && m.maxPrompt < 1500) });
  const pal = paletteOf(ask.brief);
  if (m.endpoint.startsWith("fal-ai/ideogram")) {
    return {
      endpoint: m.endpoint,
      input: {
        prompt,
        negative_prompt: negative,
        rendering_speed: "QUALITY",
        expand_prompt: false,
        image_size: FAL_SIZE[ask.shape],
        num_images: 1,
        ...(ref ? { image_urls: refs } : { style: "DESIGN" }),
        ...(pal.length ? { color_palette: { members: pal.map((p) => ({ rgb: rgbOf(p.hex), color_weight: p.weight })) } } : {}),
      },
    };
  }
  if (m.endpoint.startsWith("fal-ai/nano-banana")) {
    return {
      endpoint: ref && m.refEndpoint ? m.refEndpoint : m.endpoint,
      input: { prompt, aspect_ratio: COLON[ask.shape], resolution: "2K", num_images: 1, output_format: "png", ...(ref ? { image_urls: refs } : {}) },
    };
  }
  if (m.endpoint.startsWith("fal-ai/gpt-image")) {
    return {
      endpoint: ref && m.refEndpoint ? m.refEndpoint : m.endpoint,
      input: { prompt, image_size: GPT_SIZE[ask.shape], quality: "high", background: "opaque", num_images: 1, output_format: "png", ...(ref ? { image_urls: refs } : {}) },
    };
  }
  // Recraft
  return {
    endpoint: m.endpoint,
    input: { prompt: prompt.slice(0, m.maxPrompt ?? 1000), image_size: RECRAFT_SIZE[ask.shape], colors: pal.map((p) => rgbOf(p.hex)) },
  };
}

const IDEOGRAM_API = "https://api.ideogram.ai/";
export type RefImage = { data: Buffer; type: string };
const extOf = (type: string) => (type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg");

/** El pedido a la API de Ideogram (JSON; multipart si lleva la imagen de referencia de estilo). */
export function ideogramRequest(m: DesignModel, ask: MasterAsk, key: string, refIn?: RefImage | RefImage[]): { url: string; init: RequestInit } {
  const refs = (Array.isArray(refIn) ? refIn : refIn ? [refIn] : []).slice(0, 2);
  const ref = refs[0];
  const { prompt, negative } = masterPrompt(ask.brief, ask.shape, { styleRef: ref ? (ask.refKind === "book" ? "book" : true) : false });
  const pal = paletteOf(ask.brief);
  const fields: Record<string, string | boolean | number | object> = {
    prompt,
    negative_prompt: negative,
    aspect_ratio: IDEO_RATIO[ask.shape],
    rendering_speed: "quality",
    magic_prompt: "off",
    style_type: "design",
    num_images: 1,
    async: true,
    ...(pal.length ? { color_palette: { members: pal.map((p) => ({ color_hex: p.hex, color_weight: p.weight })) } } : {}),
  };
  const url = `${IDEOGRAM_API}${m.endpoint}`;
  if (!ref) return { url, init: { method: "POST", headers: { "Api-Key": key, "Content-Type": "application/json" }, body: JSON.stringify(fields) } };
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  refs.forEach((r, i) => form.append("style_reference_images", new Blob([new Uint8Array(r.data)], { type: r.type }), `style-${i + 1}.${extOf(r.type)}`));
  return { url, init: { method: "POST", headers: { "Api-Key": key }, body: form } };
}

/** Errores de Ideogram en palabras simples. */
export function ideogramError(status: number, body: string) {
  if (status === 401 || status === 403) return bi("Ideogram rechazó la clave (IDEOGRAM_API_KEY). Revisa que esté bien copiada en Vercel.", "Ideogram rejected the key (IDEOGRAM_API_KEY). Check that it's copied correctly in Vercel.");
  if (status === 402 || /insufficient_funds|subscription_required|priority_credit_required/.test(body))
    return bi("Tu cuenta de Ideogram no tiene créditos. Recárgala en ideogram.ai (sección API) y vuelve a intentar.", "Your Ideogram account is out of credits. Top it up at ideogram.ai (API section) and try again.");
  if (status === 422) return bi("Ideogram no quiso crear ese diseño por sus reglas de seguridad. Prueba otra vez o con otro modelo.", "Ideogram wouldn't create that design because of its safety rules. Try again or use another model.");
  if (status === 429) return bi("Ideogram está ocupado o llegaste a tu límite. Espera un minuto y vuelve a intentar.", "Ideogram is busy or you hit your limit. Wait a minute and try again.");
  return bi(`Ideogram respondió ${status}: ${body.slice(0, 200)}`, `Ideogram responded ${status}: ${body.slice(0, 200)}`);
}

export type MasterJob = ({ kind: "fal" } & FalJob) | { kind: "ideogram"; id: string } | { kind: "ready"; url: string };

type IdeoImage = { url?: string | null; is_image_safe?: boolean };
const unsafe = () => bi("La IA no quiso crear ese diseño por sus reglas de seguridad. Prueba otra vez o con otro modelo.", "The AI wouldn't create that design because of its safety rules. Try again or use another model.");
function firstImage(data: IdeoImage[] | undefined): string | null {
  const img = data?.[0];
  if (!img) return null;
  if (img.is_image_safe === false || !img.url) throw unsafe();
  return img.url;
}

/** Empieza a crear el diseño (no espera: se consulta con pollMaster). */
export async function submitMaster(m: DesignModel, ask: MasterAsk, opts: { env?: Env; ref?: RefImage | RefImage[] } = {}): Promise<MasterJob> {
  const env = opts.env ?? process.env;
  if (!env[m.env]?.trim()) throw bi(`Falta la clave ${m.env} en la configuración del servidor (Vercel).`, `The ${m.env} key is missing from the server settings (Vercel).`);
  if (m.provider === "ideogram") {
    const { url, init } = ideogramRequest(m, ask, env.IDEOGRAM_API_KEY!.trim(), opts.ref);
    const res = await fetch(url, init);
    const body = await res.text();
    if (!res.ok) throw ideogramError(res.status, body);
    const out = JSON.parse(body) as { generation_id?: string; data?: IdeoImage[] };
    const ready = firstImage(out.data);
    if (ready) return { kind: "ready", url: ready };
    if (!out.generation_id || !/^[A-Za-z0-9_-]+={0,2}$/.test(out.generation_id)) throw bi("Ideogram no devolvió el trabajo. Intenta de nuevo.", "Ideogram didn't return the job. Please try again.");
    return { kind: "ideogram", id: out.generation_id };
  }
  const { endpoint, input } = falRequest(m, ask);
  return { kind: "fal", ...(await falSubmit(endpoint, input)) };
}

// ---------- Convertir una pieza del manual en plantilla (editar la imagen) ----------

/**
 * Lo que se le pide al modelo de edición: el MISMO diseño sin el texto de ejemplo y con una caja gris lisa donde iba
 * la foto. El logo, el pie con el eslogan, el botón y la decoración se quedan exactamente igual.
 */
export const CLEAN_PROMPT = [
  "Edit this social media post design. Keep EVERYTHING exactly the same (layout, size, colors, shapes, decoration, logo, footer band with its tagline, the call-to-action button and its text, icons) except two things:",
  `1. Replace every photograph in it with ONE flat, solid light gray (${PLACEHOLDER}) area of exactly the same position, size and shape (same rounded corners or diagonal cut). Nothing inside it: no texture, no gradient, no people, no objects.`,
  "2. Remove all the example text that belongs to this specific post (headline, subheadline, body text, checklist or list items and their check marks, quotes, testimonial names, star ratings, play buttons) and fill those areas with the background exactly as it would look without the text.",
  "Do not add anything new. Do not change the logo. The result must look like the original designer's empty template, ready for a new photo and a new headline.",
].join("\n");

const FAL_EDIT_EXTRA: Record<string, Record<string, unknown>> = {
  "fal-ai/nano-banana-pro/edit": { aspect_ratio: "auto", resolution: "2K", output_format: "png" },
  "fal-ai/gpt-image-2/image-to-image": { image_size: "auto", quality: "high", output_format: "png" },
};

/** El pedido de edición a fal.ai (la imagen va por dirección: https o data:). */
export function falEditRequest(m: DesignModel, imageUrl: string): { endpoint: string; input: Record<string, unknown> } {
  if (!m.edit || m.provider !== "fal") throw bi("Ese modelo no edita imágenes.", "That model doesn't edit images.");
  return { endpoint: m.edit.endpoint, input: { prompt: CLEAN_PROMPT, image_urls: [imageUrl], num_images: 1, ...(FAL_EDIT_EXTRA[m.edit.endpoint] ?? {}) } };
}

/** El pedido a Ideogram 4.5 «Precise Edit» (multipart con la imagen; en segundo plano). */
export function ideogramEditRequest(m: DesignModel, image: RefImage, key: string): { url: string; init: RequestInit } {
  if (!m.edit || m.provider !== "ideogram") throw bi("Ese modelo no edita imágenes.", "That model doesn't edit images.");
  const form = new FormData();
  form.set("prompt", CLEAN_PROMPT);
  form.set("quality", "medium");
  form.set("num_images", "1");
  form.set("async", "true");
  form.append("image", new Blob([new Uint8Array(image.data)], { type: image.type }), `pieza.${extOf(image.type)}`);
  return { url: `${IDEOGRAM_API}${m.edit.endpoint}`, init: { method: "POST", headers: { "Api-Key": key }, body: form } };
}

/** Empieza la edición (no espera: se consulta con pollMaster, igual que un diseño nuevo). */
export async function submitEdit(m: DesignModel, image: RefImage & { url: string }, env: Env = process.env): Promise<MasterJob> {
  if (!m.edit) throw bi("Ese modelo no edita imágenes.", "That model doesn't edit images.");
  if (!env[m.env]?.trim()) throw bi(`Falta la clave ${m.env} en la configuración del servidor (Vercel).`, `The ${m.env} key is missing from the server settings (Vercel).`);
  if (m.provider === "ideogram") {
    const { url, init } = ideogramEditRequest(m, image, env.IDEOGRAM_API_KEY!.trim());
    const res = await fetch(url, init);
    const body = await res.text();
    if (!res.ok) throw ideogramError(res.status, body);
    const out = JSON.parse(body) as { generation_id?: string; data?: IdeoImage[] };
    const ready = firstImage(out.data);
    if (ready) return { kind: "ready", url: ready };
    if (!out.generation_id || !/^[A-Za-z0-9_-]+={0,2}$/.test(out.generation_id)) throw bi("Ideogram no devolvió el trabajo. Intenta de nuevo.", "Ideogram didn't return the job. Please try again.");
    return { kind: "ideogram", id: out.generation_id };
  }
  const { endpoint, input } = falEditRequest(m, image.url);
  return { kind: "fal", ...(await falSubmit(endpoint, input)) };
}

/** ¿Ya está? Devuelve la dirección (temporal) de la imagen. */
export async function pollMaster(job: MasterJob, env: Env = process.env): Promise<{ done: false } | { done: true; url: string }> {
  if (job.kind === "ready") return { done: true, url: job.url };
  if (job.kind === "ideogram") {
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(job.id)) throw bi("Trabajo de Ideogram no válido.", "Invalid Ideogram job.");
    const res = await fetch(`${IDEOGRAM_API}v2/generations/${job.id}`, { headers: { "Api-Key": env.IDEOGRAM_API_KEY?.trim() ?? "" } });
    const body = await res.text();
    if (res.status === 429) return { done: false };
    if (!res.ok) throw ideogramError(res.status, body);
    const out = JSON.parse(body) as { status?: string; failure_reason?: string; data?: IdeoImage[] };
    if (out.status === "pending") return { done: false };
    if (out.status === "failed") {
      if (/policy|safety/i.test(out.failure_reason ?? "")) throw unsafe();
      throw bi("Ideogram no pudo crear el diseño. Intenta de nuevo.", "Ideogram couldn't create the design. Please try again.");
    }
    const url = firstImage(out.data);
    if (!url) return { done: false };
    return { done: true, url };
  }
  const r = await falPoll<{ images?: { url?: string }[]; has_nsfw_concepts?: boolean[] }>(job);
  if (!r.done) return { done: false };
  const url = r.out.images?.[0]?.url;
  if (!url || r.out.has_nsfw_concepts?.[0]) throw unsafe();
  return { done: true, url };
}

// ---------- Dónde quedaron la foto, el titular y el logo ----------

const BoxSchema = z.object({
  x: z.number().describe("Left edge, fraction of the image width (0-1)"),
  y: z.number().describe("Top edge, fraction of the image height (0-1)"),
  w: z.number().describe("Width, fraction of the image width (0-1)"),
  h: z.number().describe("Height, fraction of the image height (0-1)"),
});
/** Lo que se le pregunta a Gemini al mirar el diseño. */
export const DetectSchema = z.object({
  photo: BoxSchema.describe("The empty flat gray placeholder rectangle meant for a photo"),
  photoShape: z.enum(["rect", "rounded", "circle"]).describe("Shape of the photo placeholder corners"),
  text: BoxSchema.describe("The largest clean, empty, calm area meant for a headline (not overlapping the photo area)"),
  textAlign: z.enum(["left", "center"]).describe("How a headline would best be aligned in that area"),
  logo: BoxSchema.describe("A small clean empty corner area for a logo, overlapping neither the photo nor the headline area"),
  textInImage: z.array(z.string()).describe("Any letters, words or numbers visible anywhere in the image, verbatim (empty list if none)"),
});
export type Detected = z.infer<typeof DetectSchema>;

export const DETECT_SYSTEM =
  "You are a precise layout analyst for social media templates. Coordinates are fractions of the image size from the top-left corner (0 to 1). Measure carefully from the pixels; never guess outside the image.";
export const DETECT_USER =
  "This is a social media post template. Find: (1) the empty flat light-gray placeholder rectangle where a photo will be placed, (2) the cleanest empty area for a headline, (3) a small empty corner area for a logo. Also list any text visible in the image.";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const round = (v: number) => Math.round(v * 10000) / 10000;

/** Una caja válida (dentro del lienzo y de tamaño razonable) o null. */
export function cleanBox(b: unknown, min = 0.04): Box | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  let [x, y, w, h] = [o.x, o.y, o.w, o.h].map((v) => (typeof v === "number" && Number.isFinite(v) ? v : NaN));
  if ([x, y, w, h].some(Number.isNaN)) return null;
  // Algunas IAs devuelven porcentajes (0-100).
  if (Math.max(x, y, w, h) > 1.5) [x, y, w, h] = [x, y, w, h].map((v) => v / 100);
  x = clamp01(x);
  y = clamp01(y);
  w = Math.min(w, 1 - x);
  h = Math.min(h, 1 - y);
  if (w < min || h < min) return null;
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

export function overlap(a: Box, b: Box): number {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h;
}
export const iou = (a: Box, b: Box) => {
  const i = overlap(a, b);
  return i / Math.max(1e-6, a.w * a.h + b.w * b.h - i);
};

/**
 * La caja gris de la foto buscada en los píxeles (imagen chica, RGB): la mancha gris clara más grande y llena.
 * null si no hay una clara (entre 10% y 85% del lienzo, y casi sin huecos).
 */
export function placeholderBox(data: Uint8Array, width: number, height: number, channels = 3): Box | null {
  const n = width * height;
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    gray[i] = max - min <= 14 && min >= 188 && max <= 238 ? 1 : 0;
  }
  const seen = new Uint8Array(n);
  let best: { count: number; x0: number; y0: number; x1: number; y1: number } | null = null;
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!gray[i] || seen[i]) continue;
    let count = 0;
    let [x0, y0, x1, y1] = [width, height, 0, 0];
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p - x) / width;
      count++;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]) {
        if (q >= 0 && gray[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (!best || count > best.count) best = { count, x0, y0, x1, y1 };
  }
  if (!best) return null;
  const bw = best.x1 - best.x0 + 1;
  const bh = best.y1 - best.y0 + 1;
  const area = (bw * bh) / n;
  if (area < 0.1 || area > 0.85 || best.count / (bw * bh) < 0.82) return null;
  return { x: round(best.x0 / width), y: round(best.y0 / height), w: round(bw / width), h: round(bh / height) };
}

const SAFE: Record<MasterShape, { top: number; bottom: number }> = { square: { top: 0.06, bottom: 0.06 }, portrait: { top: 0.06, bottom: 0.06 }, story: { top: 0.14, bottom: 0.2 } };

/** Cajas de siempre si no se encuentran (el dueño las ajusta). */
export function defaultPhotoBox(shape: MasterShape): Box {
  return shape === "story" ? { x: 0.06, y: 0.22, w: 0.88, h: 0.4 } : shape === "portrait" ? { x: 0.06, y: 0.06, w: 0.88, h: 0.54 } : { x: 0.06, y: 0.06, w: 0.88, h: 0.56 };
}

/** Si no hay zona del titular, la franja libre más grande al lado de la foto (con márgenes). */
export function fallbackTextBox(photo: Box, shape: MasterShape): Box {
  const s = SAFE[shape];
  const m = 0.07;
  const gap = 0.035;
  const bands: Box[] = [
    { x: m, y: Math.max(s.top, photo.y + photo.h + gap), w: 1 - m * 2, h: 1 - s.bottom - Math.max(s.top, photo.y + photo.h + gap) },
    { x: m, y: s.top, w: 1 - m * 2, h: photo.y - gap - s.top },
    { x: m, y: s.top + 0.04, w: photo.x - gap - m, h: 1 - s.top - s.bottom - 0.08 },
    { x: photo.x + photo.w + gap, y: s.top + 0.04, w: 1 - m - (photo.x + photo.w + gap), h: 1 - s.top - s.bottom - 0.08 },
  ];
  const ok = bands.filter((b) => b.w >= 0.25 && b.h >= 0.1).sort((a, b) => b.w * b.h - a.w * a.h);
  const pick = ok[0] ?? { x: m, y: Math.min(0.7, 1 - s.bottom - 0.18), w: 1 - m * 2, h: 0.18 };
  // La caja del titular no necesita más de un tercio del alto.
  const h = Math.min(pick.h, 0.34);
  return cleanBox({ x: pick.x, y: pick.y + (pick.h - h) / 2, w: pick.w, h }, 0.02) ?? { x: m, y: 0.7, w: 1 - m * 2, h: 0.18 };
}

/** Un rincón libre para el logo (que no pise la foto ni el titular). */
export function fallbackLogoBox(photo: Box, text: Box, shape: MasterShape): Box {
  const s = SAFE[shape];
  const w = shape === "story" ? 0.32 : 0.26;
  const h = shape === "story" ? 0.055 : 0.075;
  const m = 0.05;
  const corners: Box[] = [
    { x: m, y: Math.max(0.03, s.top - h - 0.01), w, h },
    { x: 1 - m - w, y: Math.max(0.03, s.top - h - 0.01), w, h },
    { x: 1 - m - w, y: 1 - s.bottom - h + (shape === "story" ? 0 : 0.02), w, h },
    { x: m, y: 1 - s.bottom - h + (shape === "story" ? 0 : 0.02), w, h },
    { x: 1 - m - w, y: text.y + text.h + 0.01, w, h },
  ].map((b) => cleanBox(b, 0.02)!).filter(Boolean);
  const free = corners.find((b) => b.h >= h * 0.9 && overlap(b, photo) < 0.0005 && overlap(b, text) < 0.0005);
  // Sin rincón libre: en la esquina de abajo a la derecha de la zona del titular (resolveAreas le hace lugar).
  return free ?? cleanBox({ x: text.x + text.w - w, y: text.y + text.h - h, w, h }, 0.02) ?? corners[0];
}

export type Areas = {
  photoBox: Box;
  textBox: Box;
  /** null = el diseño ya trae el logo (pieza del manual): la app no pone otro. */
  logoBox: Box | null;
  photoRadius: number;
  textAlign: "izquierda" | "centro";
  /** De dónde salieron las cajas. */
  by: "ai" | "pixels" | "default";
  /** Mejor que el dueño las revise («Ajustar»). */
  needsAdjust: boolean;
  /** Letras que dibujó la IA (no debería haber). */
  textInImage: string[];
};

/** Junta lo que vio Gemini con lo que se encontró en los píxeles, valida y completa lo que falte. */
export function resolveAreas(input: { ai?: Partial<Detected> | null; pixel?: Box | null; shape: MasterShape }): Areas {
  const ai = input.ai ?? null;
  const aiPhoto = cleanBox(ai?.photo, 0.15);
  const px = input.pixel ?? null;
  let photo: Box;
  let by: Areas["by"];
  if (px && (!aiPhoto || iou(px, aiPhoto) > 0.5)) [photo, by] = [px, aiPhoto ? "ai" : "pixels"];
  else if (aiPhoto) [photo, by] = [aiPhoto, "ai"];
  else [photo, by] = [defaultPhotoBox(input.shape), "default"];
  // Un poquito más grande, para tapar el borde de la caja gris.
  const e = 0.004;
  photo = cleanBox({ x: photo.x - e, y: photo.y - e, w: photo.w + e * 2, h: photo.h + e * 2 }, 0.02) ?? photo;
  const aiText = cleanBox(ai?.text, 0.08);
  let text: Box;
  let textFromAi = false;
  if (aiText && overlap(aiText, photo) / (aiText.w * aiText.h) < 0.2) {
    // Se deja aire adentro de la zona (el titular no toca sus bordes).
    text = cleanBox({ x: aiText.x + aiText.w * 0.06, y: aiText.y + aiText.h * 0.1, w: aiText.w * 0.88, h: aiText.h * 0.8 }, 0.02)!;
    textFromAi = true;
  } else text = fallbackTextBox(photo, input.shape);
  const aiLogo = cleanBox(ai?.logo, 0.02);
  const logo =
    aiLogo && aiLogo.w <= 0.45 && aiLogo.h <= 0.2 && overlap(aiLogo, photo) < 0.001 && overlap(aiLogo, text) < 0.001 ? aiLogo : fallbackLogoBox(photo, text, input.shape);
  // Si el logo quedó dentro de la zona del titular, el titular sube y le deja su lugar.
  if (overlap(logo, text) > 0.0005 && logo.y > text.y) text = cleanBox({ ...text, h: logo.y - 0.015 - text.y }, 0.02) ?? text;
  const radius = ai?.photoShape === "circle" ? 0.5 : ai?.photoShape === "rounded" ? 0.04 : 0;
  return {
    photoBox: photo,
    textBox: text,
    logoBox: logo,
    photoRadius: radius,
    textAlign: ai?.textAlign === "center" ? "centro" : "izquierda",
    by,
    needsAdjust: by === "default" || !textFromAi,
    textInImage: (ai?.textInImage ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 8),
  };
}

/** Color de las letras del titular sobre el fondo de su zona: el de la marca si se lee muy bien, si no blanco u oscuro. */
export function inkFor(bg: string, brand: string): "claro" | "oscuro" | "marca" {
  const b = hexOr(bg, "#ffffff");
  const c = hexOr(brand, "#126BBC");
  if (contrast(c, b) >= 4.5 && contrast("#ffffff", b) < 3) return "marca";
  return contrast("#ffffff", b) >= contrast("#111827", b) ? "claro" : "oscuro";
}

// ---------- Piezas del manual: dónde estaban la foto y el texto de ejemplo ----------

/** Lo que se le pregunta a Gemini al mirar la pieza ORIGINAL del manual (con su foto y su texto de ejemplo). */
export const BookDetectSchema = z.object({
  photos: z.array(BoxSchema).describe("Every sample photograph area in this post (empty list if none)"),
  headline: BoxSchema.describe("The main headline text block (the biggest text)"),
  headlineColor: z.string().describe("Color of the headline letters as #RRGGBB"),
  texts: z
    .array(BoxSchema)
    .describe(
      "Every block of example text specific to this post that must be replaced: headline, subheadline, body text, checklist items, quotes, testimonial names, prices, star ratings. NOT the logo, NOT the brand tagline in the footer, NOT the call-to-action button",
    ),
  hasLogo: z.boolean().describe("Whether the post already shows the brand logo"),
  textAlign: z.enum(["left", "center"]).describe("Alignment of the headline"),
});
export type BookDetected = z.infer<typeof BookDetectSchema>;
export const BOOK_DETECT_USER =
  "This is one finished social media post from a brand book, with a sample photo and sample text. Locate the photo area(s), the headline, every block of example text, and say whether the logo is shown.";

/** El color de las letras del titular del diseñador → el color de la app más parecido. */
export function inkFromColor(hex: string | undefined, brand: string): "claro" | "oscuro" | "marca" | null {
  const c = hexOr(hex?.trim(), "");
  if (!c) return null;
  if (contrast(c, "#ffffff") < 1.5) return "claro";
  const b = hexOr(brand, "#126BBC");
  const dist = (x: string, y: string) => [1, 3, 5].reduce((a, i) => a + Math.abs(parseInt(x.slice(i, i + 2), 16) - parseInt(y.slice(i, i + 2), 16)), 0);
  if (dist(c, b) < 120) return "marca";
  return contrast(c, "#111827") < 2 ? "oscuro" : contrast(c, "#ffffff") >= 4.5 ? "oscuro" : "claro";
}

/** Las partes con texto de ejemplo que hay que tapar (sin pisar la foto), un poco más grandes. */
export function textPatches(d: Partial<BookDetected> | null): Box[] {
  const photos = (d?.photos ?? []).map((p) => cleanBox(p, 0.05)).filter((b): b is Box => Boolean(b));
  const list = [d?.headline, ...(d?.texts ?? [])].map((t) => cleanBox(t, 0.012)).filter((b): b is Box => Boolean(b));
  const out: Box[] = [];
  for (const b of list) {
    if (photos.some((p) => overlap(b, p) / (b.w * b.h) > 0.5)) continue;
    const e = cleanBox({ x: b.x - 0.01, y: b.y - 0.008, w: b.w + 0.02, h: b.h + 0.016 }, 0.012);
    if (e && !out.some((o) => iou(o, e) > 0.8)) out.push(e);
  }
  return out.slice(0, 12);
}

/**
 * Las cajas de una pieza del manual: la foto sale del diseño limpio (caja gris) o, si no, de la foto original; el
 * titular va donde el diseñador lo puso (en el original); el logo del diseñador se queda (no se agrega otro).
 */
export function resolveBookAreas(input: { book: Partial<BookDetected> | null; cleaned: Areas | null; shape: MasterShape }): Areas {
  const { book, cleaned, shape } = input;
  const photos = (book?.photos ?? []).map((p) => cleanBox(p, 0.1)).filter((b): b is Box => Boolean(b)).sort((a, b) => b.w * b.h - a.w * a.h);
  const photo = cleaned && cleaned.by !== "default" ? cleaned.photoBox : (photos[0] ?? cleaned?.photoBox ?? defaultPhotoBox(shape));
  const head = cleanBox(book?.headline, 0.05);
  let text: Box | null = null;
  if (head && overlap(head, photo) / (head.w * head.h) < 0.5) {
    // Un poco más alto que el titular de ejemplo (el nuevo puede tener una línea más).
    text = cleanBox({ x: head.x - 0.01, y: head.y - 0.01, w: head.w + 0.02, h: Math.min(head.h * 1.35 + 0.02, 1 - head.y) }, 0.04);
  }
  const hasLogo = book?.hasLogo !== false;
  const textBox = text ?? cleaned?.textBox ?? fallbackTextBox(photo, shape);
  return {
    photoBox: photo,
    textBox,
    logoBox: hasLogo ? null : (cleaned?.logoBox ?? fallbackLogoBox(photo, textBox, shape)),
    photoRadius: cleaned?.photoRadius ?? 0,
    textAlign: book?.textAlign === "center" ? "centro" : "izquierda",
    by: book ? "ai" : (cleaned?.by ?? "default"),
    needsAdjust: !text,
    textInImage: cleaned?.textInImage ?? [],
  };
}

/** La forma de redes más cercana a una pieza (y si está tan cerca que conviene estirarla justo a esa forma). */
export function nearestShape(w: number, h: number): { shape: MasterShape; exact: { w: number; h: number } | null } {
  const r = w / Math.max(1, h);
  // Cuadrado primero (es lo más común en los manuales; una página aplastada lo deja en ~0.89), después 4:5 y 9:16.
  if (Math.abs(r - 1) <= 0.13) return { shape: "square", exact: { w: 1080, h: 1080 } };
  if (Math.abs(r - 0.8) / 0.8 <= 0.07) return { shape: "portrait", exact: { w: 1080, h: 1350 } };
  if (Math.abs(r - 0.5625) / 0.5625 <= 0.1) return { shape: "story", exact: { w: 1080, h: 1920 } };
  const opts: [MasterShape, number][] = [["square", 1], ["portrait", 0.8], ["story", 0.5625]];
  const [shape] = opts.reduce((best, o) => (Math.abs(Math.log(r / o[1])) < Math.abs(Math.log(r / best[1])) ? o : best));
  return { shape, exact: null };
}
