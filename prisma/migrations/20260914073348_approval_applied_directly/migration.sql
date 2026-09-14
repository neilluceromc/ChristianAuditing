-- AlterTable
ALTER TABLE "Approval" ADD COLUMN     "appliedDirectly" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Approval_appliedDirectly_resolvedAt_idx" ON "Approval"("appliedDirectly", "resolvedAt");

-- Backfill: a direct row is the only kind whose claim and resolution share
-- one instant (createApproval writes both from one executed.at); a queue
-- row is claimed first and executed by the worker later. Marks the rows
-- Phase 15 has been writing since 2026-09-07.
UPDATE "Approval" SET "appliedDirectly" = true
WHERE "state" = 'EXECUTED' AND "claimedAt" IS NOT NULL AND "claimedAt" = "resolvedAt";
