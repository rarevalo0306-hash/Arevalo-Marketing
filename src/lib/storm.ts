// Campaña de tormenta: tipos de evento y horarios que respetan las reglas de Florida para public adjusters.
import { BUSINESS_TZ, localToUtc } from "@/lib/time";

// name / nameEn: lo que ve el usuario en la app. en: lo que se le dice a la IA.
export const STORM_EVENTS = [
  { id: "huracan", name: "Huracán", nameEn: "Hurricane", en: "hurricane" },
  { id: "inundacion", name: "Inundación", nameEn: "Flood", en: "flood" },
  { id: "tornado", name: "Tornado o tormenta fuerte", nameEn: "Tornado or severe storm", en: "tornado or severe windstorm" },
  { id: "granizo", name: "Granizo", nameEn: "Hail", en: "hailstorm" },
  { id: "lluvias", name: "Lluvias fuertes y filtraciones", nameEn: "Heavy rain and leaks", en: "heavy rain and roof or water leaks" },
] as const;
export type StormEvent = (typeof STORM_EVENTS)[number]["id"];
export const stormEvent = (id: string) => STORM_EVENTS.find((e) => e.id === id);

/** "seguridad": ayuda y educación, sin ofrecer servicios. "oferta": invita a contactar al negocio. */
export type StormPhase = "seguridad" | "oferta";

// Florida (626.854): el public adjuster no puede iniciar contacto para ofrecer servicios en las primeras 48 horas
// después del evento, ni de 8 pm a 8 am, ni los domingos. Se deja un margen.
export const OFFER_WAIT_HOURS = 49;
const FIRST_HOUR = 9;
const LAST_HOUR = 19;

function local(d: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), sunday: p.weekday === "Sun" };
}

/** Hora de publicación: el evento + las horas que pidió la IA, movida a un horario permitido. */
export function stormSchedule(eventAt: Date, hoursAfter: number, phase: StormPhase, tz = BUSINESS_TZ): Date {
  const hours = Math.max(phase === "oferta" ? OFFER_WAIT_HOURS : 1, Math.min(14 * 24, hoursAfter || 0));
  let at = new Date(eventAt.getTime() + hours * 3600000);
  for (let i = 0; i < 4; i++) {
    const l = local(at, tz);
    if (l.hour < FIRST_HOUR) at = localToUtc(l.date, 0, `${FIRST_HOUR}:00`, tz);
    else if (l.hour >= LAST_HOUR) at = localToUtc(l.date, 1, `${FIRST_HOUR}:00`, tz);
    else if (phase === "oferta" && l.sunday) at = localToUtc(l.date, 1, `${FIRST_HOUR}:00`, tz);
    else break;
  }
  return at;
}
