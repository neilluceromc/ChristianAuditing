-- Phase 36 (spec §3.2): Laptop types become real kinds. Data only; each step is a no-op when its source is missing.
DO $$
DECLARE
  laptop TEXT;
  mac TEXT;
BEGIN
  SELECT id INTO laptop FROM "AssetCategory" WHERE name = 'Laptop' AND cls = 'IT';
  IF laptop IS NULL THEN
    RETURN;
  END IF;

  -- 1. "Dell Latitude" → "Standard" (assets and kit slots keep the same row)
  UPDATE "AssetType" SET name = 'Standard'
   WHERE "categoryId" = laptop AND name = 'Dell Latitude'
     AND NOT EXISTS (SELECT 1 FROM "AssetType" WHERE "categoryId" = laptop AND lower(name) = 'standard');

  -- 2. "ThinkPad" → "High-performance"
  UPDATE "AssetType" SET name = 'High-performance'
   WHERE "categoryId" = laptop AND name = 'ThinkPad'
     AND NOT EXISTS (SELECT 1 FROM "AssetType" WHERE "categoryId" = laptop AND lower(name) = 'high-performance');

  -- 3. "MacBook", unless present in any case
  IF NOT EXISTS (SELECT 1 FROM "AssetType" WHERE "categoryId" = laptop AND lower(name) = 'macbook') THEN
    INSERT INTO "AssetType" (id, name, "categoryId") VALUES (gen_random_uuid()::text, 'MacBook', laptop);
  END IF;
  SELECT id INTO mac FROM "AssetType" WHERE "categoryId" = laptop AND lower(name) = 'macbook';

  -- 4. BR-LT-0201 (MacBook Air M3) → MacBook, only when it is a Laptop
  UPDATE "Asset" SET "typeId" = mac WHERE tag = 'BR-LT-0201' AND "categoryId" = laptop;
END $$;
