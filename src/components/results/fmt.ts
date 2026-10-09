// Textos y formatos cortos del «Resumen de resultados».
import { channelName } from "@/lib/channels";
import { intlLocale, type UiLang } from "@/lib/i18n";
import type { Format } from "@/lib/results-shape";

export const num = (v: number, lang: UiLang, digits = 0) => new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: digits }).format(v);
export const compact = (v: number, lang: UiLang) => new Intl.NumberFormat(lang === "en" ? "en-US" : "es-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
export const pct = (v: number | null, lang: UiLang) => (v === null ? "—" : `${num(v * 100, lang, v < 0.1 ? 1 : 0)} %`);
export const usd = (cents: number, lang: UiLang) => new Intl.NumberFormat(lang === "en" ? "en-US" : "es-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);

export const channelLabel = (c: string, lang: UiLang) => channelName(c, lang) || c;

const FORMAT: Record<Format, [string, string]> = {
  photo: ["Foto", "Photo"],
  design: ["Diseño", "Design"],
  carousel: ["Carrusel", "Carousel"],
  story: ["Historia", "Story"],
  video: ["Video", "Video"],
  text: ["Solo texto", "Text only"],
};
export const formatLabel = (f: string, lang: UiLang) => (FORMAT[f as Format] ? FORMAT[f as Format][lang === "en" ? 1 : 0] : f);

const DAYS: Record<UiLang, string[]> = {
  es: ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};
export const dayLabel = (d: number, lang: UiLang) => DAYS[lang][d] ?? "";
export const dayShort = (d: number, lang: UiLang) => (DAYS[lang][d] ?? "").slice(0, 3);

/** 15 → "3 p. m." / "3 PM". */
export function hourLabel(h: number, lang: UiLang): string {
  const d = new Date(Date.UTC(2026, 0, 1, h));
  return new Intl.DateTimeFormat(intlLocale(lang), { hour: "numeric", hour12: true, timeZone: "UTC" }).format(d).replace(/\s+/g, " ");
}

/** "6 oct" en la zona del negocio. */
export function shortDate(iso: string, lang: UiLang, tz: string): string {
  try {
    return new Intl.DateTimeFormat(intlLocale(lang), { day: "numeric", month: "short", timeZone: tz }).format(new Date(iso));
  } catch {
    return iso.slice(5, 10);
  }
}
