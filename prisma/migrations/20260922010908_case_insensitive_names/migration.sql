-- CreateIndex
CREATE INDEX "AuditEntry_entityType_action_idx" ON "AuditEntry"("entityType", "action");

-- Phase 27 (spec §3.1): one name per table whatever the case. Postgres' plain UNIQUE is
-- case-sensitive, so "Laptop" and "laptop" were two rows; User.email has had this shape since
-- migration 20260814090100. Not expressible in schema.prisma — documented in HANDOVER/PICKUP
-- beside User_email_lower_key and Reservation_one_active_hold_per_asset as database-only invariants.
-- Fails loudly on a database that already holds two names differing only by case; run the
-- duplicate check in HANDOVER (t) before applying it to a live database.
CREATE UNIQUE INDEX "AssetCategory_name_lower_key"      ON "AssetCategory"   (lower(name));
CREATE UNIQUE INDEX "AssetType_category_name_lower_key" ON "AssetType"       ("categoryId", lower(name));
CREATE UNIQUE INDEX "Department_name_lower_key"         ON "Department"      (lower(name));
CREATE UNIQUE INDEX "EquipmentPolicy_name_lower_key"    ON "EquipmentPolicy" (lower(name));
CREATE UNIQUE INDEX "Vendor_name_lower_key"             ON "Vendor"          (lower(name));
CREATE UNIQUE INDEX "StockCategory_name_lower_key"      ON "StockCategory"   (lower(name));
CREATE UNIQUE INDEX "StockCategory_prefix_lower_key"    ON "StockCategory"   (lower(prefix));
