// Imágenes de la marca guardadas en Business.brandAssets (JSON). Dos orígenes:
// - "book": lo que la IA encontró en el manual de marca (logos, isotipo, patrones, ejemplos de plantillas).
//   Llegan como "proposed" y el dueño las acepta o rechaza.
// - "generated": lo que la app crea con la marca (foto de perfil, portadas, favicon, tarjeta…). Llegan "accepted".
// Sin servidor ni base de datos: se puede usar en pantalla y en pruebas.

export type BrandAssetKind =
  | "logo" // logo completo (símbolo + nombre) para fondos claros
  | "logo-light" // versión para fondos oscuros (blanca o clara)
  | "logo-dark" // versión en negro o un solo color oscuro
  | "isotype" // solo el símbolo, sin el nombre
  | "pattern" // patrón, textura o fondo de la marca
  | "template" // ejemplo de pieza (post, tarjeta, papelería) que sirve de modelo de estilo
  | "photo" // foto de la marca (equipo, local, producto)
  | "icon" // íconos de la marca
  | "kit"; // pieza creada por la app (perfil, portada, favicon…): ver `format`

export type BrandAssetStatus = "proposed" | "accepted" | "rejected";

export type BrandAsset = {
  id: string;
  kind: BrandAssetKind;
  url: string;
  w: number;
  h: number;
  source: "book" | "generated";
  status: BrandAssetStatus;
  /** Nombre corto para mostrar ("Logo horizontal", "Portada de Facebook"). */
  label: { es: string; en: string };
  /** Por qué la IA cree que es eso, o dónde se usa (texto corto). */
  note?: { es: string; en: string };
  /** Página del manual de donde salió (desde 1). */
  page?: number;
  /** Solo "kit": qué pieza es (ej. "profile", "fb-cover"). Una por formato: la nueva reemplaza la anterior. */
  format?: string;
  /** Solo "kit": grupo para mostrar ("social", "web", "email", "print", "logos"). */
  group?: string;
  /** Fondo transparente (PNG con alfa). */
  transparent?: boolean;
  createdAt: string;
};

export type BrandAssets = {
  items: BrandAsset[];
  /** Cuándo se leyó el manual para sacar imágenes, y cuántas páginas tenía. */
  bookReadAt?: string;
  bookPages?: number;
  /** Cuándo se creó el kit por última vez. */
  generatedAt?: string;
};

export const MAX_BRAND_ASSETS = 200;

const KINDS = new Set<BrandAssetKind>(["logo", "logo-light", "logo-dark", "isotype", "pattern", "template", "photo", "icon", "kit"]);
const STATUSES = new Set<BrandAssetStatus>(["proposed", "accepted", "rejected"]);

const txt = (v: unknown): { es: string; en: string } | undefined => {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const es = typeof o.es === "string" ? o.es : "";
  const en = typeof o.en === "string" ? o.en : es;
  return es || en ? { es: es || en, en } : undefined;
};

/** Lee lo guardado en la base de datos sin confiar en su forma. */
export function readBrandAssets(raw: unknown): BrandAssets {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const items: BrandAsset[] = [];
  for (const v of Array.isArray(o.items) ? o.items : []) {
    if (!v || typeof v !== "object") continue;
    const a = v as Record<string, unknown>;
    const kind = a.kind as BrandAssetKind;
    const status = a.status as BrandAssetStatus;
    if (typeof a.id !== "string" || typeof a.url !== "string" || !KINDS.has(kind) || !STATUSES.has(status)) continue;
    items.push({
      id: a.id,
      kind,
      url: a.url,
      w: typeof a.w === "number" ? a.w : 0,
      h: typeof a.h === "number" ? a.h : 0,
      source: a.source === "generated" ? "generated" : "book",
      status,
      label: txt(a.label) ?? { es: "Imagen", en: "Image" },
      note: txt(a.note),
      page: typeof a.page === "number" ? a.page : undefined,
      format: typeof a.format === "string" ? a.format : undefined,
      group: typeof a.group === "string" ? a.group : undefined,
      transparent: a.transparent === true ? true : undefined,
      createdAt: typeof a.createdAt === "string" ? a.createdAt : new Date(0).toISOString(),
    });
  }
  return {
    items,
    bookReadAt: typeof o.bookReadAt === "string" ? o.bookReadAt : undefined,
    bookPages: typeof o.bookPages === "number" ? o.bookPages : undefined,
    generatedAt: typeof o.generatedAt === "string" ? o.generatedAt : undefined,
  };
}

/**
 * Agrega imágenes. Las del kit reemplazan a la anterior del mismo `format`. Las del manual reemplazan todas las
 * propuestas anteriores del manual que nadie aceptó (al subir otro manual). Se quedan las más nuevas si hay demasiadas.
 */
export function addBrandAssets(cur: BrandAssets, add: BrandAsset[], opts: { replaceBookProposals?: boolean } = {}): BrandAssets {
  const formats = new Set(add.filter((a) => a.kind === "kit" && a.format).map((a) => a.format));
  let items = cur.items.filter((a) => !(a.kind === "kit" && a.format && formats.has(a.format)));
  if (opts.replaceBookProposals) items = items.filter((a) => !(a.source === "book" && a.status !== "accepted"));
  items = [...items, ...add];
  if (items.length > MAX_BRAND_ASSETS) items = items.slice(items.length - MAX_BRAND_ASSETS);
  return { ...cur, items };
}

/** Acepta o rechaza una propuesta. */
export function setBrandAssetStatus(cur: BrandAssets, id: string, status: BrandAssetStatus): BrandAssets {
  return { ...cur, items: cur.items.map((a) => (a.id === id ? { ...a, status } : a)) };
}

export function removeBrandAsset(cur: BrandAssets, id: string): BrandAssets {
  return { ...cur, items: cur.items.filter((a) => a.id !== id) };
}

export const bookProposals = (b: BrandAssets) => b.items.filter((a) => a.source === "book" && a.status === "proposed");
export const acceptedBookAssets = (b: BrandAssets) => b.items.filter((a) => a.source === "book" && a.status === "accepted");
export const kitAssets = (b: BrandAssets) => b.items.filter((a) => a.kind === "kit");

/** El mejor símbolo aceptado para piezas cuadradas chicas (perfil, favicon): isotipo, si no el logo. */
export function bestMark(b: BrandAssets, fallbackLogo: string): string {
  const ok = acceptedBookAssets(b);
  return ok.find((a) => a.kind === "isotype")?.url || ok.find((a) => a.kind === "logo")?.url || fallbackLogo;
}

export const newAssetId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
