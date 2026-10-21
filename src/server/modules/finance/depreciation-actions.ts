"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { overrideSchema, policySchema } from "@/lib/depreciation-input";

/** Phase 35 (spec §5.4): a category's policy; the reply says how many costed assets it now drives (overrides excluded). */
export async function setCategoryPolicy(input: unknown): Promise<ActionResult<{ affected: number }>> {
  const user = await actionRole("admin", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const cat = await prisma.assetCategory.findUnique({ where: { id: d.categoryId } });
  if (!cat) return conflict("That category no longer exists. Refresh and try again.");
  const before = { lifeMonths: cat.depreciationLifeMonths, salvagePercent: cat.depreciationSalvagePercent === null ? null : Number(cat.depreciationSalvagePercent) };
  await prisma.$transaction(async (tx) => {
    await tx.assetCategory.update({
      where: { id: cat.id },
      data: { depreciationLifeMonths: d.lifeMonths, depreciationSalvagePercent: d.lifeMonths === null ? null : (d.salvagePercent ?? 0) },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "asset-category", entityId: cat.id, action: "depreciation.policy",
      diff: {
        lifeMonths: { from: before.lifeMonths, to: d.lifeMonths },
        salvagePercent: { from: before.salvagePercent, to: d.lifeMonths === null ? null : (d.salvagePercent ?? 0) },
      },
    });
  });
  const affected = await prisma.asset.count({ where: { categoryId: cat.id, cost: { not: null }, financeNotCapitalised: false, depreciationLifeMonths: null } });
  revalidatePath("/finance/depreciation");
  revalidatePath("/finance/assets");
  return ok({ affected });
}

const CHANGED = "Someone else just changed this asset's depreciation. Reload and try again.";

/** The override columns as read: the guard that makes a concurrent change refuse instead of being overwritten. */
function overrideGuard(a: { depreciationLifeMonths: number | null; depreciationSalvage: Prisma.Decimal | null; depreciationNote: string | null }) {
  return { depreciationLifeMonths: a.depreciationLifeMonths, depreciationSalvage: a.depreciationSalvage, depreciationNote: a.depreciationNote };
}

/** Phase 35 (spec §5.5): life AND salvage (pesos) AND a reason, together. */
export async function setAssetOverride(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  // Read and write in one transaction, the write guarded on the override (and cost) just read: a change landing in
  // between refuses rather than recording a stale "before", which the undo (finance-undo.ts) would restore.
  const failure = await prisma.$transaction(async (tx): Promise<ActionResult<null> | null> => {
    const asset = await tx.asset.findUnique({ where: { id: d.assetId } });
    if (!asset || asset.cost === null) return conflict("This asset has no cost, so it can't depreciate.");
    if (d.salvage >= Number(asset.cost)) return validationError({ salvage: "Salvage must be less than the cost" });
    const hit = await tx.asset.updateMany({
      where: { id: asset.id, ...overrideGuard(asset), cost: asset.cost },
      data: { depreciationLifeMonths: d.lifeMonths, depreciationSalvage: d.salvage, depreciationNote: d.note },
    });
    if (hit.count === 0) return conflict(CHANGED);
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id, action: "depreciation.override",
      diff: {
        lifeMonths: { from: asset.depreciationLifeMonths, to: d.lifeMonths },
        salvage: { from: asset.depreciationSalvage === null ? null : Number(asset.depreciationSalvage), to: d.salvage },
        note: { from: asset.depreciationNote, to: d.note },
      },
    });
    return null;
  });
  if (failure) return failure;
  revalidatePath("/finance/assets");
  revalidatePath("/finance/depreciation");
  return ok(null);
}

export async function clearAssetOverride(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const id = typeof input === "object" && input && "assetId" in input ? String((input as { assetId: unknown }).assetId) : "";
  if (!id) return validationError({ assetId: "Missing asset" });
  const failure = await prisma.$transaction(async (tx): Promise<ActionResult<null> | null> => {
    const asset = await tx.asset.findUnique({ where: { id } });
    if (!asset || asset.depreciationLifeMonths === null) return conflict("This asset has no custom depreciation to clear.");
    const hit = await tx.asset.updateMany({
      where: { id, ...overrideGuard(asset) },
      data: { depreciationLifeMonths: null, depreciationSalvage: null, depreciationNote: null },
    });
    if (hit.count === 0) return conflict(CHANGED);
    // What was removed, so an undo (finance-undo.ts) can put it back exactly.
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: id, action: "depreciation.override.cleared",
      diff: {
        lifeMonths: { from: asset.depreciationLifeMonths, to: null },
        salvage: { from: asset.depreciationSalvage === null ? null : Number(asset.depreciationSalvage), to: null },
        note: { from: asset.depreciationNote, to: null },
      },
    });
    return null;
  });
  if (failure) return failure;
  revalidatePath("/finance/assets");
  revalidatePath("/finance/depreciation");
  return ok(null);
}
