"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { conflict, forbidden, ok, rateLimited, validationError, type ActionResult } from "@/server/action-result";
import { canAttachToRequest } from "@/lib/supplier-access";
import { REQUEST_DOCUMENT_KINDS } from "@/lib/documents";
import { storeUpload, validateUpload } from "@/server/uploads";

/** Mirrors suppliers/document-actions.ts's uploadSupplierDocument, with requestId in place of vendorId. */
export async function uploadRequestDocument(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await actionUser();
  if (!user || !canAttachToRequest(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const requestId = String(formData.get("requestId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!requestId) return conflict("Missing request.");
  if (!(REQUEST_DOCUMENT_KINDS as readonly string[]).includes(kind)) return validationError({ kind: "Pick a document kind" });
  const checked = validateUpload(formData.get("file"));
  if (!checked.ok) return validationError({ file: checked.error });

  const request = await prisma.purchaseRequest.findUnique({ where: { id: requestId } });
  if (!request) return conflict("That request no longer exists.");

  const stored = await storeUpload(`requests/${requestId}`, checked.file);

  const doc = await prisma.$transaction(async (tx) => {
    const created = await tx.requestDocument.create({
      data: {
        requestId, kind,
        fileName: stored.fileName,
        path: stored.relPath, checksum: stored.checksum,
        uploadedById: user.id,
      },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "purchase-request", entityId: requestId,
      action: "document.uploaded",
      diff: { document: { from: null, to: created.fileName } },
    });
    return created;
  });
  revalidatePath(`/purchases/${requestId}`);
  return ok({ id: doc.id });
}
