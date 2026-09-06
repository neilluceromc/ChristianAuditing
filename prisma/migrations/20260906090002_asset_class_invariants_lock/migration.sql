-- Phase 13, Task 1 review (D-3): the category read inside asset_class_invariants
-- was an unlocked SELECT. Under READ COMMITTED an asset INSERT and a concurrent
-- AssetCategory.cls UPDATE could each pass their trigger against a snapshot
-- that did not see the other, and both commit -- leaving an asset whose class
-- disagrees with its category, which no later trigger would ever revisit. FOR
-- SHARE takes a row lock that a plain UPDATE of the category conflicts with,
-- so the flip waits behind the insert and then re-checks and refuses.
--
-- Migration 001 is applied and therefore frozen, so this is CREATE OR REPLACE
-- -- the clause was there for exactly this. Two smaller corrections ride
-- along: a categoryId with no row now falls through to the FK's own error
-- instead of a misleading "its category is <NULL>"; and the status lists are
-- compared as text DEFENSIVELY, not out of necessity -- a plpgsql body is not
-- parsed until first execution, so an enum comparison would have resolved
-- fine too. The trade is that a typo'd literal here fails at write time, not
-- at first execution. The cast stays because asset-class.test.ts pins these
-- two lists by matching on it.
CREATE OR REPLACE FUNCTION asset_class_invariants() RETURNS trigger AS $$
DECLARE cat_cls "AssetClass";
BEGIN
  SELECT "cls" INTO cat_cls FROM "AssetCategory" WHERE "id" = NEW."categoryId" FOR SHARE;
  IF NOT FOUND THEN
    RETURN NEW; -- let Asset_categoryId_fkey raise the accurate error
  END IF;
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
