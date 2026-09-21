ALTER TABLE "Asset" ADD COLUMN "repairEndedAt" TIMESTAMP(3);

-- Backfill (spec §0 decision 3). An asset that is not DEFECTIVE but still carries defectiveSince
-- has a closed repair; its end is the newest audit row that moved status OFF DEFECTIVE. Rows with
-- no such history stay NULL and keep showing "—" in the Down column — never a guess.
UPDATE "Asset" a
   SET "repairEndedAt" = h."endedAt"
  FROM (
    SELECT e."entityId" AS "assetId", max(e."createdAt") AS "endedAt"
      FROM "AuditEntry" e
     WHERE e."entityType" = 'asset'
       AND e."diff"->'status'->>'from' = 'DEFECTIVE'
       AND e."diff"->'status'->>'to' IS DISTINCT FROM 'DEFECTIVE'
     GROUP BY e."entityId"
  ) h
 WHERE h."assetId" = a."id"
   AND a."status" <> 'DEFECTIVE'
   AND a."defectiveSince" IS NOT NULL
   AND h."endedAt" > a."defectiveSince";
