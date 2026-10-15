-- AlterTable
ALTER TABLE "AssetCategory" ADD COLUMN     "depreciationLifeMonths" INTEGER,
ADD COLUMN     "depreciationSalvagePercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "depreciationLifeMonths" INTEGER,
ADD COLUMN     "depreciationNote" TEXT,
ADD COLUMN     "depreciationSalvage" DECIMAL(12,2),
ADD COLUMN     "financeNotCapitalised" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "financeResubmitNote" TEXT,
ADD COLUMN     "financeReturnFields" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Phase 35 (spec §6): an override is both fields or neither.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_depreciation_override_pair"
  CHECK (("depreciationLifeMonths" IS NULL) = ("depreciationSalvage" IS NULL));
-- Phase 35 (spec §6): "not capitalised" is an approval of an asset with no cost.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_not_capitalised_needs_confirm"
  CHECK (NOT "financeNotCapitalised" OR "financeConfirmedAt" IS NOT NULL);
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_not_capitalised_no_cost"
  CHECK (NOT "financeNotCapitalised" OR "cost" IS NULL);
