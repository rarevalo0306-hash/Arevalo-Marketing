-- MATYA team of agents: additive columns only. Apply only after review; no public RLS policies.
BEGIN;
-- AlterTable
ALTER TABLE "AgentWorkspace"
  ADD COLUMN IF NOT EXISTS "teamMode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "dailyHour" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS "agentModels" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "modelPrices" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "allowSocial" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "allowWebArticles" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AgentRun"
  ADD COLUMN IF NOT EXISTS "plan" JSONB,
  ADD COLUMN IF NOT EXISTS "parentRunId" TEXT,
  ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'owner';

-- AlterTable
ALTER TABLE "AgentStep"
  ADD COLUMN IF NOT EXISTS "agent" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "model" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "attempt" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AgentBudget" ADD COLUMN IF NOT EXISTS "alerts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentRun_parentRunId_idx" ON "AgentRun"("parentRunId");

-- Keep the private control plane closed to the public API roles (idempotent re-assertion).
ALTER TABLE "AgentWorkspace" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "AgentWorkspace" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "AgentWorkspace" FROM authenticated; END IF;
END $$;

ALTER TABLE "AgentRun" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "AgentRun" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "AgentRun" FROM authenticated; END IF;
END $$;

ALTER TABLE "AgentStep" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "AgentStep" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "AgentStep" FROM authenticated; END IF;
END $$;

ALTER TABLE "AgentBudget" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "AgentBudget" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "AgentBudget" FROM authenticated; END IF;
END $$;

COMMIT;
