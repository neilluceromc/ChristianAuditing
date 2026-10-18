-- Phase 43 (spec §3): performance indexes for the queries the audit flagged as unindexed.
-- Plain CREATE INDEX (not CONCURRENTLY): Prisma runs each migration in a transaction.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PurchaseUnit_requestId_idx" ON "PurchaseUnit"("requestId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AssetDocument_assetId_idx" ON "AssetDocument"("assetId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Asset_warrantyUntil_idx" ON "Asset"("warrantyUntil");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Asset_purchasedAt_idx" ON "Asset"("purchasedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Asset_defectiveSince_idx" ON "Asset"("defectiveSince");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Asset_updatedAt_idx" ON "Asset"("updatedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Asset_cls_status_idx" ON "Asset"("cls", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Approval_type_idx" ON "Approval"("type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PurchaseRequest_updatedAt_idx" ON "PurchaseRequest"("updatedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditEntry_entityType_action_createdAt_idx" ON "AuditEntry"("entityType", "action", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Employee_employment_joinedAt_idx" ON "Employee"("employment", "joinedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Reservation_state_expiresAt_idx" ON "Reservation"("state", "expiresAt");
