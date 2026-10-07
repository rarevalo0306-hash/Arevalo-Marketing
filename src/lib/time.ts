// Horas locales del negocio (por defecto Miami) a UTC para guardar en la base de datos.
export const BUSINESS_TZ = process.env.BUSINESS_TZ || "America/New_York";

function offsetMinutes(date: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - date.getTime()) / 60000;
}

/** "2026-10-06" + 2 días + "09:30" en hora de Miami → Date en UTC. */
export function localToUtc(startDate: string, dayOffset: number, time: string, tz = BUSINESS_TZ): Date {
  const [y, m, d] = startDate.split("-").map(Number);
  const [hh, mm] = (/^\d{1,2}:\d{2}$/.test(time) ? time : "10:00").split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d + dayOffset, hh, mm));
  const first = new Date(guess.getTime() - offsetMinutes(guess, tz) * 60000);
  // Segunda pasada por si el cambio de horario cae justo en medio.
  return new Date(guess.getTime() - offsetMinutes(first, tz) * 60000);
}

// ---------- Mostrar fechas siempre en la hora del negocio (Miami) ----------
// El servidor corre en UTC: sin timeZone, "2:35 a. m." en Miami se vería como "6:35". Usa estas funciones para mostrar fechas.

type FmtLang = "es" | "en";
// "es-US": español con hora de 12 horas ("2:35 a.m."), como se usa en Miami y en Centroamérica.
const fmtLocale = (lang: FmtLang) => (lang === "en" ? "en-US" : "es-US");
const asDate = (d: Date | string | number) => (d instanceof Date ? d : new Date(d));

/** "6 oct 2026, 2:35 a.m." (o "Oct 6, 2026, 2:35 AM") en la hora del negocio. */
export function fmtDateTime(date: Date | string | number, lang: FmtLang = "es", tz = BUSINESS_TZ): string {
  const d = asDate(date);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(fmtLocale(lang), { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(d);
}

/** "6 oct 2026" en la hora del negocio. */
export function fmtDate(date: Date | string | number, lang: FmtLang = "es", tz = BUSINESS_TZ): string {
  const d = asDate(date);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(fmtLocale(lang), { dateStyle: "medium", timeZone: tz }).format(d);
}

/** "2:35 a.m." en la hora del negocio. */
export function fmtTime(date: Date | string | number, lang: FmtLang = "es", tz = BUSINESS_TZ): string {
  const d = asDate(date);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(fmtLocale(lang), { timeStyle: "short", timeZone: tz }).format(d);
}

/** "2026-10-06": el día en la hora del negocio (para comparar días). */
export function businessDay(date: Date | string | number, tz = BUSINESS_TZ): string {
  return asDate(date).toLocaleDateString("en-CA", { timeZone: tz });
}

/**
 * Fecha amigable: "Hoy, 2:35 a.m.", "Ayer, 9:00 p.m.", "Mañana, 10:00 a.m." o la fecha completa.
 * `now` se puede pasar para las pruebas.
 */
export function fmtFriendly(date: Date | string | number, lang: FmtLang = "es", now: Date = new Date(), tz = BUSINESS_TZ): string {
  const d = asDate(date);
  if (isNaN(d.getTime())) return "—";
  const day = businessDay(d, tz);
  const shift = (n: number) => businessDay(new Date(now.getTime() + n * 86400000), tz);
  const words: Record<string, [string, string]> = {
    [shift(0)]: ["Hoy", "Today"],
    [shift(-1)]: ["Ayer", "Yesterday"],
    [shift(1)]: ["Mañana", "Tomorrow"],
  };
  const w = words[day];
  if (!w) return fmtDateTime(d, lang, tz);
  return `${lang === "en" ? w[1] : w[0]}, ${fmtTime(d, lang, tz)}`;
}

/** Nombre de la zona horaria del negocio para mostrar: "hora de Miami" / "Miami time". */
export function businessTzLabel(lang: FmtLang = "es", tz = BUSINESS_TZ): string {
  const city: Record<string, string> = {
    "America/New_York": "Miami",
    "America/Managua": "Managua",
    "America/Chicago": "Chicago",
    "America/Los_Angeles": "Los Ángeles",
    "America/Mexico_City": "Ciudad de México",
  };
  const name = city[tz] ?? tz.split("/").pop()!.replace(/_/g, " ");
  return lang === "en" ? `${name.replace("Los Ángeles", "Los Angeles").replace("Ciudad de México", "Mexico City")} time` : `hora de ${name}`;
}

/** Para usar dentro de una frase: "hoy, 2:35 a.m." / "el 6 oct 2026, 2:35 a.m." (en: "today, 2:35 AM" / "on Oct 6, 2026, 2:35 AM"). */
export function fmtWhen(date: Date | string | number, lang: FmtLang = "es", now: Date = new Date(), tz = BUSINESS_TZ): string {
  const friendly = fmtFriendly(date, lang, now, tz);
  const full = fmtDateTime(date, lang, tz);
  if (friendly !== full) return friendly.charAt(0).toLowerCase() + friendly.slice(1);
  return lang === "en" ? `on ${full}` : `el ${full}`;
}
