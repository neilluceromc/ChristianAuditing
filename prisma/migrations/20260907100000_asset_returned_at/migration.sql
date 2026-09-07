-- Phase 15 (spec §4.1): a returned IT device is "back, not checked" until IT
-- triages it. Set when a return lands on SPARE; cleared by any later status
-- write. No backfill: nothing is mid-triage today. Purchasing assets never
-- carry a value (isAssignable/applyLifecycle include the class).
ALTER TABLE "Asset" ADD COLUMN "returnedAt" TIMESTAMP(3);
CREATE INDEX "Asset_returnedAt_idx" ON "Asset"("returnedAt");
