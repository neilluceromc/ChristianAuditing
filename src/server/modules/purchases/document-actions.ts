"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { canAttachToRequest } from "@/lib/supplier-access";
import { REQUEST_DOCUMENT_KINDS } from "@/lib/documents";
import { storeUpload, validateUpload } from "@/server/uploads";

/**
 * Mirrors suppliers/document-actions.ts's uploadSupplierDocument, with the PO's id (form field `requestId`, kept for
 * the existing form) in place of vendorId. Spec §2: Purchasing, IT, Finance and admin can all upload or re-upload, on
 * any PO that isn't cancelled. Uploading a kind again adds a new document; nothing is replaced or deleted.
 */
export async function uploadPoDocument(formData: FormData): Promise<ActionResult<{ id: string }>> {
  return addPoDocument(formData, "requestId");
}

/**
 * PO form redesign (spec §5b.1): Replace on a saved PO's document slot. It adds a new document of the kind — the
 * slot shows the newest — and the old one stays on record (append-only). The same roles and states as upload; the
 * form names the PO `orderId`.
 */
export async function replacePoDocument(formData: FormData): Promise<ActionResult<{ id: string }>> {
  return addPoDocument(formData, "orderId");
}

async function addPoDocument(formData: FormData, idField: "requestId" | "orderId"): Promise<ActionResult<{ id: string }>> {
  const user = await actionUser();
  if (!user || !canAttachToRequest(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const requestId = String(formData.get(idField) ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!requestId) return conflict("Missing purchase order.");
  if (!(REQUEST_DOCUMENT_KINDS as readonly string[]).includes(kind)) return validationError({ kind: "Pick a document kind" });
  const checked = validateUpload(formData.get("file"));
  if (!checked.ok) return validationError({ file: checked.error });

  const request = await prisma.purchaseOrder.findUnique({ where: { id: requestId } });
  if (!request) return conflict("That purchase order no longer exists.");
  if (request.state === "CANCELLED") return conflict(`${request.refNo} is cancelled — it takes no new documents.`);

  let stored: Awaited<ReturnType<typeof storeUpload>>;
  try {
    stored = await storeUpload(`requests/${requestId}`, checked.file);
  } catch {
    return conflict("Could not store the file");
  }

  const doc = await prisma.$transaction(async (tx) => {
    const created = await tx.requestDocument.create({
      data: {
        orderId: requestId, kind,
        fileName: stored.fileName,
        path: stored.relPath, checksum: stored.checksum,
        uploadedById: user.id,
      },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "purchase-order", entityId: requestId,
      action: "document.uploaded",
      diff: { document: { from: null, to: created.fileName } },
      source: "web",
    });
    return created;
  });
  revalidatePath(`/purchases/${requestId}`);
  return ok({ id: doc.id });
}

const removeSchema = z.object({ documentId: z.string().min(1) });

/**
 * PO form redesign (spec §5b.1): Remove on a saved PO's document. Documents are append-only, so nothing is deleted:
 * the row gets `supersededAt` / `supersededById` and leaves its slot (getPurchase lists only the rest, plus a
 * count). The same roles and states as upload: not on a cancelled PO. Audited as `document.superseded`.
 */
export async function removePoDocument(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { documentId } = parsed.data;

  const user = await actionUser();
  if (!user || !canAttachToRequest(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const doc = await prisma.requestDocument.findUnique({
    where: { id: documentId },
    select: { id: true, orderId: true, fileName: true, supersededAt: true, order: { select: { refNo: true, state: true } } },
  });
  if (!doc) return conflict("That document no longer exists.");
  if (doc.order.state === "CANCELLED") return conflict(`${doc.order.refNo} is cancelled — its documents can't change.`);
  if (doc.supersededAt) return conflict(`${doc.fileName} was already removed.`);

  const failure = await prisma.$transaction(async (tx) => {
    // Guarded on supersededAt: two Removes at once supersede it once, and write one audit entry.
    const hit = await tx.requestDocument.updateMany({
      where: { id: documentId, supersededAt: null },
      data: { supersededAt: new Date(), supersededById: user.id },
    });
    if (hit.count === 0) return conflict(`${doc.fileName} was already removed.`);
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "purchase-order", entityId: doc.orderId,
      action: "document.superseded",
      diff: { document: { from: doc.fileName, to: null } },
      source: "web",
    });
    return null;
  });
  if (failure) return failure;
  revalidatePath(`/purchases/${doc.orderId}`);
  revalidatePath(`/purchases/${doc.orderId}/edit`);
  return ok({ id: documentId });
}
