-- Phase 37 (spec §6): clients as Department rows, IT setup on Employee, EmployeeNote, derived slot names.
CREATE TYPE "GroupKind" AS ENUM ('INTERNAL', 'CLIENT');
CREATE TYPE "SetupState" AS ENUM ('DONE', 'NOT_YET', 'NOT_NEEDED');

ALTER TABLE "Department" ADD COLUMN "kind" "GroupKind" NOT NULL DEFAULT 'INTERNAL',
                         ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "Employee" ADD COLUMN "entraStatus" "SetupState",
                       ADD COLUMN "autopilotStatus" "SetupState",
                       ADD COLUMN "argusStatus" "SetupState",
                       ADD COLUMN "vpn" TEXT;

CREATE TABLE "EmployeeNote" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    CONSTRAINT "EmployeeNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeNote_employeeId_createdAt_idx" ON "EmployeeNote"("employeeId", "createdAt");
ALTER TABLE "EmployeeNote" ADD CONSTRAINT "EmployeeNote_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeNote" ADD CONSTRAINT "EmployeeNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data only, re-runnable: slot names come from the category (or the type, inside Other). No audit rows.
UPDATE "PolicySlot" s
   SET "name" = CASE WHEN lower(trim(c."name")) = 'other' THEN t."name" ELSE c."name" END
  FROM "AssetType" t JOIN "AssetCategory" c ON c."id" = t."categoryId"
 WHERE s."assetTypeId" = t."id";

UPDATE "EmployeeSlotException" e
   SET "name" = CASE WHEN lower(trim(c."name")) = 'other' THEN t."name" ELSE c."name" END
  FROM "AssetType" t JOIN "AssetCategory" c ON c."id" = t."categoryId"
 WHERE e."assetTypeId" = t."id" AND e."kind" = 'ADD';
