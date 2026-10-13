-- Etapa 2: invitar personas al equipo, a qué empresas entra cada una y contraseñas propias.
-- Correr UNA vez en Supabase (SQL Editor) ANTES de publicar el cambio de la app. Se puede volver a correr sin daño.
-- Solo agrega: la versión de la app que está en vivo sigue funcionando igual con este SQL.
BEGIN;

ALTER TABLE "Membership" ADD COLUMN IF NOT EXISTS "allBusinesses" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT NOT NULL DEFAULT '';
-- La organización cuyo Administrador pudo ver el enlace con el que se eligió la contraseña ('' = la eligió la persona).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordOrgId" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "MembershipBusiness" (
    "membershipId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,

    CONSTRAINT "MembershipBusiness_pkey" PRIMARY KEY ("membershipId","businessId")
);
CREATE INDEX IF NOT EXISTS "MembershipBusiness_businessId_idx" ON "MembershipBusiness"("businessId");

CREATE TABLE IF NOT EXISTS "Invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "allBusinesses" BOOLEAN NOT NULL DEFAULT true,
    "businessIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Invitation_tokenHash_key" ON "Invitation"("tokenHash");
CREATE INDEX IF NOT EXISTS "Invitation_organizationId_idx" ON "Invitation"("organizationId");
CREATE INDEX IF NOT EXISTS "Invitation_email_idx" ON "Invitation"("email");

CREATE TABLE IF NOT EXISTS "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT '',
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "PasswordReset" ADD COLUMN IF NOT EXISTS "organizationId" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");
CREATE INDEX IF NOT EXISTS "PasswordReset_userId_idx" ON "PasswordReset"("userId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MembershipBusiness_membershipId_fkey') THEN
    ALTER TABLE "MembershipBusiness" ADD CONSTRAINT "MembershipBusiness_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MembershipBusiness_businessId_fkey') THEN
    ALTER TABLE "MembershipBusiness" ADD CONSTRAINT "MembershipBusiness_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Invitation_organizationId_fkey') THEN
    ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PasswordReset_userId_fkey') THEN
    ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Solo la app (con su propia conexión) usa estas tablas: nada público.
ALTER TABLE "MembershipBusiness" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordReset" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "MembershipBusiness", "Invitation", "PasswordReset" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "MembershipBusiness", "Invitation", "PasswordReset" FROM authenticated;
  END IF;
END $$;

COMMIT;
