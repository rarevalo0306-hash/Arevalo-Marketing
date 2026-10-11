import { describe, expect, it } from "vitest";
import { tunedDatabaseUrl } from "@/lib/db";

describe("tunedDatabaseUrl", () => {
  it("con el pooler de Supabase sube a 5 conexiones y espera 30 s", () => {
    const u = new URL(tunedDatabaseUrl("postgresql://u:p@aws-0-ca-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1")!);
    expect(u.searchParams.get("connection_limit")).toBe("5");
    expect(u.searchParams.get("pool_timeout")).toBe("30");
    expect(u.searchParams.get("pgbouncer")).toBe("true");
  });
  it("no baja un límite más alto ni cambia una espera ya puesta", () => {
    const u = new URL(tunedDatabaseUrl("postgresql://u:p@h:6543/db?connection_limit=10&pool_timeout=20")!);
    expect(u.searchParams.get("connection_limit")).toBe("10");
    expect(u.searchParams.get("pool_timeout")).toBe("20");
  });
  it("con conexión directa no toca el límite", () => {
    const u = new URL(tunedDatabaseUrl("postgresql://u:p@db.x.supabase.co:5432/postgres")!);
    expect(u.searchParams.get("connection_limit")).toBeNull();
    expect(u.searchParams.get("pool_timeout")).toBe("30");
  });
  it("sin URL o con algo raro la deja igual", () => {
    expect(tunedDatabaseUrl(undefined)).toBeUndefined();
    expect(tunedDatabaseUrl("no es una url")).toBe("no es una url");
  });
});
