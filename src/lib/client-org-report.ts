// Reglas del reporte semanal por email de una organización de clientes (ClientOrg): qué semana se reporta, cuándo
// toca mandarlo, qué datos de contacto y horario se guardan y cuándo se reintenta un envío que falló.
// Este archivo es PURO (sin base de datos ni red) pero solo se usa en el servidor: importa seo/alerts, que trae el
// resto del servidor. No lo importes desde componentes del navegador (para eso está client-orgs.ts).
import { addDays, appTz, isValidTz, localDay } from "@/lib/business-tz";
import { bi } from "@/lib/i18n";
import { parseAlertEmails } from "@/lib/seo/alerts";
import { localToUtc } from "@/lib/time";

// ---------- La semana ----------

/** Una semana de lunes a domingo: `week` es el lunes (AAAA-MM-DD), `fromDay`/`toDay` los días que abarca. */
export type ReportWeek = { week: string; fromDay: string; toDay: string };

/** El lunes de la semana en la que cae un día ("2026-10-21" → "2026-10-19"). */
function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(day, -((dow + 6) % 7));
}

/** La última semana completa (lunes a domingo) antes de `now`, contada en la hora de la organización. */
export function reportWeek(now: Date, tz: string): ReportWeek {
  const fromDay = addDays(mondayOf(localDay(now, tz)), -7);
  return { week: fromDay, fromDay, toDay: addDays(fromDay, 6) };
}

/**
 * La semana que toca mandar ahora, o null. El momento de envío de esta semana es el día elegido (0 = domingo …
 * 6 = sábado, contado desde el lunes de esta semana) a la hora elegida, en la hora de la organización; si ya pasó,
 * toca la última semana completa. Con el reporte apagado nunca toca.
 */
export function dueWeek(org: { reportOn: boolean; reportDay: number; reportHour: number }, now: Date, tz: string): ReportWeek | null {
  if (!org.reportOn) return null;
  const sendDay = addDays(mondayOf(localDay(now, tz)), (org.reportDay + 6) % 7);
  const sendAt = localToUtc(sendDay, 0, `${String(org.reportHour).padStart(2, "0")}:00`, tz);
  return now.getTime() >= sendAt.getTime() ? reportWeek(now, tz) : null;
}

/** La zona de la organización: la suya si es válida; si está vacía o no sirve, la de la app. */
export function orgTz(timezone: string): string {
  const tz = timezone.trim();
  return isValidTz(tz) ? tz : appTz();
}

// ---------- Ajustes ----------

export type ReportSettings = {
  contactName: string;
  reportEmail: string;
  phone: string;
  reportLang: "es" | "en";
  reportOn: boolean;
  reportDay: number;
  reportHour: number;
  timezone: string;
};

const CONTACT_NAME_MAX = 120;
const PHONE_MAX = 40;

/** Un número entero en texto ("5") dentro de un rango, o null. */
function intIn(text: string, min: number, max: number): number | null {
  if (!/^\d{1,2}$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

/**
 * Lee y valida los ajustes del reporte de una organización (los campos del formulario, como texto). Quita los
 * espacios, y si un campo no sirve lanza un BiError que lo nombra (el primero que falle).
 */
export function readReportSettings(raw: Record<string, string>): ReportSettings {
  const get = (k: string) => (raw[k] ?? "").trim();

  const contactName = get("contactName");
  if (contactName.length > CONTACT_NAME_MAX) {
    throw bi(`El nombre de contacto puede tener hasta ${CONTACT_NAME_MAX} caracteres.`, `The contact name can be up to ${CONTACT_NAME_MAX} characters.`);
  }

  const emails = parseAlertEmails(get("reportEmail"));
  if (!emails.ok) throw bi("Escribe hasta 3 emails válidos para el reporte.", "Enter up to 3 valid emails for the report.");

  const phone = get("phone");
  if (phone.length > PHONE_MAX) {
    throw bi(`El teléfono puede tener hasta ${PHONE_MAX} caracteres.`, `The phone number can be up to ${PHONE_MAX} characters.`);
  }

  const reportLang = get("reportLang");
  if (reportLang !== "es" && reportLang !== "en") {
    throw bi("Elige el idioma del reporte: español o inglés.", "Choose the report language: Spanish or English.");
  }

  const reportDay = intIn(get("reportDay"), 0, 6);
  if (reportDay === null) throw bi("Elige el día del reporte (de domingo a sábado).", "Choose the report day (Sunday to Saturday).");

  const reportHour = intIn(get("reportHour"), 0, 23);
  if (reportHour === null) throw bi("Elige la hora del reporte (de 0 a 23).", "Choose the report hour (0 to 23).");

  const timezone = get("timezone");
  if (timezone && !isValidTz(timezone)) throw bi("La zona horaria del reporte no es válida.", "The report time zone is not valid.");

  return { contactName, reportEmail: emails.emails.join(", "), phone, reportLang, reportOn: raw.reportOn === "on", reportDay, reportHour, timezone };
}

// ---------- Reintentos ----------

/** Intentos en total de un envío automático (el primero cuenta). */
export const MAX_ATTEMPTS = 3;
/** Cuánto se espera entre un intento y el siguiente. */
export const RETRY_MS = 30 * 60_000;

/**
 * ¿Se reintenta este envío automático? Si falló (error) o quedó trabado (sending), le quedan intentos y pasaron
 * al menos 30 minutos desde el último movimiento.
 */
export function retryable(row: { state: string; attempts: number; updatedAt: Date }, now: Date): boolean {
  if (row.state !== "error" && row.state !== "sending") return false;
  return row.attempts < MAX_ATTEMPTS && now.getTime() - row.updatedAt.getTime() >= RETRY_MS;
}
