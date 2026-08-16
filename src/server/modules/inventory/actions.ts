"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { createApproval, openApprovalForAsset } from "@/server/modules/approvals/create";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";
import { ASSET_STATUSES, buildAssetWhere, INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { parseListState } from "@/lib/url-state";

const BULK_MAX = 200;

const bulkSchema = z
  .object({
    ids: z.array(z.string().min(1)).max(500).optional(),
    /** serialized list query (e.g. "status=SPARE&q=dell") when acting on all matching */
    filters: z.string().max(2000).optional(),
    to: z.enum(ASSET_STATUSES),
    reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500),
  })
  .refine((v) => (v.ids?.length ?? 0) > 0 || v.filters !== undefined, {
    message: "Nothing is selected",
    path: ["ids"],
  });

/**
 * Bulk lifecycle change = one lifecycle.change-status approval PER asset —
 * never a direct write (spec: approvals gate lifecycle). Assets already in
 * the target status or with an open approval are skipped and counted.
 */
export async function bulkRequestStatusChange(
  input: unknown,
): Promise<ActionResult<{ created: number; skipped: number }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { ids, filters, to, reason } = parsed.data;

  const where = ids?.length
    ? { id: { in: ids } }
    : buildAssetWhere(parseListState(new URLSearchParams(filters), INVENTORY_LIST_CONFIG));

  const assets = await prisma.asset.findMany({
    where,
    take: BULK_MAX + 1,
    select: { id: true, status: true },
  });
  if (assets.length === 0) return conflict("Nothing matched the selection.");
  if (assets.length > BULK_MAX) {
    return conflict(`That selection exceeds the ${BULK_MAX}-asset bulk cap — narrow the filter and repeat.`);
  }

  let created = 0;
  let skipped = 0;
  await prisma.$transaction(async (tx) => {
    for (const asset of assets) {
      if (asset.status === to || (await openApprovalForAsset(tx, asset.id))) {
        skipped += 1;
        continue;
      }
      const approval = await createApproval(tx, {
        type: "lifecycle_change_status",
        payload: { from: { status: asset.status }, to: { status: to }, reason },
        requestedById: user.id,
        assetId: asset.id,
      });
      await writeAudit(tx, {
        actorId: user.id,
        actorLabel: user.name,
        entityType: "asset",
        entityId: asset.id,
        action: "approval.requested",
        diff: { approval: { from: null, to: approval.refNo } },
      });
      created += 1;
    }
  });

  revalidatePath("/inventory");
  return ok({ created, skipped });
}
