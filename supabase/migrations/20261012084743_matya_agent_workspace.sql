-- Private agent control plane. Apply only after review; no public RLS policies.
BEGIN;
-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "agentRunId" TEXT;

-- CreateTable
CREATE TABLE "AgentWorkspace" (
    "businessId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'auto',
    "allowPublish" BOOLEAN NOT NULL DEFAULT false,
    "industry" TEXT NOT NULL DEFAULT 'general',
    "objective" TEXT NOT NULL DEFAULT '',
    "memory" TEXT NOT NULL DEFAULT '',
    "knowledge" JSONB NOT NULL DEFAULT '[]',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dailyBudgetCents" INTEGER NOT NULL DEFAULT 0,
    "runBudgetCents" INTEGER NOT NULL DEFAULT 0,
    "maxPostsPerDay" INTEGER NOT NULL DEFAULT 3,
    "radarEnabled" BOOLEAN NOT NULL DEFAULT false,
    "radarHours" INTEGER NOT NULL DEFAULT 24,
    "radarAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentWorkspace_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" INTEGER NOT NULL DEFAULT 0,
    "context" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT NOT NULL DEFAULT '',
    "reservedCents" INTEGER NOT NULL DEFAULT 0,
    "chargedCents" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT NOT NULL DEFAULT '',
    "leaseUntil" TIMESTAMP(3),
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialist" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "output" JSONB,
    "reservedCents" INTEGER NOT NULL DEFAULT 0,
    "chargedCents" INTEGER NOT NULL DEFAULT 0,
    "budgetDay" TEXT NOT NULL,
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "runId" TEXT,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentBudget" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "reservedCents" INTEGER NOT NULL DEFAULT 0,
    "chargedCents" INTEGER NOT NULL DEFAULT 0,
    "posts" INTEGER NOT NULL DEFAULT 0,
    "deliveries" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AgentBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentNews" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'detected',
    "summary" TEXT NOT NULL DEFAULT '',
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "contentHash" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "AgentNews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_status_createdAt_idx" ON "AgentRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_businessId_createdAt_idx" ON "AgentRun"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_businessId_requestKey_key" ON "AgentRun"("businessId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgentStep_runId_name_key" ON "AgentStep"("runId", "name");

-- CreateIndex
CREATE INDEX "AgentMessage_businessId_createdAt_idx" ON "AgentMessage"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMessage_runId_role_key" ON "AgentMessage"("runId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "AgentBudget_businessId_day_key" ON "AgentBudget"("businessId", "day");

-- CreateIndex
CREATE INDEX "AgentNews_businessId_eventKey_idx" ON "AgentNews"("businessId", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgentNews_businessId_canonicalUrl_key" ON "AgentNews"("businessId", "canonicalUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_agentRunId_key" ON "Campaign"("agentRunId");

-- AddForeignKey
ALTER TABLE "AgentWorkspace" ADD CONSTRAINT "AgentWorkspace_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentBudget" ADD CONSTRAINT "AgentBudget_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentNews" ADD CONSTRAINT "AgentNews_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;


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

ALTER TABLE "AgentMessage" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "AgentMessage" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "AgentMessage" FROM authenticated; END IF;
END $$;

ALTER TABLE "AgentBudget" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "AgentBudget" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "AgentBudget" FROM authenticated; END IF;
END $$;

ALTER TABLE "AgentNews" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "AgentNews" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "AgentNews" FROM authenticated; END IF;
END $$;

COMMIT;
