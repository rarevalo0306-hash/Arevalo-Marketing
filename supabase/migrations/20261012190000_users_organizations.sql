-- Etapa 1 de «Usuario → Organización → Empresas»: personas con su correo, organizaciones y papeles.
-- Correr UNA vez en Supabase (SQL Editor) JUSTO ANTES de publicar el cambio de la app. Se puede volver a correr sin daño.
-- Entre este SQL y la publicación, «Agregar negocio» falla en la versión vieja: no agregues negocios en ese rato.
-- Crea la organización «Ricardo Arevalo» y le pasa todos los negocios. Los correos de LOGIN_EMAILS quedan como sus
-- Administradores al entrar (lo hace la app, src/lib/accounts.ts).
BEGIN;

CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

CREATE TABLE IF NOT EXISTS "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'personal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");
CREATE INDEX IF NOT EXISTS "Membership_organizationId_idx" ON "Membership"("organizationId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Membership_userId_fkey') THEN
    ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Membership_organizationId_fkey') THEN
    ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Cada negocio pasa a ser de una organización. Los que ya existen van a «Ricardo Arevalo».
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
INSERT INTO "Organization" ("id", "name", "kind")
SELECT 'org_' || replace(gen_random_uuid()::text, '-', ''), 'Ricardo Arevalo', 'personal'
WHERE NOT EXISTS (SELECT 1 FROM "Organization");
UPDATE "Business"
SET "organizationId" = (SELECT "id" FROM "Organization" ORDER BY "createdAt", "id" LIMIT 1)
WHERE "organizationId" IS NULL;
ALTER TABLE "Business" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "Business_organizationId_idx" ON "Business"("organizationId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Business_organizationId_fkey') THEN
    ALTER TABLE "Business" ADD CONSTRAINT "Business_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Solo la app (con su propia conexión) usa estas tablas: nada público.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "User", "Organization", "Membership" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "User", "Organization", "Membership" FROM authenticated;
  END IF;
END $$;

COMMIT;
