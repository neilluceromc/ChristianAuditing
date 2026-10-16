import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";

/** One held item and its current holder, as the held-since rule needs them. */
export interface HeldPair { assetId: string; employeeId: string; employeeNo: string }

/**
 * Phase 37/38: "held since" — the date of the newest assignment audit naming this holder, per asset.
 *
 * How an assignment is audited: lifecycle writes `assignee: { to: <employee number> }` (the id when the number is
 * unknown); a plain edit writes `assigneeId: { to: <id> }`. Any of those naming the asset's CURRENT holder marks
 * "held since" (a string match on the JSON value, so a number or null never matches).
 *
 * One query for any number of assets: the pairs are unnested and joined to the audit rows, then reduced to the
 * newest match per asset. An asset with no matching audit has no entry in the map (the date is unknown).
 */
export async function heldSinceByAsset(pairs: HeldPair[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (pairs.length === 0) return out;
  const rows = await prisma.$queryRaw<Array<{ assetId: string; since: Date }>>(Prisma.sql`
    SELECT h."assetId" AS "assetId", MAX(a."createdAt") AS "since"
    FROM unnest(${pairs.map((p) => p.assetId)}::text[], ${pairs.map((p) => p.employeeId)}::text[], ${pairs.map((p) => p.employeeNo)}::text[])
      AS h("assetId", "employeeId", "employeeNo")
    JOIN "AuditEntry" a ON a."entityType" = 'asset' AND a."entityId" = h."assetId"
    WHERE (jsonb_typeof(a."diff" #> '{assignee,to}') = 'string' AND a."diff" #>> '{assignee,to}' IN (h."employeeId", h."employeeNo"))
       OR (jsonb_typeof(a."diff" #> '{assigneeId,to}') = 'string' AND a."diff" #>> '{assigneeId,to}' = h."employeeId")
    GROUP BY h."assetId"
  `);
  for (const r of rows) out.set(r.assetId, r.since);
  return out;
}
