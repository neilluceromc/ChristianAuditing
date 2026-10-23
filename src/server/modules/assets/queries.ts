import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { canSeeClass } from "@/lib/asset-class";
import {
  ATTACHMENT_DOC_PREFIX, attachmentKindOf, normId, threadNotes, type AssetAttachmentView, type AssetNoteThread,
} from "@/lib/asset-notes";
import { uploadStamp } from "@/lib/upload-meta";

/*
 * Phase 47 (Task 6, spec §4.2a–§4.4): the shared notes and attachments reads, for the Finance asset page and the
 * Inventory record (server components). Deliberately NOT a "use server" module, so neither read is a server-action
 * endpoint; the writes are in ./notes.ts and ./attachments.ts. Read on canSeeClass: anyone who can see the asset's
 * class reads, including the roles that cannot post; anyone else (or a missing asset) reads [].
 */

/** The asset id the page passed, normalised once; null reads nothing. */
async function visibleAssetId(assetId: unknown): Promise<string | null> {
  const user = await requireUser();
  const id = normId(assetId);
  if (!id) return null;
  const asset = await prisma.asset.findUnique({ where: { id }, select: { cls: true } });
  return asset && canSeeClass(user.role, asset.cls) ? id : null;
}

/** The asset's threads (newest first) with their replies (oldest first). */
export async function assetNotes(assetId: string): Promise<AssetNoteThread[]> {
  const id = await visibleAssetId(assetId);
  if (!id) return [];
  const rows = await prisma.assetNote.findMany({
    where: { assetId: id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true, parentId: true, authorId: true, authorLabel: true, body: true, createdAt: true,
      resolvedAt: true, resolvedById: true, author: { select: { role: true } },
    },
  });
  const resolverIds = [...new Set(rows.flatMap((r) => (r.resolvedById ? [r.resolvedById] : [])))];
  const resolvers = resolverIds.length
    ? await prisma.user.findMany({ where: { id: { in: resolverIds } }, select: { id: true, name: true } })
    : [];
  return threadNotes(
    rows.map(({ author, ...r }) => ({ ...r, authorRole: author?.role ?? null })),
    Object.fromEntries(resolvers.map((u) => [u.id, u.name])),
  );
}

/** The asset's attachments, newest first. */
export async function assetAttachments(assetId: string): Promise<AssetAttachmentView[]> {
  const id = await visibleAssetId(assetId);
  if (!id) return [];
  const rows = await prisma.assetDocument.findMany({
    where: { assetId: id, kind: { startsWith: ATTACHMENT_DOC_PREFIX } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, kind: true, fileName: true, size: true, createdAt: true, uploadedBy: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    // an attachment:<kind> this build does not know reads as Other rather than vanishing
    kind: attachmentKindOf(r.kind) ?? "other",
    fileName: r.fileName,
    size: r.size,
    createdAt: r.createdAt,
    ...uploadStamp(r.createdAt, r.uploadedBy),
  }));
}
