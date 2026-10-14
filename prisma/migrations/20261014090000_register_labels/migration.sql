-- AlterTable
ALTER TABLE "AssetCategory" ADD COLUMN     "tagPrefix" TEXT;

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "labelPrintedAt" TIMESTAMP(3),
ADD COLUMN     "purchaseRecordId" TEXT,
ADD COLUMN     "receiptRef" TEXT,
ADD COLUMN     "warrantyContact" TEXT,
ADD COLUMN     "warrantyCoveredBy" TEXT;

-- CreateTable
CREATE TABLE "PurchaseRecord" (
    "id" TEXT NOT NULL,
    "cls" "AssetClass" NOT NULL,
    "vendorId" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "invoiceRef" TEXT,
    "receiptRef" TEXT,
    "unitCost" DECIMAL(12,2),
    "fees" DECIMAL(12,2),
    "quantity" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseRecord_createdAt_idx" ON "PurchaseRecord"("createdAt");

-- CreateIndex
CREATE INDEX "PurchaseRecord_cls_createdAt_idx" ON "PurchaseRecord"("cls", "createdAt");

-- CreateIndex
CREATE INDEX "Asset_purchaseRecordId_idx" ON "Asset"("purchaseRecordId");

-- CreateIndex
CREATE INDEX "Asset_labelPrintedAt_idx" ON "Asset"("labelPrintedAt");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_purchaseRecordId_fkey" FOREIGN KEY ("purchaseRecordId") REFERENCES "PurchaseRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRecord" ADD CONSTRAINT "PurchaseRecord_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRecord" ADD CONSTRAINT "PurchaseRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 34 (spec §2, §7): backfill + IT category reshape. Idempotent and name-keyed: a step whose
-- source row is missing does nothing. Category-level moves only change categoryId/typeId; tags,
-- holders, statuses, loan dates and history are untouched. No AuditEntry (reference-data move).

UPDATE "Asset" SET "labelPrintedAt" = "createdAt" WHERE "labelPrintedAt" IS NULL;

DO $$
DECLARE
  c_other TEXT; c_mouse TEXT; c_phone TEXT; c_periph TEXT;
  t_phone TEXT; t_keyboard TEXT; t_wired TEXT;
BEGIN
  -- 1. Dock -> Docking Station
  UPDATE "AssetCategory" SET "name" = 'Docking Station'
   WHERE "name" = 'Dock' AND NOT EXISTS (SELECT 1 FROM "AssetCategory" WHERE lower("name") = 'docking station');

  -- 2. New categories (deterministic ids so a re-run finds them)
  INSERT INTO "AssetCategory" ("id","name","locked","cls","tagPrefix")
  SELECT v.id, v.name, false, 'IT', v.prefix
    FROM (VALUES ('p34cat_ws','Workstation (PC)','WS'), ('p34cat_mouse','Mouse','MS'),
                 ('p34cat_hub','Type C Hub','HB'), ('p34cat_bag','Laptop Bag','BG'), ('p34cat_other','Other','OT')) AS v(id,name,prefix)
   WHERE NOT EXISTS (SELECT 1 FROM "AssetCategory" c WHERE lower(c."name") = lower(v.name));

  -- 3. tagPrefix for the categories that keep their tags (only where unset)
  UPDATE "AssetCategory" SET "tagPrefix" = v.prefix
    FROM (VALUES ('Laptop','LT'), ('Monitor','MN'), ('Headset','HS'), ('Docking Station','DK')) AS v(name,prefix)
   WHERE "AssetCategory"."name" = v.name AND "AssetCategory"."tagPrefix" IS NULL;

  SELECT "id" INTO c_other  FROM "AssetCategory" WHERE "name" = 'Other';
  SELECT "id" INTO c_mouse  FROM "AssetCategory" WHERE "name" = 'Mouse';
  SELECT "id" INTO c_phone  FROM "AssetCategory" WHERE "name" = 'Phone';
  SELECT "id" INTO c_periph FROM "AssetCategory" WHERE "name" = 'Peripheral';

  -- 4. Types for the new categories (never duplicating a name inside a category)
  INSERT INTO "AssetType" ("id","name","categoryId","locked")
  SELECT 'p34type_' || md5(cat.name || '/' || v.name), v.name, cat.id, false
    FROM (VALUES ('Workstation (PC)','Desktop tower'), ('Workstation (PC)','Mini PC'), ('Workstation (PC)','All-in-one'),
                 ('Mouse','Wireless'), ('Type C Hub','USB-C Hub'), ('Laptop Bag','Backpack'), ('Laptop Bag','Sleeve'),
                 ('Other','Phone'), ('Other','Keyboard'), ('Other','Webcam'), ('Other','Speaker'), ('Other','Printer')) AS v(cat,name)
    JOIN "AssetCategory" cat ON cat."name" = v.cat
   WHERE NOT EXISTS (SELECT 1 FROM "AssetType" t WHERE t."categoryId" = cat.id AND lower(t."name") = lower(v.name));

  SELECT "id" INTO t_phone    FROM "AssetType" WHERE "categoryId" = c_other AND "name" = 'Phone';
  SELECT "id" INTO t_keyboard FROM "AssetType" WHERE "categoryId" = c_other AND "name" = 'Keyboard';

  -- 5. Peripheral's Mouse type becomes Mouse/Wired, assets and all
  IF c_periph IS NOT NULL AND c_mouse IS NOT NULL THEN
    UPDATE "AssetType" SET "categoryId" = c_mouse, "name" = 'Wired'
     WHERE "categoryId" = c_periph AND "name" = 'Mouse'
       AND NOT EXISTS (SELECT 1 FROM "AssetType" WHERE "categoryId" = c_mouse AND "name" = 'Wired');
    UPDATE "Asset" SET "categoryId" = c_mouse
     WHERE "typeId" IN (SELECT "id" FROM "AssetType" WHERE "categoryId" = c_mouse);
  END IF;
  IF c_mouse IS NOT NULL THEN
    INSERT INTO "AssetType" ("id","name","categoryId","locked")
    SELECT 'p34type_mouse_wired', 'Wired', c_mouse, false
     WHERE NOT EXISTS (SELECT 1 FROM "AssetType" WHERE "categoryId" = c_mouse AND "name" = 'Wired');
  END IF;

  -- 6. Phone -> Other/Phone; Peripheral (the rest) -> Other/Keyboard
  IF c_phone IS NOT NULL THEN
    UPDATE "Asset" SET "categoryId" = c_other, "typeId" = t_phone WHERE "categoryId" = c_phone;
    UPDATE "PolicySlot" SET "assetTypeId" = t_phone
     WHERE "assetTypeId" IN (SELECT "id" FROM "AssetType" WHERE "categoryId" = c_phone);
    UPDATE "EmployeeSlotException" SET "assetTypeId" = t_phone
     WHERE "assetTypeId" IN (SELECT "id" FROM "AssetType" WHERE "categoryId" = c_phone);
  END IF;
  IF c_periph IS NOT NULL THEN
    UPDATE "Asset" SET "categoryId" = c_other, "typeId" = t_keyboard WHERE "categoryId" = c_periph;
    UPDATE "PolicySlot" SET "assetTypeId" = t_keyboard
     WHERE "assetTypeId" IN (SELECT "id" FROM "AssetType" WHERE "categoryId" = c_periph);
    UPDATE "EmployeeSlotException" SET "assetTypeId" = t_keyboard
     WHERE "assetTypeId" IN (SELECT "id" FROM "AssetType" WHERE "categoryId" = c_periph);
  END IF;

  -- 7. Merge duplicate slots a policy now holds on one type (iPhone + Android -> one Phone slot):
  --    keep the oldest id, OR the flags, move waivers to it, drop the rest.
  WITH dup AS (
    SELECT "policyId", "assetTypeId", min("id") AS keep, bool_or("required") AS req, bool_or("loaner") AS loan
      FROM "PolicySlot" WHERE "assetTypeId" IN (t_phone, t_keyboard)
     GROUP BY "policyId", "assetTypeId" HAVING count(*) > 1
  )
  UPDATE "PolicySlot" s SET "required" = d.req, "loaner" = d.loan FROM dup d WHERE s."id" = d.keep;
  UPDATE "EmployeeSlotException" e SET "slotId" = k.keep
    FROM (SELECT s."id" AS sid, min(s2."id") AS keep
            FROM "PolicySlot" s JOIN "PolicySlot" s2 ON s2."policyId" = s."policyId" AND s2."assetTypeId" = s."assetTypeId"
           WHERE s."assetTypeId" IN (t_phone, t_keyboard) GROUP BY s."id") k
   WHERE e."slotId" = k.sid AND k.sid <> k.keep;
  DELETE FROM "PolicySlot" s
   USING (SELECT "policyId", "assetTypeId", min("id") AS keep FROM "PolicySlot"
           WHERE "assetTypeId" IN (t_phone, t_keyboard) GROUP BY "policyId", "assetTypeId") d
   WHERE s."policyId" = d."policyId" AND s."assetTypeId" = d."assetTypeId" AND s."id" <> d.keep;
  --    Same-employee duplicate exceptions on one type and slot: keep the oldest.
  DELETE FROM "EmployeeSlotException" e
   USING "EmployeeSlotException" e2
   WHERE e."assetTypeId" IN (t_phone, t_keyboard)
     AND e."employeeId" = e2."employeeId" AND e."kind" = e2."kind" AND e."assetTypeId" = e2."assetTypeId"
     AND e."slotId" IS NOT DISTINCT FROM e2."slotId"
     AND (e."createdAt", e."id") > (e2."createdAt", e2."id");

  -- 8. Drop the emptied categories (never one that still has an asset)
  DELETE FROM "AssetType" WHERE "categoryId" IN (c_phone, c_periph)
     AND NOT EXISTS (SELECT 1 FROM "Asset" a WHERE a."typeId" = "AssetType"."id");
  DELETE FROM "AssetCategory" c WHERE c."id" IN (c_phone, c_periph)
     AND NOT EXISTS (SELECT 1 FROM "Asset" a WHERE a."categoryId" = c."id")
     AND NOT EXISTS (SELECT 1 FROM "AssetType" t WHERE t."categoryId" = c."id");
END $$;
