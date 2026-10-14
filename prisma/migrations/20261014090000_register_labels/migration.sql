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
  t_phone TEXT; t_keyboard TEXT; t_wired TEXT; clash TEXT;
  touched TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- 0. Every name lookup below is case-insensitive, matching the lower(name) unique index
  --    (migration 20260922010908). A target name held by a Purchasing category would receive IT
  --    assets and trip asset_class_invariants, and a SOURCE name (Phone, Peripheral, Dock) held by
  --    one would be renamed, emptied or dropped; so stop first with a clear message.
  SELECT "name" INTO clash FROM "AssetCategory"
   WHERE lower("name") IN ('workstation (pc)','mouse','type c hub','laptop bag','other','docking station',
                           'phone','peripheral','dock')
     AND "cls" <> 'IT'
   LIMIT 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 34 migration: category "%" exists as a Purchasing category; rename it before applying', clash;
  END IF;

  -- 1. Dock -> Docking Station
  UPDATE "AssetCategory" SET "name" = 'Docking Station'
   WHERE lower("name") = 'dock' AND NOT EXISTS (SELECT 1 FROM "AssetCategory" WHERE lower("name") = 'docking station');

  -- 2. New categories (deterministic ids so a re-run finds them)
  INSERT INTO "AssetCategory" ("id","name","locked","cls","tagPrefix")
  SELECT v.id, v.name, false, 'IT', v.prefix
    FROM (VALUES ('p34cat_ws','Workstation (PC)','WS'), ('p34cat_mouse','Mouse','MS'),
                 ('p34cat_hub','Type C Hub','HB'), ('p34cat_bag','Laptop Bag','BG'), ('p34cat_other','Other','OT')) AS v(id,name,prefix)
   WHERE NOT EXISTS (SELECT 1 FROM "AssetCategory" c WHERE lower(c."name") = lower(v.name));

  -- 3. tagPrefix for the categories that keep their tags (only where unset)
  UPDATE "AssetCategory" SET "tagPrefix" = v.prefix
    FROM (VALUES ('Laptop','LT'), ('Monitor','MN'), ('Headset','HS'), ('Docking Station','DK')) AS v(name,prefix)
   WHERE lower("AssetCategory"."name") = lower(v.name) AND "AssetCategory"."tagPrefix" IS NULL;

  SELECT "id" INTO c_other  FROM "AssetCategory" WHERE lower("name") = 'other';
  SELECT "id" INTO c_mouse  FROM "AssetCategory" WHERE lower("name") = 'mouse';
  SELECT "id" INTO c_phone  FROM "AssetCategory" WHERE lower("name") = 'phone';
  SELECT "id" INTO c_periph FROM "AssetCategory" WHERE lower("name") = 'peripheral';

  -- 4. Types for the new categories (never duplicating a name inside a category)
  INSERT INTO "AssetType" ("id","name","categoryId","locked")
  SELECT 'p34type_' || md5(cat.name || '/' || v.name), v.name, cat.id, false
    FROM (VALUES ('Workstation (PC)','Desktop tower'), ('Workstation (PC)','Mini PC'), ('Workstation (PC)','All-in-one'),
                 ('Mouse','Wireless'), ('Type C Hub','USB-C Hub'), ('Laptop Bag','Backpack'), ('Laptop Bag','Sleeve'),
                 ('Other','Phone'), ('Other','Keyboard'), ('Other','Webcam'), ('Other','Speaker'), ('Other','Printer')) AS v(cat,name)
    JOIN "AssetCategory" cat ON lower(cat."name") = lower(v.cat)
   WHERE NOT EXISTS (SELECT 1 FROM "AssetType" t WHERE t."categoryId" = cat.id AND lower(t."name") = lower(v.name));

  SELECT "id" INTO t_phone    FROM "AssetType" WHERE "categoryId" = c_other AND lower("name") = 'phone';
  SELECT "id" INTO t_keyboard FROM "AssetType" WHERE "categoryId" = c_other AND lower("name") = 'keyboard';
  IF (c_phone IS NOT NULL OR c_periph IS NOT NULL) AND (c_other IS NULL OR t_phone IS NULL OR t_keyboard IS NULL) THEN
    RAISE EXCEPTION 'Phase 34 migration: could not resolve Other / Phone and Other / Keyboard; nothing was moved';
  END IF;

  -- 5. Peripheral's Mouse type becomes Mouse/Wired, assets and all. When Mouse/Wired already
  --    exists, the Peripheral Mouse type's assets, slots and exceptions move onto it instead.
  IF c_periph IS NOT NULL AND c_mouse IS NOT NULL THEN
    UPDATE "AssetType" SET "categoryId" = c_mouse, "name" = 'Wired'
     WHERE "categoryId" = c_periph AND lower("name") = 'mouse'
       AND NOT EXISTS (SELECT 1 FROM "AssetType" WHERE "categoryId" = c_mouse AND lower("name") = 'wired');
    SELECT "id" INTO t_wired FROM "AssetType" WHERE "categoryId" = c_mouse AND lower("name") = 'wired';
    -- Only a Peripheral move makes Wired a merge target; a re-run never merges Mouse's own slots.
    touched := touched || ARRAY[t_wired];
    UPDATE "Asset" SET "categoryId" = c_mouse, "typeId" = t_wired
     WHERE "typeId" IN (SELECT "id" FROM "AssetType" WHERE "categoryId" = c_periph AND lower("name") = 'mouse');
    UPDATE "PolicySlot" SET "assetTypeId" = t_wired
     WHERE "assetTypeId" IN (SELECT "id" FROM "AssetType" WHERE "categoryId" = c_periph AND lower("name") = 'mouse');
    UPDATE "EmployeeSlotException" SET "assetTypeId" = t_wired
     WHERE "assetTypeId" IN (SELECT "id" FROM "AssetType" WHERE "categoryId" = c_periph AND lower("name") = 'mouse');
    UPDATE "Asset" SET "categoryId" = c_mouse
     WHERE "typeId" IN (SELECT "id" FROM "AssetType" WHERE "categoryId" = c_mouse);
  END IF;
  IF c_mouse IS NOT NULL THEN
    INSERT INTO "AssetType" ("id","name","categoryId","locked")
    SELECT 'p34type_mouse_wired', 'Wired', c_mouse, false
     WHERE NOT EXISTS (SELECT 1 FROM "AssetType" WHERE "categoryId" = c_mouse AND lower("name") = 'wired');
  END IF;

  -- 6. Phone -> Other/Phone (every Phone type, spec §2.2); each remaining Peripheral type -> the
  --    Other type of the same name (Keyboard -> Other/Keyboard; a type Other lacks is created there
  --    under its own name), with its assets, policy slots and slot exceptions. Peripheral's Mouse
  --    type was settled in step 5 (moved, or emptied onto Mouse/Wired) and is never copied to Other.
  IF c_phone IS NOT NULL THEN
    UPDATE "Asset" SET "categoryId" = c_other, "typeId" = t_phone WHERE "categoryId" = c_phone;
    UPDATE "PolicySlot" SET "assetTypeId" = t_phone
     WHERE "assetTypeId" IN (SELECT "id" FROM "AssetType" WHERE "categoryId" = c_phone);
    UPDATE "EmployeeSlotException" SET "assetTypeId" = t_phone
     WHERE "assetTypeId" IN (SELECT "id" FROM "AssetType" WHERE "categoryId" = c_phone);
  END IF;
  IF c_periph IS NOT NULL THEN
    INSERT INTO "AssetType" ("id","name","categoryId","locked")
    SELECT 'p34type_other_' || md5(lower(t."name")), t."name", c_other, t."locked"
      FROM "AssetType" t
     WHERE t."categoryId" = c_periph AND lower(t."name") <> 'mouse'
       AND NOT EXISTS (SELECT 1 FROM "AssetType" o WHERE o."categoryId" = c_other AND lower(o."name") = lower(t."name"));
    touched := touched || ARRAY(
      SELECT o."id" FROM "AssetType" t JOIN "AssetType" o ON o."categoryId" = c_other AND lower(o."name") = lower(t."name")
       WHERE t."categoryId" = c_periph AND lower(t."name") <> 'mouse');
    UPDATE "Asset" a SET "categoryId" = c_other, "typeId" = o."id"
      FROM "AssetType" t JOIN "AssetType" o ON o."categoryId" = c_other AND lower(o."name") = lower(t."name")
     WHERE t."categoryId" = c_periph AND lower(t."name") <> 'mouse' AND a."typeId" = t."id";
    -- An untyped Peripheral asset goes to Other untyped (it has no type name to carry).
    UPDATE "Asset" SET "categoryId" = c_other WHERE "categoryId" = c_periph AND "typeId" IS NULL;
    UPDATE "PolicySlot" s SET "assetTypeId" = o."id"
      FROM "AssetType" t JOIN "AssetType" o ON o."categoryId" = c_other AND lower(o."name") = lower(t."name")
     WHERE t."categoryId" = c_periph AND lower(t."name") <> 'mouse' AND s."assetTypeId" = t."id";
    UPDATE "EmployeeSlotException" e SET "assetTypeId" = o."id"
      FROM "AssetType" t JOIN "AssetType" o ON o."categoryId" = c_other AND lower(o."name") = lower(t."name")
     WHERE t."categoryId" = c_periph AND lower(t."name") <> 'mouse' AND e."assetTypeId" = t."id";
  END IF;
  -- Every type a slot or exception may have been merged onto above (Phone and Keyboard as before).
  touched := touched || ARRAY[t_phone, t_keyboard];

  -- 7. Merge duplicate slots a policy now holds on one type (iPhone + Android -> one Phone slot;
  --    Peripheral Mouse onto an existing Mouse/Wired; a Peripheral type onto Other's same-name type):
  --    keep the oldest id, OR the flags, move waivers to it, drop the rest.
  WITH dup AS (
    SELECT "policyId", "assetTypeId", min("id") AS keep, bool_or("required") AS req, bool_or("loaner") AS loan
      FROM "PolicySlot" WHERE "assetTypeId" = ANY(touched)
     GROUP BY "policyId", "assetTypeId" HAVING count(*) > 1
  )
  UPDATE "PolicySlot" s SET "required" = d.req, "loaner" = d.loan FROM dup d WHERE s."id" = d.keep;
  UPDATE "EmployeeSlotException" e SET "slotId" = k.keep
    FROM (SELECT s."id" AS sid, min(s2."id") AS keep
            FROM "PolicySlot" s JOIN "PolicySlot" s2 ON s2."policyId" = s."policyId" AND s2."assetTypeId" = s."assetTypeId"
           WHERE s."assetTypeId" = ANY(touched) GROUP BY s."id") k
   WHERE e."slotId" = k.sid AND k.sid <> k.keep;
  DELETE FROM "PolicySlot" s
   USING (SELECT "policyId", "assetTypeId", min("id") AS keep FROM "PolicySlot"
           WHERE "assetTypeId" = ANY(touched) GROUP BY "policyId", "assetTypeId") d
   WHERE s."policyId" = d."policyId" AND s."assetTypeId" = d."assetTypeId" AND s."id" <> d.keep;
  --    Same-employee duplicate exceptions on one type and slot: keep the oldest.
  DELETE FROM "EmployeeSlotException" e
   USING "EmployeeSlotException" e2
   WHERE e."assetTypeId" = ANY(touched)
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
