ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "aiProfile" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "aiAutopublish" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "variants" JSONB;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "aiText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "aiImage" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "phone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "brandImages" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "logoLightUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "color2" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "color3" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "fontHeading" TEXT NOT NULL DEFAULT 'montserrat';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "fontBody" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "brandVoice" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "brandBookUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "hashtags" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "template" TEXT NOT NULL DEFAULT 'auto';
CREATE TABLE IF NOT EXISTS "Template" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "spec" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Template_businessId_idx" ON "Template"("businessId");
ALTER TABLE "Template" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "Template" FROM anon, authenticated;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "study" JSONB;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "studyInput" JSONB;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "studyAt" TIMESTAMP(3);
CREATE TABLE IF NOT EXISTS "SeoReport" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SeoReport_businessId_kind_createdAt_idx" ON "SeoReport"("businessId", "kind", "createdAt");
ALTER TABLE "SeoReport" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "SeoReport" FROM anon, authenticated;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "seoLocationCode" INTEGER;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "seoLocationName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "seoLanguage" TEXT NOT NULL DEFAULT 'es';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "seoKeywords" JSONB;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "seoDaily" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "seoLocations" JSONB;
-- 2026-10-06: avisos de SEO por email (alertas al bajar en Google y resumen de cada lunes).
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "seoAlertEmail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "seoAlerts" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "seoWeekly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "seoWeeklyAt" TIMESTAMP(3);
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "seoEmailLang" TEXT NOT NULL DEFAULT 'es';
-- 2026-10-06: mapa de calor en Google Maps (el negocio elegido en Google Maps).
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "seoMapPlace" JSONB;
-- 2026-10-06: reporte de SEO en PDF de cada mes (se manda el día 1 al email de los avisos).
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "seoMonthly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "seoMonthlyAt" TIMESTAMP(3);
-- 2026-10-07: cada cuántos días revisar las posiciones (1, 7, 15 o 30) y listas de contactos.
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "seoRankDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "lists" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
-- 2026-10-07: imágenes de la marca (logos sacados del manual y kit creado por la app: perfil, portadas, favicon…).
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "brandAssets" JSONB;
-- 2026-10-07: carpeta de Google Drive por negocio y biblioteca de fotos y videos reales (lo que vio la IA en cada uno).
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "driveFolderId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "driveFolderName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "driveSyncedAt" TIMESTAMP(3);
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "driveError" TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS "LibraryItem" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'drive',
  "externalId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT '',
  "folderPath" TEXT NOT NULL DEFAULT '',
  "mimeType" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL DEFAULT 'photo',
  "url" TEXT NOT NULL DEFAULT '',
  "thumbUrl" TEXT NOT NULL DEFAULT '',
  "width" INTEGER NOT NULL DEFAULT 0,
  "height" INTEGER NOT NULL DEFAULT 0,
  "durationSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sizeBytes" INTEGER NOT NULL DEFAULT 0,
  "takenAt" TIMESTAMP(3),
  "modifiedAt" TIMESTAMP(3),
  "description" JSONB,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "quality" INTEGER NOT NULL DEFAULT 0,
  "usable" BOOLEAN NOT NULL DEFAULT true,
  "privacy" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'new',
  "error" TEXT NOT NULL DEFAULT '',
  "choice" TEXT NOT NULL DEFAULT '',
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LibraryItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "LibraryItem_businessId_externalId_key" ON "LibraryItem"("businessId", "externalId");
CREATE INDEX IF NOT EXISTS "LibraryItem_businessId_status_idx" ON "LibraryItem"("businessId", "status");
