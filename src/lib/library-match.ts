// Biblioteca: elegir la foto real que mejor va con una publicación, y cómo se muestra cada archivo.
// Sin servidor ni base de datos: lo usan library.ts (servidor), el selector del compositor (navegador) y las pruebas.
import { canUse, readDescription, type LibraryDescription, type UsableInput } from "@/lib/library-shape";

// ---------- Palabras ----------

/** Palabras que no dicen nada del tema (español e inglés), y las que la IA usa para describir cómo tomar la foto. */
const STOP = new Set(
  (
    "a al algo ante antes como con contra cual cuando de del desde donde durante e el ella ellas ellos en entre era es esa ese eso esta este esto estos estas " +
    "fue ha hay la las le les lo los mas me mi mis muy ni no nos nuestra nuestro o otra otro para pero poco por porque que se sea ser si sin sobre son su sus " +
    "tambien te tiene tienen todo todos tu tus un una uno unos unas y ya yo hoy aqui alli asi cada mucho muchos solo tan tanto ver vez " +
    "an and are as at be but by for from has have he her his in into is it its of on or our so than that the their them then there these they this " +
    "those to up was we were what when where which who will with you your yours not no all any can just more most very out over about after before " +
    "foto fotos imagen photo photos image picture realistic realista photographer shot angle camera lens light lighting daylight natural soft warm calm " +
    "composition space headline simple scene setting background foreground view close wide eye level medium style looking showing shows show " +
    "text sign signs logo logos face faces people person real fake staged area time day morning afternoon evening " +
    "nuevo nueva nuevos nuevas mejor mejores gran grande buen buena buenos buenas hace hacer haz llama llamanos escribenos whatsapp info"
  ).split(" "),
);

/** Sin acentos, en minúsculas y sin plural ni terminaciones comunes: «Puertas» = «puerta», «houses» = «house». */
export function stem(word: string): string {
  let w = word
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (w.length > 5 && /(ing|ed)$/.test(w)) w = w.replace(/(ing|ed)$/, "");
  if (w.length > 4 && w.endsWith("es")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** Las palabras con sentido de un texto, ya normalizadas (sin repetir). */
export function terms(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9ñ]+/)) {
    if (raw.length < 3 || STOP.has(raw) || /^\d+$/.test(raw)) continue;
    const w = stem(raw);
    if (w.length >= 3 && !STOP.has(w)) out.add(w);
  }
  return [...out];
}

/**
 * ¿Se puede poner en una publicación? Como `canUse`, pero un video sin copia todavía cuenta (se copia de Drive al usarlo).
 */
export const usableNow = (x: UsableInput) => canUse({ ...x, url: x.url || (x.kind === "video" ? "pending" : "") });

// ---------- Elegir la foto ----------

/** Lo que hace falta de cada archivo para elegir. */
export type MatchItem = {
  id: string;
  kind: string;
  url: string;
  status: string;
  usable: boolean;
  quality: number;
  privacy: string[];
  choice: string;
  tags: string[];
  folderPath: string;
  description: unknown;
  width: number;
  height: number;
  usedCount: number;
  lastUsedAt: Date | null;
};

export type MatchQuery = {
  /** El texto de la publicación (titular, mensaje, idea de la foto…). */
  text: string;
  /** Palabras que pesan más (por ejemplo el titular o el tema). */
  keywords?: string[];
  /** Forma que se busca; una foto con esa forma gana un poco. */
  shape?: "square" | "vertical" | "horizontal";
  /** Ids que no se pueden elegir (ya usados en este mismo plan). */
  exclude?: string[];
  /** Publicación que vende (oferta, cotiza, llama…): mejor fotos de trabajo terminado. Si no se dice, se adivina por el texto. */
  promo?: boolean;
};

/** Puntos mínimos de parecido con el tema: con menos, mejor que la IA cree una foto. */
export const MIN_RELEVANCE = 3;
/** Cuántos días se considera «usada hace poco». */
export const RECENT_DAYS = 30;

const PROMO = /\b(oferta|ofertas|promo|promocion|descuento|descuentos|cotiza|cotizacion|cotizaciones|gratis|precio|precios|contrata|offer|offers|deal|deals|discount|discounts|quote|quotes|free|price|prices|hire)\b/;

/** ¿La publicación vende algo? */
export const isPromo = (text: string) =>
  PROMO.test(
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase(),
  );

type Scored = { item: MatchItem; relevance: number; score: number };

/**
 * Qué tan bien va un archivo con la publicación. `relevance` es solo el parecido de tema (etiquetas y temas valen 3,
 * la carpeta 2, la descripción 1; las palabras clave valen el doble); `score` suma la calidad, si se usó poco y la escena.
 */
