-- DropForeignKey
ALTER TABLE "Approval" DROP CONSTRAINT "Approval_claimedById_fkey";

-- DropForeignKey
ALTER TABLE "AssetDocument" DROP CONSTRAINT "AssetDocument_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "EquipmentPolicy" DROP CONSTRAINT "EquipmentPolicy_appliesToDepartmentId_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseRequest" DROP CONSTRAINT "PurchaseRequest_reviewedById_fkey";

-- CreateIndex
CREATE INDEX "Asset_purchaseRequestId_idx" ON "Asset"("purchaseRequestId");

-- CreateIndex
CREATE INDEX "Asset_vendorId_idx" ON "Asset"("vendorId");

-- CreateIndex
CREATE INDEX "Reservation_assetId_idx" ON "Reservation"("assetId");

-- CreateIndex
CREATE INDEX "Reservation_employeeId_idx" ON "Reservation"("employeeId");

-- AddForeignKey
ALTER TABLE "AssetDocument" ADD CONSTRAINT "AssetDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentPolicy" ADD CONSTRAINT "EquipmentPolicy_appliesToDepartmentId_fkey" FOREIGN KEY ("appliesToDepartmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- EXECUTE_APPROVAL jobs must carry an approvalId key, or the one-live-job
-- partial unique above it silently no-ops (NULLs never collide)
ALTER TABLE "Job" ADD CONSTRAINT "Job_execute_payload_shape"
  CHECK (type <> 'EXECUTE_APPROVAL' OR payload ? 'approvalId');
