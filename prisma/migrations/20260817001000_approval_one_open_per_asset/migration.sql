-- One OPEN approval per asset, enforced in the database. Two concurrent
-- requests both read "no open approval" under READ COMMITTED and both
-- insert; this turns that race into a catchable unique violation (P2002).
CREATE UNIQUE INDEX "Approval_one_open_per_asset"
  ON "Approval" ("assetId")
  WHERE "assetId" IS NOT NULL AND state IN ('PENDING', 'CLAIMED', 'APPROVED');
