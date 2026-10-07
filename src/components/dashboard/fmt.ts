// Formatos cortos del Tablero. Las fechas siempre en la hora del negocio (Miami), con lib/time.
import { intlLocale, type UiLang } from "@/lib/i18n";
import { fmtDate, fmtFriendly, fmtDateTime } from "@/lib/time";

/** "Hoy, 2:35 a.m." / "Ayer, 9:00 p.m." o "6 oct 2026". */
export function when(at: Date | null | undefined, lang: UiLang): string {
  if (!at) return "";
  const friendly = fmtFriendly(at, lang);
  return friendly === fmtDateTime(at, lang) ? fmtDate(at, lang) : friendly;
}

/** 1 234 / 1,234 (1 decimal como máximo). */
export function n(v: number, lang: UiLang, digits = 1): string {
  return new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: digits }).format(v);
}

/** 12 400 → "12 mil" / "12.4K"; los chicos tal cual. */
export function compact(v: number, lang: UiLang): string {
  return new Intl.NumberFormat(lang === "en" ? "en-US" : "es-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}
