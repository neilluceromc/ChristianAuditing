-- Migration 39b (PO form redesign, Task 1 review fix round 1): defaults, a foreign key and sanity checks that
-- migration 39 (20261023090000_po_form_fields, already applied) left out. Nothing is dropped.

-- ── 1. A category created anywhere but the PO form is confirmed ───────
-- The admin categories page, the seed and fixtures don't set confirmedAt; without a default they would create
-- unconfirmed categories. createCategoryFromPo passes confirmedAt = NULL explicitly for a new IT category.
-- AlterTable
ALTER TABLE "AssetCategory" ALTER COLUMN "confirmedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- ── 2. Who superseded a PO document (RESTRICT, like uploadedById) ─────
-- AddForeignKey
ALTER TABLE "RequestDocument" ADD CONSTRAINT "RequestDocument_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 3. Sanity checks (the style of PurchaseRequest_fees_nonneg, migration 38) ──
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_totalSales_nonneg" CHECK ("totalSales" IS NULL OR "totalSales" >= 0);
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_lessVat_nonneg" CHECK ("lessVat" IS NULL OR "lessVat" >= 0);
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_netOfVat_nonneg" CHECK ("netOfVat" IS NULL OR "netOfVat" >= 0);
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_discount_nonneg" CHECK ("discount" IS NULL OR "discount" >= 0);
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_amountDue_nonneg" CHECK ("amountDue" IS NULL OR "amountDue" >= 0);
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_addVat_nonneg" CHECK ("addVat" IS NULL OR "addVat" >= 0);
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_totalAmountDue_nonneg" CHECK ("totalAmountDue" IS NULL OR "totalAmountDue" >= 0);
ALTER TABLE "PurchaseUnit" ADD CONSTRAINT "PurchaseUnit_unit_nonblank" CHECK (length(btrim("unit")) >= 1);
