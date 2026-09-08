"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { canSetRequestSupplier } from "@/lib/supplier-access";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const schema = z.object({ id: z.string().min(1), vendorId: z.string().min(1).nullable() });

/**
 * Spec §5.2: one supplier per request, settable by the same roles that
 * manage suppliers. `vendorId: null` clears it. Archived can be READ (a
 * request that already points at one keeps showing it, ARCHIVED-tagged) but
 * never newly assigned — the "restore it first" refusal below.
 */
export async function setRequestSupplier(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user || !canSetRequestSupplier(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id, vendorId } = parsed.data;
  const request = await prisma.purchaseRequest.findUnique({
    where: { id },
    select: { id: true, vendor: { select: { id: true, name: true } } },
  });
  if (!request) return conflict("That request no longer exists.");
  let to: { id: string; name: string } | null = null;
  if (vendorId) {
    const v = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true, archivedAt: true } });
    if (!v) return conflict("Unknown supplier.");
    if (v.archivedAt) return conflict("That supplier is archived — restore it first.");
    to = { id: v.id, name: v.name };
  }
  if ((request.vendor?.id ?? null) === (to?.id ?? null)) return ok(null);
  await prisma.$transaction(async (tx) => {
    await tx.purchaseRequest.update({ where: { id }, data: { vendorId: to?.id ?? null } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "purchase-request", entityId: id,
      action: "supplier-set", diff: { supplier: { from: request.vendor?.name ?? null, to: to?.name ?? null } },
    });
  });
  revalidatePath("/purchases"); revalidatePath(`/purchases/${id}`);
  if (request.vendor) revalidatePath(`/purchases/suppliers/${request.vendor.id}`);
  if (to) revalidatePath(`/purchases/suppliers/${to.id}`);
  return ok(null);
}
