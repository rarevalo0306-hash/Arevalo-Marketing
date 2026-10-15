// Imágenes de la marca guardadas en Business.brandAssets (JSON). Dos orígenes:
// - "book": lo que la IA encontró en el manual de marca (logos, isotipo, patrones, ejemplos de plantillas).
//   Llegan como "proposed" y el dueño las acepta o rechaza.
// - "generated": lo que la app crea con la marca (foto de perfil, portadas, favicon…). Llegan "accepted".
// Sin servidor ni base de datos: se puede usar en pantalla y en pruebas.
import { kitFormat } from "@/lib/brand-kit-formats";

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
  /** Solo "kit": grupo para mostrar ("social", "web", "email", "logos"). Las piezas del manual usan "social" o "print". */
  group?: string;
  /** Fondo transparente (PNG con alfa). */
  transparent?: boolean;
  createdAt: string;
};

/** Tipos de logo principal. El isotipo (solo el símbolo) va aparte: sirve para espacios chicos y cuadrados. */
export const LOGO_TYPES = ["logotipo", "imagotipo", "isologo"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];
export const LOGO_SLOTS = ["isotipo", ...LOGO_TYPES] as const;
export type LogoSlot = (typeof LOGO_SLOTS)[number];
export type LogoVariant = "color" | "white";
/** Un tipo de logo: la versión a color (fondos claros) y la blanca (fondos oscuros y fotos). */
export type LogoFiles = { color?: string; white?: string };

/**
 * Los logos de la marca por tipo, subidos por el dueño. El logo principal (el que va en los diseños) sigue en
 * Business.logoUrl / logoLightUrl; aquí se guarda qué tipo es (`mainType`), el isotipo y las otras versiones.
 */
export type BrandLogos = {
  mainType?: LogoType;
  /** Quién dijo qué tipo es: la IA al mirar el logo, o el dueño (que corrige a la IA). */
  mainTypeBy?: "ai" | "owner";
  slots: Partial<Record<LogoSlot, LogoFiles>>;
};

/**
 * Cada tipo de logo: su nombre técnico, cómo es en palabras simples (`plain`, lo que se lee primero) y una explicación
 * corta con un ejemplo conocido.
 */
export const LOGO_INFO: Record<LogoSlot, { name: { es: string; en: string }; plain: { es: string; en: string }; what: { es: string; en: string } }> = {
  logotipo: {
    name: { es: "Logotipo", en: "Logotype (wordmark)" },
    plain: { es: "Solo el nombre, sin dibujo", en: "Just the name, no drawing" },
    what: { es: "Solo texto: el nombre escrito con su letra, sin símbolo. Ej.: Google.", en: "Text only: the name in its lettering, with no symbol. E.g.: Google." },
  },
  isotipo: {
    name: { es: "Isotipo", en: "Isotype (symbol)" },
    plain: { es: "Solo el dibujo, sin el nombre", en: "Just the drawing, without the name" },
    what: { es: "Solo símbolo, sin el nombre. Ej.: el «swoosh» de Nike. Va en la foto de perfil, los íconos del sitio y la esquina de los videos.", en: "Symbol only, without the name. E.g.: the Nike swoosh. It goes on the profile picture, site icons and the corner of videos." },
  },
  imagotipo: {
    name: { es: "Imagotipo", en: "Imagotype (combination mark)" },
    plain: { es: "Nombre y dibujo que se pueden usar por separado", en: "Name and drawing that can be used apart" },
    what: { es: "Texto y símbolo combinados: van juntos pero se pueden separar. Ej.: Rolex (la corona arriba del nombre).", en: "Text and symbol combined: they go together but can be used apart. E.g.: Rolex (the crown above the name)." },
  },
  isologo: {
    name: { es: "Isologo", en: "Isologo (emblem)" },
    plain: { es: "Nombre y dibujo pegados en una sola pieza", en: "Name and drawing joined in one piece" },
    what: { es: "Texto y símbolo como uno solo: no se pueden separar. Ej.: Burger King (el nombre dentro de la hamburguesa).", en: "Text and symbol as one: they can't be separated. E.g.: Burger King (the name inside the burger)." },
  },
};

