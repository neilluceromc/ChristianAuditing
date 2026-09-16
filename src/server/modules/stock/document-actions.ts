"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { canManageStock } from "@/lib/stock-access";
import { LOT_DOCUMENT_KINDS } from "@/lib/stock-schema";
import { localDateISO } from "@/lib/format";
import { storeUpload, validateUpload } from "@/server/uploads";
import { conflict, forbidden, ok, rateLimited, validationError, type ActionResult } from "@/server/action-result";

/**
 * Spec §5.3/facts R3. Mirrors `purchases/document-actions.ts`'s
 * `uploadRequestDocument` field for field, with `lotId` in place of
 * `requestId` and `stock-lots/<lotId>` in place of `requests/<id>` as the
 * upload directory. The audit stays on `entityType: "stock-item"` (the
 * lot's item), naming the lot in the diff — no `stock-lot` audit entity
 * exists (R3 supersedes spec §5.4's "labels stock-lot entities").
 */
export async function uploadLotDocument(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const lotId = String(formData.get("lotId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!lotId) return conflict("Missing lot.");
  if (!(LOT_DOCUMENT_KINDS as readonly string[]).includes(kind)) return validationError({ kind: "Pick a document kind" });
  const checked = validateUpload(formData.get("file"));
  if (!checked.ok) return validationError({ file: checked.error });

  const lot = await prisma.stockLot.findUnique({
    where: { id: lotId },
    select: { id: true, reference: true, lotDate: true, item: { select: { id: true } } },
  });
  if (!lot) return conflict("That lot no longer exists.");

  let stored: Awaited<ReturnType<typeof storeUpload>>;
  try {
    stored = await storeUpload(`stock-lots/${lotId}`, checked.file);
  } catch {
    return conflict("Could not store the file");
  }

  const doc = await prisma.$transaction(async (tx) => {
    const created = await tx.stockLotDocument.create({
      data: {
        lotId, kind,
        fileName: stored.fileName,
        path: stored.relPath, checksum: stored.checksum,
        uploadedById: user.id,
      },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "stock-item", entityId: lot.item.id,
      action: "stock.document-added",
      diff: {
        lot: { from: null, to: lot.reference || localDateISO(lot.lotDate) },
        kind: { from: null, to: kind },
      },
    });
    return created;
  });
  revalidatePath(`/stock/items/${lot.item.id}`);
  return ok({ id: doc.id });
}
