-- One ACTIVE hold per asset (the hold is the reservation row; races here create phantom double-promises)
CREATE UNIQUE INDEX "Reservation_one_active_hold_per_asset"
  ON "Reservation" ("assetId") WHERE "state" = 'ACTIVE';

-- At most one live execution job per approval (retry paths re-enqueue)
CREATE UNIQUE INDEX "Job_one_live_execute_per_approval"
  ON "Job" ((payload->>'approvalId'))
  WHERE "status" IN ('PENDING', 'RUNNING') AND "type" = 'EXECUTE_APPROVAL';

-- Case-insensitive account identity (credentials + SSO both match on email)
CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower(email));

-- Atomic ref-number allocation (PR-0001 / APR-0001 style)
CREATE SEQUENCE purchase_request_ref_seq START 1;
CREATE SEQUENCE approval_ref_seq START 1;

-- Sanity checks
ALTER TABLE "PurchaseUnit" ADD CONSTRAINT "PurchaseUnit_qty_positive" CHECK (qty > 0);
ALTER TABLE "PurchaseUnit" ADD CONSTRAINT "PurchaseUnit_price_nonneg" CHECK ("unitPrice" IS NULL OR "unitPrice" >= 0);
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_cost_nonneg" CHECK (cost IS NULL OR cost >= 0);
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_quote_nonneg" CHECK ("repairQuote" IS NULL OR "repairQuote" >= 0);
