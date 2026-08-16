import type { Prisma } from "@prisma/client";
import type { AuditDiff } from "@/lib/audit-diff";

/**
 * The audit write happens in the SAME transaction as the domain write —
 * callers pass their TransactionClient. AuditEntry is append-only by DB
 * trigger; nothing here ever updates or deletes.
 */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  entry: {
    actorId: string | null;
    actorLabel: string;
    entityType: string;
    entityId: string;
    action: string;
    diff?: AuditDiff;
  },
): Promise<void> {
  await tx.auditEntry.create({
    data: {
      ...entry,
      diff: entry.diff && Object.keys(entry.diff).length
        ? (entry.diff as Prisma.InputJsonObject)
        : undefined,
    },
  });
}
