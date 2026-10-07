// Partes puras (sin base de datos) de la puesta en marcha del SEO y de los Ajustes: se usan en el navegador y en el servidor.
import type { Zone } from "@/lib/seo/dataforseo";

/** Países que se pueden elegir en Ajustes: [ISO, español, inglés (como lo nombra Google)]. Estados Unidos primero. */
export const COUNTRIES = [
  ["us", "Estados Unidos", "United States"],
  ["pr", "Puerto Rico", "Puerto Rico"],
  ["mx", "México", "Mexico"],
  ["ni", "Nicaragua", "Nicaragua"],
  ["cr", "Costa Rica", "Costa Rica"],
  ["hn", "Honduras", "Honduras"],
  ["sv", "El Salvador", "El Salvador"],
  ["gt", "Guatemala", "Guatemala"],
  ["pa", "Panamá", "Panama"],
  ["do", "República Dominicana", "Dominican Republic"],
  ["co", "Colombia", "Colombia"],
  ["ve", "Venezuela", "Venezuela"],
  ["ec", "Ecuador", "Ecuador"],
  ["pe", "Perú", "Peru"],
  ["cl", "Chile", "Chile"],
  ["ar", "Argentina", "Argentina"],
  ["uy", "Uruguay", "Uruguay"],
  ["py", "Paraguay", "Paraguay"],
  ["bo", "Bolivia", "Bolivia"],
  ["es", "España", "Spain"],
  ["ca", "Canadá", "Canada"],
] as const;

export const isCountry = (iso: string) => COUNTRIES.some(([c]) => c === iso);

/** El país (ISO) de una zona guardada: su nombre de Google termina con el país en inglés ("Miami,Florida,United States"). */
export function zoneCountry(name: string): string | null {
  const last = name.split(",").pop()?.trim().toLowerCase();
  return COUNTRIES.find(([, , en]) => en.toLowerCase() === last)?.[0] ?? null;
}

/** Tipos de zona de Google en palabras simples. */
const TYPE_LABELS: Record<string, [string, string]> = {
  Country: ["País", "Country"],
  State: ["Estado", "State"],
  Department: ["Departamento", "Department"],
  Province: ["Provincia", "Province"],
  Region: ["Región", "Region"],
  "Autonomous Community": ["Comunidad autónoma", "Autonomous community"],
  Governorate: ["Gobernación", "Governorate"],
  Territory: ["Territorio", "Territory"],
  "Union Territory": ["Territorio", "Territory"],
  Canton: ["Cantón", "Canton"],
  Prefecture: ["Prefectura", "Prefecture"],
  County: ["Condado", "County"],
  Municipality: ["Municipio", "Municipality"],
  City: ["Ciudad", "City"],
  District: ["Distrito", "District"],
  Borough: ["Distrito", "Borough"],
  Neighborhood: ["Barrio", "Neighborhood"],
  "Postal Code": ["Código postal", "ZIP code"],
  "DMA Region": ["Región de TV", "TV region"],
};

export function zoneTypeLabel(type: string | undefined, lang: "es" | "en"): string {
  if (!type) return "";
  const l = TYPE_LABELS[type];
  return l ? (lang === "en" ? l[1] : l[0]) : type;
}

/** Los tipos que salen en las listas para escoger (los barrios, códigos postales, aeropuertos, etc. solo con el buscador). */
export const PICKABLE_TYPES = new Set([
  "Country",
  "State",
  "Department",
  "Province",
  "Region",
  "Autonomous Community",
  "Governorate",
  "Territory",
  "Union Territory",
  "Canton",
  "Prefecture",
  "County",
  "Municipality",
  "City",
  "District",
  "Borough",
]);

/** Una zona de la lista de Google con su "padre" (la ciudad está dentro del estado, el estado dentro del país). */
export type TreeLocation = { code: number; name: string; type: string; parent: number | null };

// ---------- Cada cuánto se revisan las posiciones ----------

/** 0 = apagado. Los demás: cada cuántos días (Business.seoRankDays). */
export const RANK_FREQUENCIES = [0, 1, 7, 15, 30] as const;
export type RankFrequency = (typeof RANK_FREQUENCIES)[number];

