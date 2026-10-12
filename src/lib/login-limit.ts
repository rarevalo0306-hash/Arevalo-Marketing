import { createHmac } from "crypto";

// Límite de intentos para entrar: cada dirección tiene 5 intentos cada 15 minutos y el 6.º la bloquea 15 minutos.
// El intento se cuenta ANTES de revisar la contraseña, en una sola operación de la base (src/lib/login-attempts.ts),
// así que mandar muchos intentos a la vez no salta el límite. Entrar bien borra la cuenta de esa dirección.

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const LOGIN_LOCK_SECONDS = 15 * 60;

type HeaderBag = { get(name: string): string | null };

/** La IP de quien entra, tal como la pone Vercel (x-real-ip, o la primera de x-forwarded-for). */
export function clientIp(h: HeaderBag): string {
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local";
}

/** Huella de la dirección para la tabla LoginAttempt: no se guarda la IP. */
export function attemptKey(ip: string, secret = process.env.APP_SECRET ?? ""): string {
  return createHmac("sha256", secret).update(`login:${ip}`).digest("hex");
}

/** Minutos que se muestran al bloqueado (al menos 1). */
export const waitMinutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));

/**
 * ¿El error es que la tabla LoginAttempt todavía no existe (el SQL aún no se corrió)? Solo en ese caso se entra sin
 * límite. Con cualquier otro error de la base (sin conexiones, solo lectura…) no se revisa la contraseña.
 * Prisma: P2010 con el código de Postgres 42P01 (consulta directa) o P2021 (tabla que no existe).
 */
export function missingTable(e: unknown): boolean {
  const err = e as { code?: unknown; meta?: { code?: unknown } } | null;
  return err?.code === "P2021" || (err?.code === "P2010" && err.meta?.code === "42P01");
}

/** Filas más viejas que esto ya no tienen ni ventana ni bloqueo vigente: el cron diario las borra. */
export const LOGIN_ATTEMPT_KEEP_MS = 24 * 60 * 60 * 1000;