export function scoreItem(item: MatchItem, q: MatchQuery, now = new Date()): Scored {
  const d = readDescription(item.description);
  const strong = new Set([...item.tags, ...(d?.topics ?? [])].flatMap((x) => terms(x)));
  const folder = new Set(terms(item.folderPath.replace(/[/_-]+/g, " ")));
  const loose = new Set(terms(`${d?.es ?? ""} ${d?.en ?? ""}`));
  const key = new Set((q.keywords ?? []).flatMap((k) => terms(k)));
  const words = new Set([...terms(q.text), ...key]);
  let relevance = 0;
  for (const w of words) {
    const pts = strong.has(w) ? 3 : folder.has(w) ? 2 : loose.has(w) ? 1 : 0;
    relevance += key.has(w) ? pts * 2 : pts;
  }
  let score = relevance;
  // Calidad: 3 es normal; 5 suma 1, 4 suma 0.5.
  score += (Math.min(5, Math.max(0, item.quality)) - 3) * 0.5;
  // Mejor la que se usó menos, y castigo fuerte si se usó en los últimos 30 días.
  score -= Math.min(1.5, item.usedCount * 0.3);
  if (item.lastUsedAt && now.getTime() - item.lastUsedAt.getTime() < RECENT_DAYS * 86400000) score -= 2;
  // Para vender: trabajo terminado o «después» suma; «antes» o daños resta.
  const promo = q.promo ?? isPromo(`${q.text} ${(q.keywords ?? []).join(" ")}`);
  if (promo && d) {
    if (d.scene === "done" || d.scene === "after") score += 1;
    else if (d.scene === "before" || d.scene === "damage") score -= 1;
  }
  // La forma: si coincide, un poco mejor.
  if (q.shape && item.width > 0 && item.height > 0) {
    const r = item.width / item.height;
    const fits = q.shape === "square" ? r > 0.8 && r < 1.25 : q.shape === "vertical" ? r <= 0.8 : r >= 1.25;
    if (fits) score += 0.5;
  }
  return { item, relevance, score };
}

/** La mejor foto para la publicación, o null si ninguna se parece lo suficiente (entonces la IA crea una). */
export function rankLibrary(items: MatchItem[], q: MatchQuery, now = new Date()): MatchItem | null {
  const skip = new Set(q.exclude ?? []);
  let best: Scored | null = null;
  for (const item of items) {
    if (item.kind !== "photo" || skip.has(item.id) || !canUse(item)) continue;
    const s = scoreItem(item, q, now);
    if (s.relevance < MIN_RELEVANCE) continue;
    if (!best || s.score > best.score || (s.score === best.score && s.item.usedCount < best.item.usedCount)) best = s;
  }
  return best?.item ?? null;
}

// ---------- Para mostrar ----------

/** Una tarjeta de la biblioteca, lista para mostrar (fechas como texto para pasar al navegador). */
export type LibraryCard = {
  id: string;
  name: string;
  kind: "photo" | "video";
  thumb: string;
  url: string;
  durationSec: number;
  description: LibraryDescription | null;
  tags: string[];
  quality: number;
  privacy: string[];
  status: string;
  error: string;
  choice: string;
  usedCount: number;
  lastUsedAt: string | null;
  /** Subcarpeta de Drive, o la nota del técnico si se subió con el link. */
  folderPath: string;
  /** De dónde vino: la carpeta de Drive o el link de subida. */
  source: "drive" | "upload";
  canUse: boolean;
  needsReview: boolean;
};


export const SCENE_LABEL: Record<LibraryDescription["scene"], { es: string; en: string }> = {
  done: { es: "Trabajo terminado", en: "Finished job" },
  before: { es: "Antes", en: "Before" },
  after: { es: "Después", en: "After" },
  progress: { es: "En proceso", en: "In progress" },
  team: { es: "Equipo", en: "Team" },
  place: { es: "Local", en: "Place" },
  product: { es: "Producto", en: "Product" },
  damage: { es: "Daño", en: "Damage" },
  other: { es: "Otro", en: "Other" },
};

/** Calidad en palabras: 4-5 buena, 3 regular, 1-2 mala, 0 sin revisar. */
export function qualityWord(q: number): { es: string; en: string; tone: "good" | "warn" | "bad" | "neutral" } {
  if (q >= 4) return { es: "Buena", en: "Good", tone: "good" };
  if (q === 3) return { es: "Regular", en: "Fair", tone: "warn" };
  if (q >= 1) return { es: "Mala", en: "Poor", tone: "bad" };
  return { es: "Sin revisar", en: "Not checked", tone: "neutral" };
}

/** 75 → «1:15». */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** ¿Lo que escribió la persona aparece en la foto? (para el buscador del selector) */
export function cardMatches(c: { description: LibraryDescription | null; tags: string[]; name: string; folderPath: string }, query: string): boolean {
  const want = terms(query);
  if (!want.length) return true;
  const have = new Set(terms([c.description?.es, c.description?.en, ...(c.description?.topics ?? []), ...c.tags, c.name.replace(/\.[a-z0-9]+$/i, ""), c.folderPath].join(" ")));
  const list = [...have];
  return want.every((w) => have.has(w) || list.some((h) => h.startsWith(w)));
}
