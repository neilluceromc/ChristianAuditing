ALTER TABLE "Asset" ADD COLUMN "financeReturnedAt" TIMESTAMP(3);
ALTER TABLE "Asset" ADD COLUMN "financeReturnedById" TEXT;
ALTER TABLE "Asset" ADD COLUMN "financeReturnReason" TEXT;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_financeReturnedById_fkey"
  FOREIGN KEY ("financeReturnedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Asset_financeReturnedAt_idx" ON "Asset"("financeReturnedAt");
