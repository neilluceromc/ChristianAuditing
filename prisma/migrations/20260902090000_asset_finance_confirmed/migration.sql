ALTER TABLE "Asset" ADD COLUMN "financeConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Asset" ADD COLUMN "financeConfirmedById" TEXT;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_financeConfirmedById_fkey"
  FOREIGN KEY ("financeConfirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Asset_financeConfirmedAt_idx" ON "Asset"("financeConfirmedAt");
