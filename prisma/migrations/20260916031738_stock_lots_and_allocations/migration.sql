-- CreateEnum
CREATE TYPE "StockLotOrigin" AS ENUM ('RECEIPT', 'OPENING', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "StockLot" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "origin" "StockLotOrigin" NOT NULL DEFAULT 'RECEIPT';

-- CreateTable
CREATE TABLE "StockAllocation" (
    "id" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLotDocument" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLotDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockAllocation_lotId_idx" ON "StockAllocation"("lotId");

-- CreateIndex
CREATE INDEX "StockAllocation_movementId_idx" ON "StockAllocation"("movementId");

-- CreateIndex
CREATE UNIQUE INDEX "StockAllocation_movementId_lotId_key" ON "StockAllocation"("movementId", "lotId");

-- CreateIndex
CREATE INDEX "StockLotDocument_lotId_idx" ON "StockLotDocument"("lotId");

-- CreateIndex
CREATE INDEX "StockLot_itemId_expiresAt_idx" ON "StockLot"("itemId", "expiresAt");

-- AddForeignKey
ALTER TABLE "StockAllocation" ADD CONSTRAINT "StockAllocation_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAllocation" ADD CONSTRAINT "StockAllocation_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLotDocument" ADD CONSTRAINT "StockLotDocument_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLotDocument" ADD CONSTRAINT "StockLotDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Spec §2.6 — guards mirroring StockMovement's append-only trigger and
-- quantity CHECK (Phase 19's 20260909055345_stock_control migration.sql).
-- forbid_mutation() exists since 20260814084417_append_only_triggers.
CREATE TRIGGER stock_allocation_append_only
  BEFORE UPDATE OR DELETE ON "StockAllocation"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE "StockAllocation" ADD CONSTRAINT stock_allocation_quantity_positive CHECK ("quantity" > 0);

-- Spec §2.7 — backfill: every existing D1 inflow gets a lot, every D1 outflow
-- gets allocations, plain FIFO by "lotDate", "id" (no lot carries an expiry
-- before D2). A failed assertion (step 5) RAISEs, rolling back this whole
-- migration transaction and therefore failing the deploy rather than
-- shipping a wrong ledger.
DO $$
DECLARE
  mv          RECORD;
  lot         RECORD;
  item_id     TEXT;
  new_lot_id  TEXT;
  lot_origin  "StockLotOrigin";
  remaining   INTEGER;
  lot_open    INTEGER;
  take_qty    INTEGER;
BEGIN
  -- Step 1: the movement ledger is append-only; the trigger is disabled only
  -- for step 2's one-time backfill of "lotId" on lot-less inflows, and
  -- re-enabled in step 4 before the assertions in step 5.
  ALTER TABLE "StockMovement" DISABLE TRIGGER stock_movement_append_only;

  -- Step 2: every OPENING movement and every positive ADJUSTMENT that has no
  -- lot yet (D1 wrote these as bare movements, with no receiving flow) gets
  -- a lot of its own, dated at the movement's "occurredAt", uncosted.
  FOR mv IN
    SELECT * FROM "StockMovement"
    WHERE "lotId" IS NULL
      AND ("kind" = 'OPENING' OR ("kind" = 'ADJUSTMENT' AND "quantity" > 0))
    ORDER BY "occurredAt", "id"
  LOOP
    new_lot_id := md5(random()::text || clock_timestamp()::text);
    lot_origin := (CASE WHEN mv."kind" = 'OPENING' THEN 'OPENING' ELSE 'ADJUSTMENT' END)::"StockLotOrigin";

    INSERT INTO "StockLot"
      ("id", "itemId", "supplierId", "lotDate", "expiresAt", "origin", "unitCost", "quantity", "reference", "receivedById", "createdAt")
    VALUES
      (new_lot_id, mv."itemId", NULL, mv."occurredAt", NULL, lot_origin, NULL, mv."quantity", NULL, mv."actorId", mv."createdAt");

    UPDATE "StockMovement" SET "lotId" = new_lot_id WHERE "id" = mv."id";
  END LOOP;

  -- Step 3: replay every item's negative movements (ISSUE, negative
  -- ADJUSTMENT) in "occurredAt", "id" order, allocating -quantity across
  -- that item's lots. Pass 1 (P-3) restricts to lots dated on or before the
  -- movement, plain FIFO by "lotDate", "id"; pass 2 falls back to every lot
  -- for any remainder, so a D1 backdated receipt never leaves an outflow
  -- short. A lot's remaining is computed live as quantity minus whatever
  -- this replay has already allocated from it (visible mid-transaction).
  FOR item_id IN SELECT DISTINCT "itemId" FROM "StockMovement" WHERE "quantity" < 0 LOOP
    FOR mv IN
      SELECT * FROM "StockMovement"
      WHERE "itemId" = item_id AND "quantity" < 0
      ORDER BY "occurredAt", "id"
    LOOP
      remaining := -mv."quantity";

      -- Pass 1: lots dated on or before this movement.
      FOR lot IN
        SELECT * FROM "StockLot"
        WHERE "itemId" = item_id AND "lotDate" <= mv."occurredAt"
        ORDER BY "lotDate", "id"
      LOOP
        EXIT WHEN remaining <= 0;
        lot_open := lot."quantity" - COALESCE((SELECT SUM("quantity") FROM "StockAllocation" WHERE "lotId" = lot."id"), 0);
        IF lot_open > 0 THEN
          take_qty := LEAST(lot_open, remaining);
          INSERT INTO "StockAllocation" ("id", "movementId", "lotId", "quantity", "createdAt")
          VALUES (md5(random()::text || clock_timestamp()::text), mv."id", lot."id", take_qty, mv."createdAt");
          remaining := remaining - take_qty;
        END IF;
      END LOOP;

      -- Pass 2 (P-3): any remainder draws from every lot for the item, still
      -- in "lotDate", "id" order — lots pass 1 already exhausted simply have
      -- no remaining left and are skipped.
      IF remaining > 0 THEN
        FOR lot IN
          SELECT * FROM "StockLot"
          WHERE "itemId" = item_id
          ORDER BY "lotDate", "id"
        LOOP
          EXIT WHEN remaining <= 0;
          lot_open := lot."quantity" - COALESCE((SELECT SUM("quantity") FROM "StockAllocation" WHERE "lotId" = lot."id"), 0);
          IF lot_open > 0 THEN
            take_qty := LEAST(lot_open, remaining);
            INSERT INTO "StockAllocation" ("id", "movementId", "lotId", "quantity", "createdAt")
            VALUES (md5(random()::text || clock_timestamp()::text), mv."id", lot."id", take_qty, mv."createdAt");
            remaining := remaining - take_qty;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  -- Step 4: re-enable the append-only trigger before asserting the result.
  ALTER TABLE "StockMovement" ENABLE TRIGGER stock_movement_append_only;

  -- Step 5: assert the replay reconciles (spec §2.4's three invariants), or
  -- fail the migration rather than ship a wrong ledger.
  IF EXISTS (
    SELECT 1 FROM "StockMovement" m
    WHERE m."quantity" < 0
      AND COALESCE((SELECT SUM(a."quantity") FROM "StockAllocation" a WHERE a."movementId" = m."id"), 0) <> -m."quantity"
  ) THEN
    RAISE EXCEPTION 'stock_lots_and_allocations backfill: a negative movement''s allocations do not sum to -quantity';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "StockMovement" m
    WHERE m."lotId" IS NULL
      AND (m."kind" IN ('OPENING', 'RECEIPT') OR (m."kind" = 'ADJUSTMENT' AND m."quantity" > 0))
  ) THEN
    RAISE EXCEPTION 'stock_lots_and_allocations backfill: a positive movement has no lotId';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "StockLot" l
    WHERE l."quantity" - COALESCE((SELECT SUM(a."quantity") FROM "StockAllocation" a WHERE a."lotId" = l."id"), 0) < 0
  ) THEN
    RAISE EXCEPTION 'stock_lots_and_allocations backfill: a lot''s remaining quantity is negative';
  END IF;
END $$;
