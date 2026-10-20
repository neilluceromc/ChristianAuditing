import { prisma } from "@/server/db/client";
import { ATTACHMENT_DOC_PREFIX } from "@/lib/asset-notes";
import type { RecordTabCounts } from "@/lib/inventory-record";

/**
 * Phase 47 (Task 8): the record tab bar's badges — note threads (and the unresolved ones, which turn the badge amber)
 * and attachments. Three count queries; the layout has already checked that the role can see the asset. Counts only,
 * never a figure: nothing here carries money.
 */
export async function recordTabCounts(assetId: string): Promise<RecordTabCounts> {
  const [notes, openNotes, attachments] = await Promise.all([
    prisma.assetNote.count({ where: { assetId, parentId: null } }),
    prisma.assetNote.count({ where: { assetId, parentId: null, resolvedAt: null } }),
    prisma.assetDocument.count({ where: { assetId, kind: { startsWith: ATTACHMENT_DOC_PREFIX } } }),
  ]);
  return { notes, openNotes, attachments };
}
