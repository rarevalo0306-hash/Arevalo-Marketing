import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Con el "Transaction pooler" de Supabase (puerto 6543 / pgbouncer=true), una sola conexión por servidor hace que
 * las páginas que piden muchas cosas a la vez (Diagnóstico) esperen en fila y fallen a los 10 s. Ahí se usan hasta
 * 5 conexiones y se espera hasta 30 s. Con una conexión directa (5432) no se cambia el límite, solo la espera.
 */
export function tunedDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    const pooled = u.port === "6543" || u.searchParams.get("pgbouncer") === "true";
    const limit = Number(u.searchParams.get("connection_limit") || "0");
    if (pooled && limit < 5) u.searchParams.set("connection_limit", "5");
    if (!u.searchParams.get("pool_timeout")) u.searchParams.set("pool_timeout", "30");
    return u.toString();
  } catch {
    return raw;
  }
}

const url = tunedDatabaseUrl(process.env.DATABASE_URL);

export const db = globalForPrisma.prisma ?? new PrismaClient(url ? { datasources: { db: { url } } } : undefined);

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
