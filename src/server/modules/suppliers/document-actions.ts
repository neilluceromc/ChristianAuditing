"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { conflict, forbidden, ok, rateLimited, validationError, type ActionResult } from "@/server/action-result";
import { canManageSuppliers } from "@/lib/supplier-access";
import { SUPPLIER_DOCUMENT_KINDS } from "@/lib/documents";
import { storeUpload, validateUpload } from "@/server/uploads";

/** Mirrors inventory/document-actions.ts's uploadDocument, with vendorId in place of assetId. */
export async function uploadSupplierDocument(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await actionUser();
  if (!user || !canManageSuppliers(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const vendorId = String(formData.get("vendorId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!vendorId) return conflict("Missing supplier.");
  if (!(SUPPLIER_DOCUMENT_KINDS as readonly string[]).includes(kind)) return validationError({ kind: "Pick a document kind" });
  const checked = validateUpload(formData.get("file"));
  if (!checked.ok) return validationError({ file: checked.error });

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) return conflict("That supplier no longer exists.");

  const stored = await storeUpload(`suppliers/${vendorId}`, checked.file);

  const doc = await prisma.$transaction(async (tx) => {
    const created = await tx.vendorDocument.create({
      data: {
        vendorId, kind,
        fileName: stored.fileName,
        path: stored.relPath, checksum: stored.checksum,
        uploadedById: user.id,
      },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "vendor", entityId: vendorId,
      action: "document.uploaded",
      diff: { document: { from: null, to: created.fileName } },
    });
    return created;
  });
  revalidatePath(`/purchases/suppliers/${vendorId}`);
  return ok({ id: doc.id });
}
