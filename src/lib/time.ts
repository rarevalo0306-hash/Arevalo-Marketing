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
