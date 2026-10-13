// Formatos de cada red (dónde va cada pieza y de qué tamaño), para mostrar las plantillas de la marca ordenadas por
// red: Facebook, Instagram, TikTok, YouTube, LinkedIn, X, Pinterest, Google… El catálogo es src/data/formatos.json,
// el `catalogo/formatos.json` de la biblioteca multicanal de RicardoPA (revisado el 9 de octubre de 2026). Llegó sin su
// manifest.json ni los SVG de referencia: aquí solo se usan las medidas, la evidencia y la zona segura.
// Sin servidor ni base de datos: se usa en pantalla, en la ruta de las vistas previas y en las pruebas.
import { z } from "zod";
import raw from "@/data/formatos.json";

const Insets = z.object({ top: z.number().min(0).max(0.5), right: z.number().min(0).max(0.5), bottom: z.number().min(0).max(0.5), left: z.number().min(0).max(0.5) });

/** Lo que se usa de cada formato del catálogo (lo demás se ignora). */
export const PlacementSpec = z.object({
  id: z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/),
  platform: z.string().min(1),
  platformLabel: z.string().min(1),
  label: z.string().min(1),
  mediaKind: z.enum(["image", "image_asset", "logo", "video", "email", "document"]),
  canvas: z.object({
    mode: z.enum(["fixed", "fluid"]),
    width: z.number().int().positive(),
    height: z.number().int().positive().nullable(),
    unit: z.string(),
    aspectRatio: z.string().nullable(),
  }),
  evidence: z.object({ status: z.enum(["verified_dimension", "working_choice_with_context", "unverified_working_choice"]), checkedAt: z.string().nullable().optional() }),
  delivery: z.object({ formats: z.array(z.string()), maxBytes: z.number().int().positive().nullable() }),
  /** Márgenes (fracción del lienzo) o, como el banner de YouTube, un rectángulo centrado medido sobre otro lienzo. */
  safeZone: z.object({
    normalizedInsets: Insets.nullable().optional(),
    referenceCanvas: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
    referenceCenteredRect: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
  }),
  notes: z.string().optional(),
  layoutClass: z.enum(["display", "compact_banner"]).nullable().optional(),
  experimental: z.boolean().optional(),
  regionalOnly: z.string().nullable().optional(),
});
export type PlacementSpec = z.infer<typeof PlacementSpec>;

/** Valida el catálogo: si un formato no tiene la forma esperada, falla al arrancar (y en las pruebas). */
export function readPlacements(data: unknown): PlacementSpec[] {
  const list = z.array(PlacementSpec).parse(data);
  const ids = new Set<string>();
  for (const p of list) {
    if (ids.has(p.id)) throw new Error(`Formato repetido en el catálogo: ${p.id}`);
    ids.add(p.id);
  }
  return list;
}

export const PLACEMENTS: PlacementSpec[] = readPlacements(raw);

/** La zona segura como márgenes (fracción del lienzo), o null si el formato no tiene (diseños fluidos). */
export function safeInsets(p: PlacementSpec): z.infer<typeof Insets> | null {
  const z0 = p.safeZone;
  if (z0.normalizedInsets) return z0.normalizedInsets;
  if (z0.referenceCanvas && z0.referenceCenteredRect) {
    const x = Math.max(0, (1 - z0.referenceCenteredRect.width / z0.referenceCanvas.width) / 2);
    const y = Math.max(0, (1 - z0.referenceCenteredRect.height / z0.referenceCanvas.height) / 2);
    return { top: y, right: x, bottom: y, left: x };
  }
  return null;
}

/**
 * Qué hace la app con cada formato:
 * - design: se dibuja con las plantillas de la marca, reacomodando el diseño a la medida (no se estira).
 * - photo: solo la foto, sin letras (Google Ads responsivo y fotos del Perfil de Negocio: el texto va aparte).
 * - kit: lo crea el kit de marca (foto de perfil, portadas de página y canal).
 * - video: se hace en «Videos».
 * - pending: todavía no (email HTML por bloques, PDF de varias páginas).
 * - adapt: requiere una adaptación propia (banners muy anchos o muy angostos): no se declara lista.
 */
export type PlacementPlan = "design" | "photo" | "kit" | "video" | "pending" | "adapt";