export type BrandAssets = {
  items: BrandAsset[];
  /** Logos por tipo (ver BrandLogos). */
  logos?: BrandLogos;
  /** Cuándo se leyó el manual para sacar imágenes, y cuántas páginas tenía. */
  bookReadAt?: string;
  bookPages?: number;
  /** Nombre del archivo del manual que está en uso (como lo subió el dueño). */
  bookName?: string;
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
    logos: readLogos(o.logos),
    bookReadAt: typeof o.bookReadAt === "string" ? o.bookReadAt : undefined,
    bookPages: typeof o.bookPages === "number" ? o.bookPages : undefined,
    bookName: typeof o.bookName === "string" ? o.bookName.slice(0, 120) : undefined,
    generatedAt: typeof o.generatedAt === "string" ? o.generatedAt : undefined,
  };
}

/** Solo direcciones de tu almacenamiento o públicas (https): nunca rutas de la computadora ni otras cosas. */
const logoUrl = (v: unknown): string | undefined => (typeof v === "string" && (/^https:\/\/\S+$/.test(v) || /^\/media\/[\w.-]+$/.test(v)) ? v : undefined);

function readLogos(raw: unknown): BrandLogos | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const src = o.slots && typeof o.slots === "object" && !Array.isArray(o.slots) ? (o.slots as Record<string, unknown>) : {};
  const slots: BrandLogos["slots"] = {};
  for (const slot of LOGO_SLOTS) {
    const f = src[slot] && typeof src[slot] === "object" ? (src[slot] as Record<string, unknown>) : null;
    const files: LogoFiles = { color: logoUrl(f?.color), white: logoUrl(f?.white) };
    if (files.color || files.white) slots[slot] = Object.fromEntries(Object.entries(files).filter(([, v]) => v)) as LogoFiles;
  }
  const mainType = LOGO_TYPES.find((x) => x === o.mainType);
  const by = o.mainTypeBy === "ai" || o.mainTypeBy === "owner" ? o.mainTypeBy : undefined;
  return mainType || Object.keys(slots).length ? { ...mainTypeOf(mainType, by), slots } : undefined;
}

const mainTypeOf = (mainType: LogoType | undefined, by: "ai" | "owner" | undefined) => (mainType ? { mainType, mainTypeBy: by ?? "owner" } : {});

/** Guarda (o quita, con "") una versión de un tipo de logo. */
export function setLogoSlot(cur: BrandAssets, slot: LogoSlot, variant: LogoVariant, url: string): BrandAssets {
  const slots = { ...(cur.logos?.slots ?? {}) };
  const files: LogoFiles = { ...(slots[slot] ?? {}), [variant]: url || undefined };
  if (files.color || files.white) slots[slot] = Object.fromEntries(Object.entries(files).filter(([, v]) => v)) as LogoFiles;
  else delete slots[slot];
  return { ...cur, logos: { ...mainTypeOf(cur.logos?.mainType, cur.logos?.mainTypeBy), slots } };
}

/** Qué tipo es el logo principal (el que va en los diseños), y quién lo dijo. */
export function setMainLogoType(cur: BrandAssets, type: LogoType | null, by: "ai" | "owner" = "owner"): BrandAssets {
  const slots = cur.logos?.slots ?? {};
  return { ...cur, logos: { ...mainTypeOf(type ?? undefined, by), slots } };
}

/**
 * Agrega imágenes. Las del kit reemplazan a la anterior del mismo `format`. Las del manual reemplazan todas las
 * propuestas anteriores del manual que nadie aceptó (al subir otro manual). Se quedan las más nuevas si hay demasiadas.
 */
export function addBrandAssets(cur: BrandAssets, add: BrandAsset[], opts: { replaceBookProposals?: boolean } = {}): BrandAssets {
  const formats = new Set(add.filter((a) => a.kind === "kit" && a.format).map((a) => a.format));
  // Al volver a crear el kit también salen las piezas que ya no existen (ej. la tarjeta de presentación).
  const newKit = formats.size > 0;
  let items = cur.items.filter((a) => !(a.kind === "kit" && ((a.format && formats.has(a.format)) || (newKit && !kitFormat(a.format)))));
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
/** Las piezas del kit que siguen existiendo (las de formatos retirados, como la tarjeta impresa, no se muestran). */
export const kitAssets = (b: BrandAssets) => b.items.filter((a) => a.kind === "kit" && Boolean(kitFormat(a.format)));

/**
 * El mejor símbolo para piezas cuadradas chicas (perfil, favicon): el isotipo que subió el dueño, si no el isotipo
 * aceptado del manual, si no el logo.
 */
export function bestMark(b: BrandAssets, fallbackLogo: string): string {
  const ok = acceptedBookAssets(b);
  return b.logos?.slots.isotipo?.color || ok.find((a) => a.kind === "isotype")?.url || ok.find((a) => a.kind === "logo")?.url || fallbackLogo;
}

export const newAssetId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
