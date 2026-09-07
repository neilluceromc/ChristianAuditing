"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import {
  conflict, forbidden, ok, rateLimited, validationError, type ActionResult,
} from "@/server/action-result";
import { canManageClass } from "@/lib/asset-class";
import { isApprover } from "@/lib/approval-access";
import { DOCUMENT_KINDS } from "@/lib/documents";
import { BULK_MAX } from "@/lib/inventory-list";
import { storeUpload, validateUpload } from "@/server/uploads";

/**
 * Files land on the local uploads/ volume (single-machine deploy, no object
 * storage); the row stores a RELATIVE posix path + sha256 checksum. The
 * filename is sanitized to a safe charset — the original name survives only
 * as display text.
 */
export async function uploadDocument(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await actionUser();
  if (!user || !isApprover(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const assetId = String(formData.get("assetId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!assetId) return conflict("Missing asset.");
  if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) return validationError({ kind: "Pick a document kind" });
  const checked = validateUpload(formData.get("file"));
  if (!checked.ok) return validationError({ file: checked.error });

  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) return conflict("That asset no longer exists.");
  if (!canManageClass(user.role, asset.cls)) return forbidden();

  const stored = await storeUpload(`assets/${assetId}`, checked.file);

  const doc = await prisma.$transaction(async (tx) => {
    const created = await tx.assetDocument.create({
      data: {
        assetId, kind,
        fileName: stored.fileName,
        path: stored.relPath, checksum: stored.checksum,
        uploadedById: user.id,
      },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: assetId,
      action: "document.uploaded",
      diff: { document: { from: null, to: created.fileName } },
    });
    return created;
  });
  revalidatePath(`/inventory/${assetId}/documents`);
  return ok({ id: doc.id });
}

/** Spec §2.3: one invoice, stored once, one document row per unit of the batch. */
export async function uploadBatchDocument(formData: FormData): Promise<ActionResult<{ created: number }>> {
  const user = await actionUser();
  if (!user || !isApprover(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const assetIds = [...new Set(formData.getAll("assetIds").map(String).filter(Boolean))];
  const kind = String(formData.get("kind") ?? "");
  if (assetIds.length === 0) return conflict("Missing assets.");
  if (assetIds.length > BULK_MAX) return conflict(`A batch document covers at most ${BULK_MAX} assets.`);
  if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) return validationError({ kind: "Pick a document kind" });
  const checked = validateUpload(formData.get("file"));
  if (!checked.ok) return validationError({ file: checked.error });

  const assets = await prisma.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, cls: true } });
  if (assets.length !== assetIds.length) return conflict("One of those assets no longer exists.");
  if (assets.some((a) => !canManageClass(user.role, a.cls))) return forbidden();

  const stored = await storeUpload("batches", checked.file);
  const created = await prisma.$transaction(async (tx) => {
    for (const a of assets) {
      const doc = await tx.assetDocument.create({
        data: { assetId: a.id, kind, fileName: stored.fileName, path: stored.relPath, checksum: stored.checksum, uploadedById: user.id },
      });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: a.id,
        action: "document.uploaded", diff: { document: { from: null, to: doc.fileName } },
      });
    }
    return assets.length;
  });
  for (const a of assets) revalidatePath(`/inventory/${a.id}/documents`);
  return ok({ created });
}

/** Accountability forms scan back in and get flagged SIGNED. */
export async function markDocumentSigned(input: { docId: string }): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user || !isApprover(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const doc = await prisma.assetDocument.findUnique({
    where: { id: String(input.docId ?? "") },
    include: { asset: { select: { cls: true } } },
  });
  if (!doc) return conflict("That document no longer exists.");
  if (!canManageClass(user.role, doc.asset.cls)) return forbidden();
  if (doc.signed) return ok(null);

  await prisma.$transaction(async (tx) => {
    await tx.assetDocument.update({ where: { id: doc.id }, data: { signed: true } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: doc.assetId,
      action: "document.signed",
      diff: { [doc.fileName]: { from: "unsigned", to: "SIGNED" } },
    });
  });
  revalidatePath(`/inventory/${doc.assetId}/documents`);
  return ok(null);
}
