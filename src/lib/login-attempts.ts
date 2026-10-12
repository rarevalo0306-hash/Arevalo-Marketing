import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { LOGIN_ATTEMPT_KEEP_MS, LOGIN_LOCK_SECONDS, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS } from "@/lib/login-limit";

const WINDOW = Prisma.raw(`interval '${LOGIN_WINDOW_SECONDS} seconds'`);
const LOCK = Prisma.raw(`interval '${LOGIN_LOCK_SECONDS} seconds'`);
const MAX = Prisma.raw(String(LOGIN_MAX_ATTEMPTS));

/**
 * Cuenta un intento de esa dirección y devuelve cuántos segundos debe esperar (0 = puede probar la contraseña).
 * Todo pasa en una sola sentencia: dos intentos al mismo tiempo no leen la misma cuenta. La hora es la de la base
 * (UTC). Pasada la ventana sin bloqueo, la cuenta vuelve a empezar.
 */
export async function countLoginAttempt(key: string): Promise<number> {
  const rows = await db.$queryRaw<{ wait: number }[]>`
    INSERT INTO "LoginAttempt" AS a ("key", "failures", "firstAt", "lockedUntil", "updatedAt")
    VALUES (${key}, 1, now() AT TIME ZONE 'UTC', NULL, now() AT TIME ZONE 'UTC')
    ON CONFLICT ("key") DO UPDATE SET
      "failures" = CASE
        WHEN a."firstAt" < EXCLUDED."firstAt" - ${WINDOW} AND (a."lockedUntil" IS NULL OR a."lockedUntil" <= EXCLUDED."firstAt") THEN 1
        ELSE a."failures" + 1 END,
      "firstAt" = CASE
        WHEN a."firstAt" < EXCLUDED."firstAt" - ${WINDOW} AND (a."lockedUntil" IS NULL OR a."lockedUntil" <= EXCLUDED."firstAt") THEN EXCLUDED."firstAt"
        ELSE a."firstAt" END,
      "lockedUntil" = CASE
        WHEN a."firstAt" < EXCLUDED."firstAt" - ${WINDOW} AND (a."lockedUntil" IS NULL OR a."lockedUntil" <= EXCLUDED."firstAt") THEN NULL
        WHEN a."lockedUntil" > EXCLUDED."firstAt" THEN a."lockedUntil"
        WHEN a."failures" + 1 > ${MAX} THEN EXCLUDED."firstAt" + ${LOCK}
        ELSE NULL END,
      "updatedAt" = EXCLUDED."updatedAt"
    RETURNING GREATEST(0, CEIL(EXTRACT(EPOCH FROM (COALESCE("lockedUntil", "updatedAt") - "updatedAt"))))::int AS "wait"`;
  return Number(rows[0]?.wait ?? 0);
}

/** Entró bien: esa dirección vuelve a tener todos sus intentos. */
export async function clearLoginAttempts(key: string): Promise<void> {
  await db.loginAttempt.deleteMany({ where: { key } });
}

/** Borra las cuentas viejas (de direcciones que nunca entraron bien). Lo llama el cron diario. */
export async function pruneLoginAttempts(now = new Date()): Promise<number> {
  const { count } = await db.loginAttempt.deleteMany({ where: { updatedAt: { lt: new Date(now.getTime() - LOGIN_ATTEMPT_KEEP_MS) } } });
  return count;
}
