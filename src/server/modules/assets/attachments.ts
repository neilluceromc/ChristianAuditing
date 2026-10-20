"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { actionUser, requireUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { conflict, forbidden, ok, rateLimited, validationError, type ActionResult } from "@/server/action-result";
import { canSeeClass } from "@/lib/asset-class";
import {
  ATTACHMENT_DOC_PREFIX, attachmentDocKind, attachmentKindOf, canPostAnywhere, canPostOnAsset, isAttachmentKind,
  type AssetAttachmentView,
} from "@/lib/asset-notes";
import { storeUpload, validateUpload } from "@/server/uploads";

/*
 * Phase 47 (Task 6, spec §4.2a, §4.4): asset attachments — AssetDocument rows with kind `attachment:<kind>`, shared
 * with everyone who can see the asset. The upload mirrors uploadDocument (inventory/document-actions.ts): the same
 * validateUpload / storeUpload (4 MB cap, PDF/PNG/JPG, the storage driver), rate limit and audit — but the guard is
 * canSeeClass AND canPostOnAsset. Nothing deletes an attachment; replacing one uploads a new one.
 */

function revalidateAsset(assetId: string) {
  revalidatePath(`/finance/assets/${assetId}`);
  revalidatePath(`/inventory/${assetId}`);
  revalidatePath(`/inventory/${assetId}/attachments`);
  // attachments also list under "Attachments" in the record's Documents tab (spec §4.2a)
  revalidatePath(`/inventory/${assetId}/documents`);
}

export async function uploadAttachment(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await actionUser();
  if (!user || !canPostAnywhere(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const assetId = String(formData.get("assetId") ?? "");
  const kind = formData.get("kind");
  if (!assetId) return conflict("Missing asset.");
  if (!isAttachmentKind(kind)) return validationError({ kind: "Pick an attachment kind" });
  const checked = validateUpload(formData.get("file"));
  if (!checked.ok) return validationError({ file: checked.error });

  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { id: true, cls: true } });
  if (!asset) return conflict("That asset no longer exists.");
  if (!canSeeClass(user.role, asset.cls) || !canPostOnAsset(user.role, asset.cls)) return forbidden();

  const stored = await storeUpload(`assets/${assetId}`, checked.file);

  const doc = await prisma.$transaction(async (tx) => {
    const created = await tx.assetDocument.create({
      data: {
        assetId, kind: attachmentDocKind(kind),
        fileName: stored.fileName,
        path: stored.relPath, checksum: stored.checksum, size: stored.size,
        uploadedById: user.id,
      },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: assetId,
      action: "attachment.uploaded",
      diff: { attachment: { from: null, to: created.fileName } },
      source: "web",
    });
    return created;
  });
  revalidateAsset(assetId);
  return ok({ id: doc.id });
}

/** The asset's attachments, newest first, for anyone who can see the asset's class; [] otherwise. */
export async function assetAttachments(assetId: string): Promise<AssetAttachmentView[]> {
  const user = await requireUser();
  const asset = await prisma.asset.findUnique({ where: { id: String(assetId ?? "") }, select: { cls: true } });
  if (!asset || !canSeeClass(user.role, asset.cls)) return [];
  const rows = await prisma.assetDocument.findMany({
    where: { assetId, kind: { startsWith: ATTACHMENT_DOC_PREFIX } },
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
    uploadedBy: r.uploadedBy?.name ?? null,
  }));
}
