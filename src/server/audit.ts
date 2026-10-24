import type { Prisma } from "@prisma/client";
import type { AuditDiff } from "@/lib/audit-diff";

/**
 * The audit write happens in the SAME transaction as the domain write —
 * callers pass their TransactionClient. AuditEntry is append-only by DB
 * trigger; nothing here ever updates or deletes. Returns the new entry's id.
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
    /** Phase 47: where the write came from. Users & access: "cli" is the admin recovery command (`npm run admin:recover`). */
    source?: "web" | "import" | "cris" | "system" | "cli";
    /** Phase 47: the note, comment or reason that came with the action; null when the action carries none. */
    reason?: string | null;
  },
): Promise<string> {
  const row = await tx.auditEntry.create({
    data: {
      ...entry,
      diff: entry.diff && Object.keys(entry.diff).length
        ? (entry.diff as Prisma.InputJsonObject)
        : undefined,
    },
  });
  // Worklist H4: the entry's id, for an Undo that names the decision it takes back (a test double may return nothing).
  return row?.id;
}
