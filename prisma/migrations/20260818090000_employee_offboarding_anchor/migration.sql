-- "This offboarding" has to be a real, queryable window rather than "all of
-- this person's history". The − button on the employee record creates a
-- lifecycle.return on every routine laptop swap, so without an anchor the
-- offboarding wizard bills equipment somebody handed back years ago to their
-- farewell report — a signed financial document — and folds its cost into the
-- value-recovered total.
ALTER TABLE "Employee" ADD COLUMN "offboardingAt" TIMESTAMP(3);

-- Backfill anyone already past the ACTIVE stage. updatedAt is the closest
-- record we have of when they were marked, and it is strictly better than
-- NULL: a NULL anchor means "no window", so their report would show only
-- what they still hold.
UPDATE "Employee"
   SET "offboardingAt" = "updatedAt"
 WHERE employment IN ('OFFBOARDING', 'OFFBOARDED');
