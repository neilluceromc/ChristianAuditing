-- Migration 38 (spec §3, §8): Purchase Orders replace Purchase Requests.
-- The tables keep their names ("PurchaseRequest", "PurchaseUnit"); the Prisma models are renamed with @@map/@map.
-- Nothing is dropped except the old state column and its type, after the data is mapped across.
-- The NoteEntry append-only guard is untouched (NoteEntry has no DDL here at all).

-- ── 1. Types ──────────────────────────────────────────────────────────
-- CreateEnum
CREATE TYPE "Team" AS ENUM ('IT', 'PURCHASING', 'FINANCE');

-- CreateEnum
CREATE TYPE "PurchaseOrderState" AS ENUM ('WITH_IT', 'SENT_BACK', 'READY', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('SENT_BACK', 'TO_CHECK', 'CHANGED');

-- ── 2. State: PurchaseRequestState -> PurchaseOrderState ──────────────
-- Mirrors legacyPoState (src/lib/po-flow.ts). A draft was never sent, so it lands back with Purchasing;
-- COMPLETED becomes READY ("Registered"/"Approved" are derived from the linked assets, never stored).
ALTER TABLE "PurchaseRequest" ADD COLUMN "state_new" "PurchaseOrderState";

UPDATE "PurchaseRequest" SET "state_new" = (CASE "state"::text
    WHEN 'DRAFT' THEN 'SENT_BACK'
    WHEN 'SUBMITTED' THEN 'WITH_IT'
    WHEN 'IT_REVIEWED' THEN 'WITH_IT'
    WHEN 'COMPLETED' THEN 'READY'
    WHEN 'CANCELLED' THEN 'CANCELLED'
END)::"PurchaseOrderState";

-- DropIndex
DROP INDEX "PurchaseRequest_state_idx";

ALTER TABLE "PurchaseRequest" DROP COLUMN "state";
ALTER TABLE "PurchaseRequest" RENAME COLUMN "state_new" TO "state";
ALTER TABLE "PurchaseRequest" ALTER COLUMN "state" SET NOT NULL;

-- CreateIndex
CREATE INDEX "PurchaseRequest_state_idx" ON "PurchaseRequest"("state");

-- DropEnum
DROP TYPE "PurchaseRequestState";

-- ── 3. Ref numbers: PR-0188 -> PO-0188 (the sequence purchase_request_ref_seq stays) ──
UPDATE "PurchaseRequest" SET "refNo" = 'PO-' || substring("refNo" from 4) WHERE "refNo" LIKE 'PR-%';

-- ── 4. New columns, foreign keys and indexes ──────────────────────────
-- AlterTable: the PO's own purchase facts, and the open send-back
ALTER TABLE "PurchaseRequest" ADD COLUMN     "invoiceRef" TEXT,
ADD COLUMN     "receiptRef" TEXT,
ADD COLUMN     "purchasedAt" TIMESTAMP(3),
ADD COLUMN     "fees" DECIMAL(12,2),
ADD COLUMN     "sentBackAt" TIMESTAMP(3),
ADD COLUMN     "sentBackById" TEXT,
ADD COLUMN     "sentBackBy" "Team",
ADD COLUMN     "sentBackFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sentBackNote" TEXT;

-- AlterTable: a line's category (its IT / non-IT class) and partial-delivery close-out
ALTER TABLE "PurchaseUnit" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "closedShort" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "closedShortReason" TEXT;

-- AlterTable: which team Finance's send-back landed on
ALTER TABLE "Asset" ADD COLUMN     "financeReturnedTo" "Team";

-- AlterTable: the PO a Register submit came from
ALTER TABLE "PurchaseRecord" ADD COLUMN     "purchaseOrderId" TEXT;

-- Sanity checks (the style of 20260814090100_integrity_constraints)
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_fees_nonneg" CHECK ("fees" IS NULL OR "fees" >= 0);
ALTER TABLE "PurchaseUnit" ADD CONSTRAINT "PurchaseUnit_closedShort_nonneg" CHECK ("closedShort" >= 0);

-- CreateIndex
CREATE INDEX "PurchaseUnit_categoryId_idx" ON "PurchaseUnit"("categoryId");

-- CreateIndex
CREATE INDEX "PurchaseRecord_purchaseOrderId_idx" ON "PurchaseRecord"("purchaseOrderId");

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_sentBackById_fkey" FOREIGN KEY ("sentBackById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseUnit" ADD CONSTRAINT "PurchaseUnit_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRecord" ADD CONSTRAINT "PurchaseRecord_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 5. The purchase-order thread's note kinds (the old kinds stay for history) ──
-- None of these is used in this migration: Postgres refuses to USE a value added in the same transaction.
ALTER TYPE "NoteKind" ADD VALUE 'PO_SAVED';
ALTER TYPE "NoteKind" ADD VALUE 'PO_SENT_BACK';
ALTER TYPE "NoteKind" ADD VALUE 'PO_RESUBMITTED';
ALTER TYPE "NoteKind" ADD VALUE 'PO_FIXED';
ALTER TYPE "NoteKind" ADD VALUE 'PO_REGISTERED';
ALTER TYPE "NoteKind" ADD VALUE 'PO_LINE_CLOSED';
ALTER TYPE "NoteKind" ADD VALUE 'PO_CANCELLED';

-- ── 6. Notifications (spec §7): team-addressed, with per-person read state ──
-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "team" "Team" NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT NOT NULL,
    "actorId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRead" (
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("notificationId","userId")
);

-- CreateIndex
CREATE INDEX "Notification_team_createdAt_idx" ON "Notification"("team", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationRead_userId_idx" ON "NotificationRead"("userId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
