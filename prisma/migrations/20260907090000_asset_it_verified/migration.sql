-- Phase 14 (spec §5): an IT-class asset that Purchasing registers waits for
-- IT's check before Finance sees it. NULL on an IT asset means awaiting.
-- Purchasing assets never carry a value -- the predicate in asset-class.ts is
-- cls = IT AND itVerifiedAt IS NULL, so a null on a car means nothing.
ALTER TABLE "Asset" ADD COLUMN "itVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Asset" ADD COLUMN "itVerifiedById" TEXT;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_itVerifiedById_fkey"
  FOREIGN KEY ("itVerifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Asset_itVerifiedAt_idx" ON "Asset"("itVerifiedAt");

-- Every IT asset that exists today was registered by IT: Phase 13 allowed
-- nothing else. None is awaiting a check. A reseed TRUNCATs, so prisma/seed.ts
-- sets the same value itself (HANDOVER: a migration's backfill does not survive
-- a reseed).
UPDATE "Asset" SET "itVerifiedAt" = "createdAt" WHERE "cls" = 'IT';
