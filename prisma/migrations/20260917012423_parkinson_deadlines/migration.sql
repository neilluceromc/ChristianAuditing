ALTER TABLE "Employee"  ADD COLUMN "offboardingDueAt" TIMESTAMP(3);
ALTER TABLE "Stocktake" ADD COLUMN "dueAt" TIMESTAMP(3);

-- Backfill (spec §0 decision 4). 7 calendar days = 5 working days for any weekday start; a
-- weekend start gets a day or two of grace rather than a Saturday deadline.
UPDATE "Employee"
   SET "offboardingDueAt" = date_trunc('day', COALESCE("offboardingAt", "updatedAt")) + interval '7 days'
 WHERE "employment" = 'OFFBOARDING' AND "offboardingDueAt" IS NULL;

UPDATE "Stocktake"
   SET "dueAt" = date_trunc('day', "openedAt") + interval '3 days'
 WHERE "dueAt" IS NULL;

ALTER TABLE "Stocktake" ALTER COLUMN "dueAt" SET NOT NULL;
