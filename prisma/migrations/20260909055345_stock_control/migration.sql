-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('OPENING', 'RECEIPT', 'ISSUE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "StocktakeState" AS ENUM ('OPEN', 'POSTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "StockCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "packSize" INTEGER,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLot" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "supplierId" TEXT,
    "lotDate" TIMESTAMP(3) NOT NULL,
    "unitCost" DECIMAL(12,2),
    "quantity" INTEGER NOT NULL,
    "reference" TEXT,
    "receivedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lotId" TEXT,
    "departmentId" TEXT,
    "employeeId" TEXT,
    "reason" TEXT,
    "stocktakeId" TEXT,
    "actorId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stocktake" (
    "id" TEXT NOT NULL,
    "refNo" TEXT NOT NULL,
    "categoryId" TEXT,
    "state" "StocktakeState" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "note" TEXT,

    CONSTRAINT "Stocktake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StocktakeLine" (
    "id" TEXT NOT NULL,
    "stocktakeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "bookQty" INTEGER NOT NULL,
    "countedQty" INTEGER,
    "countedAt" TIMESTAMP(3),
    "countedById" TEXT,

    CONSTRAINT "StocktakeLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockCategory_name_key" ON "StockCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "StockCategory_prefix_key" ON "StockCategory"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_code_key" ON "StockItem"("code");

-- CreateIndex
CREATE INDEX "StockItem_categoryId_idx" ON "StockItem"("categoryId");

-- CreateIndex
CREATE INDEX "StockItem_archivedAt_idx" ON "StockItem"("archivedAt");

-- CreateIndex
CREATE INDEX "StockItem_name_idx" ON "StockItem"("name");

-- CreateIndex
CREATE INDEX "StockLot_itemId_idx" ON "StockLot"("itemId");

-- CreateIndex
CREATE INDEX "StockLot_supplierId_idx" ON "StockLot"("supplierId");

-- CreateIndex
CREATE INDEX "StockMovement_itemId_occurredAt_id_idx" ON "StockMovement"("itemId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "StockMovement_kind_idx" ON "StockMovement"("kind");

-- CreateIndex
CREATE INDEX "StockMovement_stocktakeId_idx" ON "StockMovement"("stocktakeId");

-- CreateIndex
CREATE INDEX "StockMovement_departmentId_idx" ON "StockMovement"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Stocktake_refNo_key" ON "Stocktake"("refNo");

-- CreateIndex
CREATE INDEX "Stocktake_state_idx" ON "Stocktake"("state");

-- CreateIndex
CREATE INDEX "Stocktake_categoryId_idx" ON "Stocktake"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "StocktakeLine_stocktakeId_itemId_key" ON "StocktakeLine"("stocktakeId", "itemId");

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "StockCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "Stocktake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "StockCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "Stocktake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 19 spec §2.7. forbid_mutation() exists since 20260814084417_append_only_triggers.
CREATE TRIGGER stock_movement_append_only
  BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE "StockMovement" ADD CONSTRAINT stock_movement_quantity_sign CHECK (
  ("kind" IN ('OPENING', 'RECEIPT') AND "quantity" > 0)
  OR ("kind" = 'ISSUE' AND "quantity" < 0)
  OR ("kind" = 'ADJUSTMENT' AND "quantity" <> 0)
);

ALTER TABLE "StockLot" ADD CONSTRAINT stock_lot_quantity_positive CHECK ("quantity" > 0);

CREATE SEQUENCE stocktake_ref_seq START 1;
