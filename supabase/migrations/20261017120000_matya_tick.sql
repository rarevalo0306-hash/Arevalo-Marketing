-- MATYA tick: one additive column, the last time the per-minute worker ran. Apply only after review; no public RLS policies.
-- "AgentWorkspace" already has RLS on and no grants for anon/authenticated (20261016120000_matya_team.sql); a new column keeps them.
BEGIN;
-- AlterTable
ALTER TABLE "AgentWorkspace" ADD COLUMN IF NOT EXISTS "tickAt" TIMESTAMP(3);

COMMIT;
