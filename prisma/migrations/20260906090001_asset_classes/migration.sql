-- Phase 13: asset classes. See docs/superpowers/specs/2026-09-06-asset-classes-design.md §2-3.

CREATE TYPE "AssetClass" AS ENUM ('IT', 'PURCHASING');

ALTER TABLE "AssetCategory" ADD COLUMN "cls" "AssetClass" NOT NULL DEFAULT 'IT';
ALTER TABLE "Asset"         ADD COLUMN "cls" "AssetClass" NOT NULL DEFAULT 'IT';

-- Every existing category is IT, so this is a no-op today; it is here so the
-- statement that establishes the invariant is the same one that would
-- backfill it on any database where it was not already true.
UPDATE "Asset" a SET "cls" = c."cls" FROM "AssetCategory" c WHERE c."id" = a."categoryId";

CREATE INDEX "Asset_cls_idx" ON "Asset"("cls");

-- An asset's status must belong to its class, and its class must equal its
-- category's. Compared as text on purpose: the values were added by the
-- previous migration, and text comparison cannot trip over enum-literal
-- parsing whatever order a future maintainer runs these in.
CREATE OR REPLACE FUNCTION asset_class_invariants() RETURNS trigger AS $$
DECLARE cat_cls "AssetClass";
BEGIN
  SELECT "cls" INTO cat_cls FROM "AssetCategory" WHERE "id" = NEW."categoryId";
  IF cat_cls IS DISTINCT FROM NEW."cls" THEN
    RAISE EXCEPTION 'asset % carries class % but its category is %', NEW."tag", NEW."cls", cat_cls;
  END IF;
  IF NEW."cls" = 'IT' AND NEW."status"::text NOT IN
       ('DEPLOYED','SPARE','DEFECTIVE','DONATED','TEMPORARY','BUYOUT','DISPOSE','MISSING') THEN
    RAISE EXCEPTION 'IT asset % cannot hold status %', NEW."tag", NEW."status";
  ELSIF NEW."cls" = 'PURCHASING' AND NEW."status"::text NOT IN
       ('OPERATIONAL','STORED','REPAIRING','RETIRED','SOLD','LOST') THEN
    RAISE EXCEPTION 'Purchasing asset % cannot hold status %', NEW."tag", NEW."status";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER asset_class_invariants
  BEFORE INSERT OR UPDATE OF "status", "cls", "categoryId" ON "Asset"
  FOR EACH ROW EXECUTE FUNCTION asset_class_invariants();

-- The other side of "no drift path": a category's class is frozen once any
-- asset references it. Without this, a raw UPDATE could flip a category and
-- leave every asset under it holding a class its category no longer has.
CREATE OR REPLACE FUNCTION category_class_frozen() RETURNS trigger AS $$
BEGIN
  IF NEW."cls" IS DISTINCT FROM OLD."cls"
     AND EXISTS (SELECT 1 FROM "Asset" WHERE "categoryId" = OLD."id") THEN
    RAISE EXCEPTION 'category % has assets; its class cannot change', OLD."name";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER category_class_frozen
  BEFORE UPDATE OF "cls" ON "AssetCategory"
  FOR EACH ROW EXECUTE FUNCTION category_class_frozen();
