-- Phase 13: the Purchasing-class status vocabulary. In its OWN migration on
-- purpose: Postgres refuses to USE a newly added enum value inside the
-- transaction that added it, and Prisma runs each migration in one
-- transaction. The trigger that names these values lives in the next one.
ALTER TYPE "AssetStatus" ADD VALUE 'OPERATIONAL';
ALTER TYPE "AssetStatus" ADD VALUE 'STORED';
ALTER TYPE "AssetStatus" ADD VALUE 'REPAIRING';
ALTER TYPE "AssetStatus" ADD VALUE 'RETIRED';
ALTER TYPE "AssetStatus" ADD VALUE 'SOLD';
ALTER TYPE "AssetStatus" ADD VALUE 'LOST';