export function asFrequency(daily: boolean, days: number): RankFrequency {
  if (!daily) return 0;
  return ([1, 7, 15, 30] as const).includes(days as 1 | 7 | 15 | 30) ? (days as RankFrequency) : 7;
}

export function frequencyLabel(f: RankFrequency, t: (es: string, en: string) => string): string {
  return {
    0: t("Apagado", "Off"),
    1: t("Cada día", "Every day"),
    7: t("Cada semana", "Every week"),
    15: t("Cada 15 días", "Every 15 days"),
    30: t("Cada mes", "Every month"),
  }[f];
}

/** Cuántas revisiones hay en un mes (30 días) con esa frecuencia. */
export const runsPerMonth = (f: RankFrequency) => (f === 0 ? 0 : 30 / f);

/** Costo de una revisión: cada palabra clave en cada zona. */
export const checkCost = (keywords: number, zones: number, pricePerKeyword: number) => keywords * Math.max(1, zones) * pricePerKeyword;

/** Costo estimado al mes (USD) de revisar solas las posiciones con esa frecuencia. */
export const monthlyRankCost = (f: RankFrequency, keywords: number, zones: number, pricePerKeyword: number) =>
  runsPerMonth(f) * checkCost(keywords, zones, pricePerKeyword);

/** "US$0.21" o "menos de 1 centavo". */
export function usd(n: number, lang: "es" | "en"): string {
  if (n > 0 && n < 0.01) return lang === "en" ? "less than 1 cent" : "menos de 1 centavo";
  return `US$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`;
}

// ---------- La propuesta ----------

export type Bi = { es: string; en: string };

/** De dónde sale cada palabra propuesta. */
export type KeywordSource = "tracked" | "study" | "search_console" | "google_ideas" | "profile";

export type ProposedKeyword = { keyword: string; source: KeywordSource; why: Bi; volume?: number | null };
export type ProposedZone = Zone & { why: Bi };

export type SetupProposal = {
  zones: ProposedZone[];
  /** Lugares que nombró el perfil pero que Google no tiene como zona. */
  missingPlaces: string[];
  language: "es" | "en";
  languageWhy: Bi;
  keywords: ProposedKeyword[];
  /** true si la IA ayudó; false si solo salió del estudio y de los datos guardados. */
  ai: boolean;
  /** Por qué no ayudó la IA (si falló). */
  aiError?: Bi;
  createdAt: string;
  /** Cuándo se midieron las búsquedas al mes en Google (volume de cada palabra). */
  measuredAt?: string;
  measuredZone?: string;
};

export function sourceLabel(s: KeywordSource, t: (es: string, en: string) => string): string {
  return {
    tracked: t("Ya la sigues", "Already tracked"),
    study: t("De tu estudio", "From your study"),
    search_console: t("Ya te encuentran con esta", "People already find you with it"),
    google_ideas: t("Idea de Google", "Google idea"),
    profile: t("De tu perfil", "From your profile"),
  }[s];
}

/** Ejemplo para el campo de palabras clave: una del propio negocio, o uno genérico. */
export function keywordExample(own: string[], lang: "es" | "en"): string {
  const k = own.find((x) => x.trim().length > 3);
  if (k) return k.trim();
  return lang === "en" ? "your service + your city" : "tu servicio + tu ciudad";
}

/** Palabra clave limpia y comparable (minúsculas, espacios simples, máx. 80). */
export const normKeyword = (k: string) => k.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);

/** Nombre de zona para las fichas: sin repetir y sin el país cuando hay algo más preciso ("Miami-Dade County, Florida"). */
export function placeLabel(name: string): string {
  const parts = name.split(",").map((p) => p.trim()).filter(Boolean);
  const out = parts.filter((p, i) => i === 0 || p !== parts[i - 1]);
  if (out.length >= 3) return `${out[0]}, ${out[out.length - 2]}`;
  return out.join(", ");
}

const STOP = new Set(["a", "al", "de", "del", "el", "la", "las", "los", "en", "para", "por", "y", "the", "for", "in", "of", "a", "an", "to", "near", "me", "cerca", "mi"]);

/** Clave para detectar casi-repetidas: sin acentos, sin palabras cortas comunes, sin plural y sin importar el orden. */
export function similarKey(k: string): string {
  return normKeyword(k)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 ? w.replace(/(es|s)$/, "") : w))
    .sort()
    .join(" ");
}
