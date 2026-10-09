// Zona horaria de cada negocio (Business.timezone, "" = la de la app: BUSINESS_TZ) y los días en esa hora.
// El reporte diario cierra a la medianoche del negocio: aquí están los rangos [inicio, fin) de cada día en UTC,
// "ayer" en la hora del negocio, si ya pasó la medianoche desde el último envío y una zona sugerida por el lugar.
// Sin base de datos ni red: se usa en el servidor, en el navegador (el selector de zona) y en las pruebas.
import { BUSINESS_TZ, businessDay, localToUtc } from "@/lib/time";

const DAY_MS = 24 * 3600_000;
const FALLBACK_TZ = "America/New_York";

/** ¿Es un nombre de zona IANA que entiende el sistema ("America/Managua")? */
export function isValidTz(tz: string | null | undefined): tz is string {
  const v = (tz ?? "").trim();
  if (!v || v.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(v)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

/** La zona de la app (BUSINESS_TZ) si es válida; si no, Nueva York (Miami). */
export const appTz = (): string => (isValidTz(BUSINESS_TZ) ? BUSINESS_TZ : FALLBACK_TZ);

/** La zona del negocio: la suya si es válida; si está vacía o no sirve, la de la app. */
export function businessTz(b: { timezone?: string | null } | null | undefined): string {
  const tz = (b?.timezone ?? "").trim();
  return isValidTz(tz) ? tz : appTz();
}

// ---------- Días ----------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ¿"2026-10-08" es una fecha real? */
export function isDay(s: string | null | undefined): s is string {
  if (!s || !DAY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "2026-10-08" + n días (n puede ser negativo). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Date(d.getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/** Días entre dos fechas ("2026-10-01" → "2026-10-08" = 7). */
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / DAY_MS);
}

/** El día ("AAAA-MM-DD") de un momento en la hora del negocio. */
export const localDay = (date: Date, tz: string): string => businessDay(date, tz);

/** Las 00:00 de un día en la hora del negocio, en UTC (con cambios de horario incluidos). */
export const dayStart = (tz: string, day: string): Date => localToUtc(day, 0, "00:00", tz);

/** [inicio, fin) de un día del negocio en UTC. Un día con cambio de horario dura 23 o 25 horas. */
export function dayRange(tz: string, day: string): { from: Date; to: Date } {
  return { from: dayStart(tz, day), to: dayStart(tz, addDays(day, 1)) };
}

/** [inicio, fin) de varios días seguidos (fromDay y toDay incluidos). */
export function daysRange(tz: string, fromDay: string, toDay: string): { from: Date; to: Date } {
  return { from: dayStart(tz, fromDay), to: dayStart(tz, addDays(toDay, 1)) };
}

/** El día de ayer en la hora del negocio (el último día que ya cerró). */
export function yesterday(tz: string, now = new Date()): string {
  return addDays(localDay(now, tz), -1);
}

/** Minutos desde la medianoche del negocio (0 = justo a las 00:00). */
export function minutesSinceMidnight(tz: string, now = new Date()): number {
  return Math.floor((now.getTime() - dayStart(tz, localDay(now, tz)).getTime()) / 60_000);
}

/**
 * ¿Ya pasó la medianoche del negocio desde el último reporte enviado? Devuelve el día que cerró y falta mandar
 * (siempre "ayer": nunca se mandan días viejos atrasados), o null si ya se mandó o todavía es muy temprano.
 * `graceMin`: unos minutos después de la medianoche para que terminen las publicaciones y anuncios del último minuto.
 */
export function dailyDueDay(lastSentDay: string | null | undefined, tz: string, now = new Date(), graceMin = 5): string | null {
  if (minutesSinceMidnight(tz, now) < graceMin) return null;
  const day = yesterday(tz, now);
  if (lastSentDay && lastSentDay >= day) return null;
  return day;
}

/** Clave única de un reporte diario (negocio + día): nunca se manda dos veces el mismo. */
export const dailyKey = (businessId: string, day: string) => `daily:${businessId}:${day}`;

/** "UTC−6" / "UTC−4" en este momento (cambia con el horario de verano). */
export function tzOffsetLabel(tz: string, at = new Date()): string {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
    const m = name.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
    if (!m) return "UTC";
    return `UTC${m[1].replace("-", "−")}${m[2] && m[2] !== "00" ? `:${m[2]}` : ""}`;
  } catch {
    return "UTC";
  }
}

// ---------- Zonas comunes y sugerencia por el lugar ----------

export type TzOption = { id: string; es: string; en: string };

/** Las zonas que más se usan (Centroamérica, EE. UU., Caribe, Sudamérica y España). */
export const COMMON_TZS: TzOption[] = [
  { id: "America/Managua", es: "Nicaragua (Managua)", en: "Nicaragua (Managua)" },
  { id: "America/Costa_Rica", es: "Costa Rica", en: "Costa Rica" },
  { id: "America/Tegucigalpa", es: "Honduras", en: "Honduras" },
  { id: "America/El_Salvador", es: "El Salvador", en: "El Salvador" },
  { id: "America/Guatemala", es: "Guatemala", en: "Guatemala" },
  { id: "America/Panama", es: "Panamá", en: "Panama" },
  { id: "America/Mexico_City", es: "México (Ciudad de México)", en: "Mexico (Mexico City)" },
  { id: "America/Cancun", es: "México (Cancún)", en: "Mexico (Cancún)" },
  { id: "America/Tijuana", es: "México (Tijuana)", en: "Mexico (Tijuana)" },
  { id: "America/New_York", es: "EE. UU. Este (Miami, Nueva York)", en: "US Eastern (Miami, New York)" },
  { id: "America/Chicago", es: "EE. UU. Centro (Chicago, Houston)", en: "US Central (Chicago, Houston)" },
  { id: "America/Denver", es: "EE. UU. Montaña (Denver)", en: "US Mountain (Denver)" },
  { id: "America/Phoenix", es: "EE. UU. Arizona (Phoenix)", en: "US Arizona (Phoenix)" },
  { id: "America/Los_Angeles", es: "EE. UU. Pacífico (Los Ángeles)", en: "US Pacific (Los Angeles)" },
  { id: "America/Puerto_Rico", es: "Puerto Rico", en: "Puerto Rico" },
  { id: "America/Santo_Domingo", es: "República Dominicana", en: "Dominican Republic" },
  { id: "America/Havana", es: "Cuba", en: "Cuba" },
  { id: "America/Bogota", es: "Colombia", en: "Colombia" },
  { id: "America/Lima", es: "Perú", en: "Peru" },
  { id: "America/Guayaquil", es: "Ecuador", en: "Ecuador" },
  { id: "America/Caracas", es: "Venezuela", en: "Venezuela" },
  { id: "America/Santiago", es: "Chile", en: "Chile" },
  { id: "America/Argentina/Buenos_Aires", es: "Argentina", en: "Argentina" },
  { id: "Europe/Madrid", es: "España", en: "Spain" },
];

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Ciudades conocidas → zona (gana sobre el país; sirve en países con varias zonas). */
const CITY_TZ: Record<string, string> = {
  managua: "America/Managua",
  leon: "America/Managua",
  granada: "America/Managua",
  masaya: "America/Managua",
  miami: "America/New_York",
  doral: "America/New_York",
  hialeah: "America/New_York",
  orlando: "America/New_York",
  tampa: "America/New_York",
  "fort lauderdale": "America/New_York",
  "new york": "America/New_York",
  atlanta: "America/New_York",
  houston: "America/Chicago",
  dallas: "America/Chicago",
  "san antonio": "America/Chicago",
  austin: "America/Chicago",
  chicago: "America/Chicago",
  "new orleans": "America/Chicago",
  "los angeles": "America/Los_Angeles",
  "san diego": "America/Los_Angeles",
  "san francisco": "America/Los_Angeles",
  "las vegas": "America/Los_Angeles",
  phoenix: "America/Phoenix",
  denver: "America/Denver",
  cancun: "America/Cancun",
  tijuana: "America/Tijuana",
  "ciudad de mexico": "America/Mexico_City",
  "mexico city": "America/Mexico_City",
  guadalajara: "America/Mexico_City",
  monterrey: "America/Monterrey",
  "san jose": "America/Costa_Rica",
  tegucigalpa: "America/Tegucigalpa",
  "san pedro sula": "America/Tegucigalpa",
  "san salvador": "America/El_Salvador",
  "ciudad de guatemala": "America/Guatemala",
  "guatemala city": "America/Guatemala",
  "santo domingo": "America/Santo_Domingo",
  "san juan": "America/Puerto_Rico",
  bogota: "America/Bogota",
  medellin: "America/Bogota",
  lima: "America/Lima",
  quito: "America/Guayaquil",
  guayaquil: "America/Guayaquil",
  caracas: "America/Caracas",
  madrid: "Europe/Madrid",
  barcelona: "Europe/Madrid",
};

/** Países con una sola zona (o la principal) → zona. Nombres en español e inglés y código ISO. */
const COUNTRY_TZ: Record<string, string> = {
  nicaragua: "America/Managua",
  ni: "America/Managua",
  "costa rica": "America/Costa_Rica",
  cr: "America/Costa_Rica",
  honduras: "America/Tegucigalpa",
  hn: "America/Tegucigalpa",
  "el salvador": "America/El_Salvador",
  sv: "America/El_Salvador",
  guatemala: "America/Guatemala",
  gt: "America/Guatemala",
  panama: "America/Panama",
  pa: "America/Panama",
  mexico: "America/Mexico_City",
  mx: "America/Mexico_City",
  "puerto rico": "America/Puerto_Rico",
  pr: "America/Puerto_Rico",
  "republica dominicana": "America/Santo_Domingo",
  "dominican republic": "America/Santo_Domingo",
  do: "America/Santo_Domingo",
  cuba: "America/Havana",
  cu: "America/Havana",
  colombia: "America/Bogota",
  co: "America/Bogota",
  peru: "America/Lima",
  pe: "America/Lima",
  ecuador: "America/Guayaquil",
  ec: "America/Guayaquil",
  venezuela: "America/Caracas",
  ve: "America/Caracas",
  chile: "America/Santiago",
  cl: "America/Santiago",
  argentina: "America/Argentina/Buenos_Aires",
  ar: "America/Argentina/Buenos_Aires",
  espana: "Europe/Madrid",
  spain: "Europe/Madrid",
  es: "Europe/Madrid",
};

/** Estados de EE. UU. → zona (la de la mayor parte del estado). */
const US_STATE_TZ: Record<string, string> = {
  florida: "America/New_York",
  fl: "America/New_York",
  "new york": "America/New_York",
  ny: "America/New_York",
  georgia: "America/New_York",
  ga: "America/New_York",
  "north carolina": "America/New_York",
  nc: "America/New_York",
  "south carolina": "America/New_York",
  sc: "America/New_York",
  "new jersey": "America/New_York",
  nj: "America/New_York",
  virginia: "America/New_York",
  va: "America/New_York",
  massachusetts: "America/New_York",
  ma: "America/New_York",
  pennsylvania: "America/New_York",
  pa: "America/New_York",
  texas: "America/Chicago",
  tx: "America/Chicago",
  louisiana: "America/Chicago",
  la: "America/Chicago",
  alabama: "America/Chicago",
  al: "America/Chicago",
  illinois: "America/Chicago",
  il: "America/Chicago",
  tennessee: "America/Chicago",
  tn: "America/Chicago",
  california: "America/Los_Angeles",
  ca: "America/Los_Angeles",
  nevada: "America/Los_Angeles",
  nv: "America/Los_Angeles",
  washington: "America/Los_Angeles",
  wa: "America/Los_Angeles",
  oregon: "America/Los_Angeles",
  or: "America/Los_Angeles",
  arizona: "America/Phoenix",
  az: "America/Phoenix",
  colorado: "America/Denver",
  co: "America/Denver",
  utah: "America/Denver",
  ut: "America/Denver",
};

const US_ZONES = new Set(["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles"]);
const MX_ZONES = new Set(["America/Mexico_City", "America/Cancun", "America/Tijuana", "America/Monterrey"]);

const isUs = (country: string) => ["united states", "estados unidos", "usa", "us", "eeuu", "ee uu"].includes(country);

export type PlaceForTz = { city?: string; state?: string; country?: string; countryCode?: string };

/**
 * Zona sugerida por el lugar del negocio (de businessPlace en src/lib/media-formats.ts: Google Maps, zona de SEO
 * o el estudio). Managua → America/Managua, Miami → America/New_York. null si no se reconoce el lugar.
 */
export function suggestTz(place: PlaceForTz | null | undefined): string | null {
  if (!place) return null;
  const city = norm(place.city);
  const state = norm(place.state);
  const country = norm(place.country);
  const code = norm(place.countryCode);
  const us = isUs(country) || code === "us" || (!country && Boolean(state && US_STATE_TZ[state]));
  const byCountry = COUNTRY_TZ[country] ?? COUNTRY_TZ[code] ?? null;
  const byCity = city ? CITY_TZ[city] : undefined;
  if (us) {
    // En EE. UU. solo valen las ciudades de EE. UU. ("San José" de Costa Rica no; la de California la da el estado).
    if (byCity && US_ZONES.has(byCity) && city !== "san jose") return byCity;
    return (state && US_STATE_TZ[state]) || (city === "san jose" ? "America/Los_Angeles" : "America/New_York");
  }
  if (byCity) {
    // Una ciudad con el mismo nombre en otro país (León, Granada…): si el país dice otra zona, gana el país.
    // México tiene varias zonas: ahí la ciudad (Cancún, Tijuana) sí manda.
    if (!byCountry || byCountry === byCity || (byCountry === "America/Mexico_City" && MX_ZONES.has(byCity))) return byCity;
    return byCountry;
  }
  return byCountry;
}

/** El nombre corto de una zona para mostrar ("Nicaragua (Managua)" o "America/Bogota" si no está en la lista). */
export function tzName(tz: string, lang: "es" | "en" = "es"): string {
  const o = COMMON_TZS.find((z) => z.id === tz);
  return o ? o[lang] : tz.replace(/_/g, " ");
}
