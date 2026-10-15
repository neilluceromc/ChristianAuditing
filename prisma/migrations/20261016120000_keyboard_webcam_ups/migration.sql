-- Keyboard, Webcam and UPS become IT categories of their own (data only; every step guarded and re-runnable).
-- Other's Keyboard and Webcam types move out: their assets, policy slots and slot exceptions follow,
-- then the emptied Other types are removed. No audit rows (migrations never write them).
DO $$
DECLARE
  c_other TEXT;
  c_kb    TEXT;
  c_cam   TEXT;
  c_ups   TEXT;
  t_old   TEXT;
  t_new   TEXT;
BEGIN
  -- 1. The three categories, unless present (names are unique case-insensitively since migration 26).
  INSERT INTO "AssetCategory" ("id","name","locked","cls","tagPrefix")
  SELECT v.id, v.name, false, 'IT', v.prefix
    FROM (VALUES ('kwu_cat_keyboard','Keyboard','KB'), ('kwu_cat_webcam','Webcam','WC'), ('kwu_cat_ups','UPS','UP')) AS v(id,name,prefix)
   WHERE NOT EXISTS (SELECT 1 FROM "AssetCategory" c WHERE lower(c."name") = lower(v.name));

  SELECT id INTO c_kb  FROM "AssetCategory" WHERE lower("name") = 'keyboard' AND cls = 'IT';
  SELECT id INTO c_cam FROM "AssetCategory" WHERE lower("name") = 'webcam'   AND cls = 'IT';
  SELECT id INTO c_ups FROM "AssetCategory" WHERE lower("name") = 'ups'      AND cls = 'IT';
  IF c_kb IS NULL OR c_cam IS NULL OR c_ups IS NULL THEN
    RETURN; -- a same-named category of the other class exists: leave everything alone
  END IF;

  -- 2. Their types, unless present.
  INSERT INTO "AssetType" ("id","name","categoryId","locked")
  SELECT 'kwu_type_' || md5(v.cat || '/' || v.name), v.name, v.cat, false
    FROM (VALUES (c_kb,'Wired'), (c_kb,'Wireless'), (c_cam,'USB webcam'), (c_cam,'Conference camera'),
                 (c_ups,'Desktop UPS'), (c_ups,'Rack UPS')) AS v(cat,name)
   WHERE NOT EXISTS (SELECT 1 FROM "AssetType" t WHERE t."categoryId" = v.cat AND lower(t."name") = lower(v.name));

  SELECT id INTO c_other FROM "AssetCategory" WHERE lower("name") = 'other' AND cls = 'IT';
  IF c_other IS NULL THEN
    RETURN;
  END IF;

  -- 3. Other / Keyboard → Keyboard (Wired; the Logitech MX Keys BR-KB-0402 is Wireless).
  SELECT id INTO t_old FROM "AssetType" WHERE "categoryId" = c_other AND lower("name") = 'keyboard';
  IF t_old IS NOT NULL THEN
    SELECT id INTO t_new FROM "AssetType" WHERE "categoryId" = c_kb AND "name" = 'Wired';
    UPDATE "Asset" SET "categoryId" = c_kb,
           "typeId" = CASE WHEN tag = 'BR-KB-0402'
                           THEN (SELECT id FROM "AssetType" WHERE "categoryId" = c_kb AND "name" = 'Wireless')
                           ELSE t_new END
     WHERE "typeId" = t_old;
    UPDATE "PolicySlot" SET "assetTypeId" = t_new WHERE "assetTypeId" = t_old;
    UPDATE "EmployeeSlotException" SET "assetTypeId" = t_new WHERE "assetTypeId" = t_old;
    DELETE FROM "AssetType" WHERE id = t_old;
  END IF;

  -- 4. Other / Webcam → Webcam (USB webcam).
  SELECT id INTO t_old FROM "AssetType" WHERE "categoryId" = c_other AND lower("name") = 'webcam';
  IF t_old IS NOT NULL THEN
    SELECT id INTO t_new FROM "AssetType" WHERE "categoryId" = c_cam AND "name" = 'USB webcam';
    UPDATE "Asset" SET "categoryId" = c_cam, "typeId" = t_new WHERE "typeId" = t_old;
    UPDATE "PolicySlot" SET "assetTypeId" = t_new WHERE "assetTypeId" = t_old;
    UPDATE "EmployeeSlotException" SET "assetTypeId" = t_new WHERE "assetTypeId" = t_old;
    DELETE FROM "AssetType" WHERE id = t_old;
  END IF;
END $$;