/** Portadas y avatares que ya hace el kit de marca: formato del catálogo → pieza del kit. */
export const KIT_PIECE: Record<string, string> = {
  "facebook.page_cover": "fb-cover",
  "linkedin.page_cover": "linkedin-cover",
  "x.header": "x-header",
  "youtube.channel_banner": "yt-banner",
  "google_business.cover": "gbp-cover",
};

/** Proporciones que las plantillas pueden reacomodar bien (de 9:16 a 2:1). */
const MIN_RATIO = 0.5;
const MAX_RATIO = 2.05;

export function placementPlan(p: PlacementSpec): PlacementPlan {
  if (p.mediaKind === "video") return "video";
  if (p.mediaKind === "email" || p.mediaKind === "document") return "pending";
  if (p.mediaKind === "logo" || KIT_PIECE[p.id]) return "kit";
  if (p.canvas.mode !== "fixed" || !p.canvas.height) return "pending";
  if (p.layoutClass) return "adapt";
  const r = p.canvas.width / p.canvas.height;
  if (r < MIN_RATIO || r > MAX_RATIO) return "adapt";
  if (p.mediaKind === "image_asset") return "photo";
  return "design";
}

/** Se puede dibujar (y descargar) desde la app: con plantilla o solo la foto. */
export const renderable = (p: PlacementSpec) => {
  const plan = placementPlan(p);
  return plan === "design" || plan === "photo";
};

export const placementById = (id: string) => PLACEMENTS.find((p) => p.id === id);

/** Las redes en el orden en que se muestran (las que más se usan primero). */
export const PLATFORM_ORDER = ["facebook", "instagram", "tiktok", "youtube", "linkedin", "x", "pinterest", "google_business", "google_ads", "whatsapp", "threads", "snapchat", "bluesky", "email"];

/** Los formatos agrupados por red, sin los que solo sirven en otros países. */
export function placementGroups(list: PlacementSpec[] = PLACEMENTS): { platform: string; label: string; items: PlacementSpec[] }[] {
  const groups = new Map<string, { platform: string; label: string; items: PlacementSpec[] }>();
  for (const p of list) {
    if (p.regionalOnly) continue;
    const g = groups.get(p.platform) ?? { platform: p.platform, label: p.platformLabel, items: [] };
    g.items.push(p);
    groups.set(p.platform, g);
  }
  const order = (k: string) => (PLATFORM_ORDER.includes(k) ? PLATFORM_ORDER.indexOf(k) : PLATFORM_ORDER.length);
  return [...groups.values()].sort((a, b) => order(a.platform) - order(b.platform));
}

/** Tamaño de la vista previa: la misma forma, con el lado más largo de `max` px como mucho. */
export function previewSize(p: PlacementSpec, max = 1080): { w: number; h: number } {
  const w = p.canvas.width;
  const h = p.canvas.height ?? w;
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** «1080 × 1350 · 4:5». */
export const sizeText = (p: PlacementSpec) =>
  p.canvas.height ? `${p.canvas.width} × ${p.canvas.height}${p.canvas.aspectRatio && p.canvas.aspectRatio.length <= 5 ? ` · ${p.canvas.aspectRatio}` : ""}` : `${p.canvas.width} px`;

/** Qué tan segura es la medida, en palabras simples. */
export const EVIDENCE_LABEL: Record<PlacementSpec["evidence"]["status"], { es: string; en: string }> = {
  verified_dimension: { es: "Medida verificada", en: "Verified size" },
  working_choice_with_context: { es: "Medida recomendada", en: "Recommended size" },
  unverified_working_choice: { es: "Medida sin verificar", en: "Unverified size" },
};

export const PLAN_LABEL: Record<PlacementPlan, { es: string; en: string }> = {
  design: { es: "Lista con tus plantillas", en: "Ready with your templates" },
  photo: { es: "Solo la foto (el texto va aparte)", en: "Photo only (text goes separately)" },
  kit: { es: "Está en el kit de marca", en: "It's in the brand kit" },
  video: { es: "Se hace en Videos", en: "Made in Videos" },
  pending: { es: "Pendiente", en: "Coming later" },
  adapt: { es: "Requiere adaptación", en: "Needs its own layout" },
};
