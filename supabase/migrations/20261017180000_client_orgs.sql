-- Organizaciones por cliente, entrega 1: cada cuenta (tabla "Organization") agrupa sus negocios en organizaciones de
-- cliente ("ClientOrg"), y cada negocio pertenece a una sola, de la misma cuenta.
-- Correr UNA vez en Supabase (SQL Editor) ANTES de fusionar la entrega 1. Se puede volver a correr sin daño.
-- Crea «Mis compañías» en cada cuenta que tenga negocios y pasa ahí los negocios que aún no tienen organización.
BEGIN;

CREATE TABLE IF NOT EXISTS "ClientOrg" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT NOT NULL DEFAULT '',
    "reportEmail" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "reportLang" TEXT NOT NULL DEFAULT 'es',
    "reportOn" BOOLEAN NOT NULL DEFAULT false,
    "reportDay" INTEGER NOT NULL DEFAULT 1,
    "reportHour" INTEGER NOT NULL DEFAULT 8,
    "timezone" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientOrg_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClientOrg_id_organizationId_key" ON "ClientOrg"("id", "organizationId");
CREATE INDEX IF NOT EXISTS "ClientOrg_organizationId_idx" ON "ClientOrg"("organizationId");

CREATE TABLE IF NOT EXISTS "ClientOrgReport" (
    "id" TEXT NOT NULL,
    "clientOrgId" TEXT NOT NULL,
    "week" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "to" TEXT[] NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientOrgReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ClientOrgReport_clientOrgId_createdAt_idx" ON "ClientOrgReport"("clientOrgId", "createdAt");
-- El envío automático de una semana sale una sola vez; los manuales y las pruebas se pueden repetir.
-- Prisma no expresa este índice: vive solo aquí.
CREATE UNIQUE INDEX IF NOT EXISTS "ClientOrgReport_cron_week_key" ON "ClientOrgReport"("clientOrgId", "week") WHERE "trigger" = 'cron';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClientOrg_organizationId_fkey') THEN
    ALTER TABLE "ClientOrg" ADD CONSTRAINT "ClientOrg_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClientOrgReport_clientOrgId_fkey') THEN
    ALTER TABLE "ClientOrgReport" ADD CONSTRAINT "ClientOrgReport_clientOrgId_fkey" FOREIGN KEY ("clientOrgId") REFERENCES "ClientOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Cada negocio pasa a una organización de su cuenta. Los que ya existen van a «Mis compañías».
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "clientOrgId" TEXT;
INSERT INTO "ClientOrg" ("id", "organizationId", "name")
SELECT 'corg_' || replace(gen_random_uuid()::text, '-', ''), o."id", 'Mis compañías'
FROM "Organization" o
WHERE EXISTS (SELECT 1 FROM "Business" b WHERE b."organizationId" = o."id" AND b."clientOrgId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "ClientOrg" c WHERE c."organizationId" = o."id");
UPDATE "Business" b
SET "clientOrgId" = (
  SELECT c."id" FROM "ClientOrg" c WHERE c."organizationId" = b."organizationId" ORDER BY c."createdAt", c."id" LIMIT 1
)
WHERE b."clientOrgId" IS NULL;
ALTER TABLE "Business" ALTER COLUMN "clientOrgId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "Business_clientOrgId_idx" ON "Business"("clientOrgId");
-- La clave compuesta: la base no deja que un negocio apunte a la organización de otra cuenta,
-- ni borrar una organización que todavía tiene negocios.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Business_clientOrgId_organizationId_fkey') THEN
    ALTER TABLE "Business" ADD CONSTRAINT "Business_clientOrgId_organizationId_fkey" FOREIGN KEY ("clientOrgId", "organizationId") REFERENCES "ClientOrg"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Solo la app (con su propia conexión) usa estas tablas: nada público.
ALTER TABLE "ClientOrg" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientOrgReport" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "ClientOrg", "ClientOrgReport" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "ClientOrg", "ClientOrgReport" FROM authenticated;
  END IF;
END $$;

COMMIT;
