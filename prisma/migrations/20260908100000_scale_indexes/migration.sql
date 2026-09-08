-- Phase 17 (spec §7): indexes for the paged orderings. Additive, no data change.
CREATE INDEX "Approval_state_updatedAt_idx" ON "Approval"("state", "updatedAt");
CREATE INDEX "Reservation_state_createdAt_idx" ON "Reservation"("state", "createdAt");
CREATE INDEX "AuditEntry_entityType_entityId_createdAt_idx" ON "AuditEntry"("entityType", "entityId", "createdAt");
CREATE INDEX "Employee_departmentId_idx" ON "Employee"("departmentId");
CREATE INDEX "Employee_name_idx" ON "Employee"("name");
CREATE INDEX "Employee_joinedAt_idx" ON "Employee"("joinedAt");
CREATE INDEX "WebhookDelivery_status_createdAt_idx" ON "WebhookDelivery"("status", "createdAt");
