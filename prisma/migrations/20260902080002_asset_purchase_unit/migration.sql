ALTER TABLE "Asset" ADD COLUMN "purchaseUnitId" TEXT;

ALTER TABLE "Asset" ADD CONSTRAINT "Asset_purchaseUnitId_fkey"
  FOREIGN KEY ("purchaseUnitId") REFERENCES "PurchaseUnit"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Asset_purchaseUnitId_idx" ON "Asset"("purchaseUnitId");

ALTER TYPE "NoteKind" ADD VALUE 'RECEIVE';
