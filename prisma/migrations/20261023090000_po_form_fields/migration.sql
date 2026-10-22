-- Migration 39 (PO form redesign, spec §4, §5, §5b): PO number, paid by, the seven typed totals, line units,
-- category confirmation and document supersede. Nothing is dropped; every new column is nullable or defaulted.
-- The tables keep their names ("PurchaseRequest" = PurchaseOrder, "PurchaseUnit" = PurchaseOrderLine).

-- ── 1. Types and columns ──────────────────────────────────────────────
-- CreateEnum
CREATE TYPE "PaidBy" AS ENUM ('CREDIT_CARD', 'DEBIT_CARD');

-- AlterTable: the vendor's PO number, how it was paid, the totals typed off the sales invoice, and the form flag.
-- formV2 is false on every existing PO (legacy: the new fields stay optional).
ALTER TABLE "PurchaseRequest" ADD COLUMN     "poNumber" TEXT,
ADD COLUMN     "paidBy" "PaidBy",
ADD COLUMN     "totalSales" DECIMAL(12,2),
ADD COLUMN     "lessVat" DECIMAL(12,2),
ADD COLUMN     "netOfVat" DECIMAL(12,2),
ADD COLUMN     "discount" DECIMAL(12,2),
ADD COLUMN     "amountDue" DECIMAL(12,2),
ADD COLUMN     "addVat" DECIMAL(12,2),
ADD COLUMN     "totalAmountDue" DECIMAL(12,2),
ADD COLUMN     "totalsConsistent" BOOLEAN,
ADD COLUMN     "formV2" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: a line's unit, free text up to 12 characters; existing lines read "pc".
ALTER TABLE "PurchaseUnit" ADD COLUMN     "unit" VARCHAR(12) NOT NULL DEFAULT 'pc';

-- AlterTable: a category Purchasing creates from a PO, and whether IT has confirmed it.
ALTER TABLE "AssetCategory" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT;

-- AlterTable: Remove marks a PO document superseded; nothing is deleted (append-only).
ALTER TABLE "RequestDocument" ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "supersededById" TEXT;

-- AddForeignKey
ALTER TABLE "AssetCategory" ADD CONSTRAINT "AssetCategory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 2. Every existing category is confirmed ───────────────────────────
UPDATE "AssetCategory" SET "confirmedAt" = now();

-- ── 3. PO number: unique, ignoring case and outer spaces, among POs that aren't cancelled ──
-- An expression + partial index, so it lives in SQL only (schema.prisma can't express it; like the lower(name)
-- indexes of 20260922010908_case_insensitive_names). A cancelled PO frees its number.
CREATE UNIQUE INDEX "PurchaseRequest_poNumber_live_key" ON "PurchaseRequest"(lower(btrim("poNumber"))) WHERE "poNumber" IS NOT NULL AND "state" <> 'CANCELLED';
