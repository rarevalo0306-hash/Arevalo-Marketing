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
-- 2026-10-08: link de subida para técnicos (las fotos y videos van a Cloudflare R2).
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "uploadToken" TEXT NOT NULL DEFAULT '';
-- 2026-10-08: dueño o representante del negocio (nombre, correo y teléfono).
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "ownerName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "ownerEmail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "ownerPhone" TEXT NOT NULL DEFAULT '';
-- 2026-10-08: plan de acción único (tareas del diagnóstico).
CREATE TABLE IF NOT EXISTS "ActionTask" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "area" TEXT NOT NULL,
  "title" JSONB NOT NULL,
  "detail" JSONB,
  "impact" INTEGER NOT NULL DEFAULT 2,
  "effort" INTEGER NOT NULL DEFAULT 2,
  "href" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'todo',
  "doneAt" TIMESTAMP(3),
  "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActionTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActionTask_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ActionTask_businessId_key_key" ON "ActionTask"("businessId", "key");
CREATE INDEX IF NOT EXISTS "ActionTask_businessId_status_idx" ON "ActionTask"("businessId", "status");

-- 2026-10-08: fase 3 (marca): identidad de la marca y fotos mejoradas por la app.
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "brandIdentity" JSONB;
ALTER TABLE "LibraryItem" ADD COLUMN IF NOT EXISTS "enhancedUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LibraryItem" ADD COLUMN IF NOT EXISTS "enhanceInfo" JSONB;
ALTER TABLE "LibraryItem" ADD COLUMN IF NOT EXISTS "enhancedAt" TIMESTAMP(3);
ALTER TABLE "LibraryItem" ADD COLUMN IF NOT EXISTS "useEnhanced" BOOLEAN NOT NULL DEFAULT true;

-- 2026-10-08: fase 4 (publicar y distribuir): campañas, registro de la IA, directorios y tipos de publicación.
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'post';
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "media" JSONB;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "altText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;
CREATE TABLE IF NOT EXISTS "Campaign" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "goal" TEXT NOT NULL DEFAULT '',
  "mode" TEXT NOT NULL DEFAULT 'approval',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3),
  "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "perWeek" INTEGER NOT NULL DEFAULT 3,
  "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "rules" JSONB,
  "budgetCents" INTEGER NOT NULL DEFAULT 0,
  "spentCents" INTEGER NOT NULL DEFAULT 0,
  "ads" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Campaign_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Campaign_businessId_status_idx" ON "Campaign"("businessId", "status");
CREATE TABLE IF NOT EXISTS "AiAction" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "campaignId" TEXT,
  "kind" TEXT NOT NULL,
  "summary" JSONB NOT NULL,
  "detail" JSONB,
  "actor" TEXT NOT NULL DEFAULT 'auto',
  "costCents" INTEGER NOT NULL DEFAULT 0,
  "postId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiAction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AiAction_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AiAction_businessId_createdAt_idx" ON "AiAction"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiAction_campaignId_createdAt_idx" ON "AiAction"("campaignId", "createdAt");
CREATE TABLE IF NOT EXISTS "DirectoryListing" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "directory" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'todo',
  "url" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "napOk" BOOLEAN,
  "checkedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DirectoryListing_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DirectoryListing_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "DirectoryListing_businessId_directory_key" ON "DirectoryListing"("businessId", "directory");
CREATE INDEX IF NOT EXISTS "Post_campaignId_idx" ON "Post"("campaignId");
DO $$ BEGIN
  ALTER TABLE "Post" ADD CONSTRAINT "Post_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2026-10-09: fase 5 (resultados): reporte diario, resultados de cada publicación y propuestas de la IA.
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "reportDaily" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "reportEmail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PostTarget" ADD COLUMN IF NOT EXISTS "externalId" TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS "PostMetric" (
  "id" TEXT NOT NULL,
  "postTargetId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "impressions" INTEGER NOT NULL DEFAULT 0,
  "reach" INTEGER NOT NULL DEFAULT 0,
  "likes" INTEGER NOT NULL DEFAULT 0,
  "comments" INTEGER NOT NULL DEFAULT 0,
  "shares" INTEGER NOT NULL DEFAULT 0,
  "saves" INTEGER NOT NULL DEFAULT 0,
  "clicks" INTEGER NOT NULL DEFAULT 0,
  "videoViews" INTEGER NOT NULL DEFAULT 0,
  "raw" JSONB,
  CONSTRAINT "PostMetric_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PostMetric_postTargetId_fkey" FOREIGN KEY ("postTargetId") REFERENCES "PostTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "PostMetric_postTargetId_fetchedAt_idx" ON "PostMetric"("postTargetId", "fetchedAt");
CREATE INDEX IF NOT EXISTS "PostMetric_businessId_fetchedAt_idx" ON "PostMetric"("businessId", "fetchedAt");
CREATE TABLE IF NOT EXISTS "AiProposal" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "campaignId" TEXT,
  "kind" TEXT NOT NULL,
  "title" JSONB NOT NULL,
  "detail" JSONB,
  "impact" INTEGER NOT NULL DEFAULT 2,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "action" JSONB,
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  CONSTRAINT "AiProposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiProposal_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AiProposal_businessId_status_idx" ON "AiProposal"("businessId", "status");
