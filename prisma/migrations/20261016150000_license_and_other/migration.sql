-- Windows License becomes an IT category (types OEM / Retail / Volume); Docking Station and Type C Hub
-- fold into Other as types of the same names. Data only; every step guarded and re-runnable.
-- Type rows MOVE (same ids), so assets, policy slots and slot exceptions keep pointing at them.
DO $$
DECLARE
  c_other TEXT;
  c_lic   TEXT;
  c_old   TEXT;
  t       RECORD;
  src     TEXT;
  n       INT;
  newname TEXT;
BEGIN
  -- 1. Windows License and its types.
  INSERT INTO "AssetCategory" ("id","name","locked","cls","tagPrefix")
  SELECT 'lom_cat_windows_license', 'Windows License', false, 'IT', 'WL'
   WHERE NOT EXISTS (SELECT 1 FROM "AssetCategory" WHERE lower("name") = 'windows license');
  SELECT id INTO c_lic FROM "AssetCategory" WHERE lower("name") = 'windows license' AND cls = 'IT';
  IF c_lic IS NOT NULL THEN
    INSERT INTO "AssetType" ("id","name","categoryId","locked")
    SELECT 'lom_type_' || md5(c_lic || '/' || v.name), v.name, c_lic, false
      FROM (VALUES ('OEM'), ('Retail'), ('Volume')) AS v(name)
     WHERE NOT EXISTS (SELECT 1 FROM "AssetType" x WHERE x."categoryId" = c_lic AND lower(x."name") = lower(v.name));
  END IF;

  SELECT id INTO c_other FROM "AssetCategory" WHERE lower("name") = 'other' AND cls = 'IT';
  IF c_other IS NULL THEN
    RETURN;
  END IF;

  -- 2. Docking Station and Type C Hub → Other.
  FOREACH src IN ARRAY ARRAY['Docking Station', 'Type C Hub'] LOOP
    c_old := NULL;
    SELECT id INTO c_old FROM "AssetCategory" WHERE lower("name") = lower(src) AND cls = 'IT';
    CONTINUE WHEN c_old IS NULL;
    SELECT count(*) INTO n FROM "AssetType" WHERE "categoryId" = c_old;
    FOR t IN SELECT id, "name" FROM "AssetType" WHERE "categoryId" = c_old ORDER BY "name" LOOP
      -- The only type takes the category's name; any extra keeps its own name after the category's.
      newname := CASE WHEN n = 1 THEN src ELSE src || ' · ' || t."name" END;
      IF EXISTS (SELECT 1 FROM "AssetType" WHERE "categoryId" = c_other AND lower("name") = lower(newname)) THEN
        -- Other already has it: point everything at Other's row and drop the old one.
        UPDATE "Asset" SET "typeId" = (SELECT id FROM "AssetType" WHERE "categoryId" = c_other AND lower("name") = lower(newname))
         WHERE "typeId" = t.id;
        UPDATE "PolicySlot" SET "assetTypeId" = (SELECT id FROM "AssetType" WHERE "categoryId" = c_other AND lower("name") = lower(newname))
         WHERE "assetTypeId" = t.id;
        UPDATE "EmployeeSlotException" SET "assetTypeId" = (SELECT id FROM "AssetType" WHERE "categoryId" = c_other AND lower("name") = lower(newname))
         WHERE "assetTypeId" = t.id;
        DELETE FROM "AssetType" WHERE id = t.id;
      ELSE
        UPDATE "AssetType" SET "categoryId" = c_other, "name" = newname WHERE id = t.id;
      END IF;
    END LOOP;
    -- Untyped assets of the old category take Other's type of the category's name, when there is exactly one.
    UPDATE "Asset" SET "typeId" = (SELECT id FROM "AssetType" WHERE "categoryId" = c_other AND lower("name") = lower(src))
     WHERE "categoryId" = c_old AND "typeId" IS NULL;
    UPDATE "Asset" SET "categoryId" = c_other WHERE "categoryId" = c_old;
    DELETE FROM "AssetCategory" WHERE id = c_old
      AND NOT EXISTS (SELECT 1 FROM "Asset" WHERE "categoryId" = c_old)
      AND NOT EXISTS (SELECT 1 FROM "AssetType" WHERE "categoryId" = c_old);
  END LOOP;
END $$;
