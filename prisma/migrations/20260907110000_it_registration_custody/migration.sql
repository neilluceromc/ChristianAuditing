-- Phase 16 (spec §8): additive only, no backfill.
ALTER TABLE "Asset"
  ADD COLUMN "loanDueAt" TIMESTAMP(3),
  ADD COLUMN "brand" TEXT,
  ADD COLUMN "invoiceRef" TEXT;
CREATE INDEX "Asset_loanDueAt_idx" ON "Asset"("loanDueAt");

ALTER TABLE "PolicySlot" ADD COLUMN "loaner" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "SlotExceptionKind" AS ENUM ('ADD', 'WAIVE');

CREATE TABLE "EmployeeSlotException" (
  "id"          TEXT NOT NULL,
  "employeeId"  TEXT NOT NULL,
  "kind"        "SlotExceptionKind" NOT NULL,
  "slotId"      TEXT,
  "name"        TEXT,
  "assetTypeId" TEXT,
  "required"    BOOLEAN NOT NULL DEFAULT true,
  "loaner"      BOOLEAN NOT NULL DEFAULT false,
  "reason"      TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployeeSlotException_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeSlotException_employeeId_idx" ON "EmployeeSlotException"("employeeId");
ALTER TABLE "EmployeeSlotException"
  ADD CONSTRAINT "EmployeeSlotException_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EmployeeSlotException_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "PolicySlot"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EmployeeSlotException_assetTypeId_fkey" FOREIGN KEY ("assetTypeId") REFERENCES "AssetType"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EmployeeSlotException_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Acknowledgement" (
  "id"           TEXT NOT NULL,
  "employeeId"   TEXT NOT NULL,
  "signedAt"     TIMESTAMP(3) NOT NULL,
  "fileName"     TEXT NOT NULL,
  "path"         TEXT NOT NULL,
  "checksum"     TEXT NOT NULL,
  "items"        JSONB NOT NULL,
  "recordedById" TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Acknowledgement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Acknowledgement_employeeId_signedAt_idx" ON "Acknowledgement"("employeeId", "signedAt");
ALTER TABLE "Acknowledgement"
  ADD CONSTRAINT "Acknowledgement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Acknowledgement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
