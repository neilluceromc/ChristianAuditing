"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { canSeeClass } from "@/lib/asset-class";
import {
  SPARE_INCLUDE, SPARE_LIMIT, heldOrQueuedWhere, orderSpareCandidates, spareCandidatesSchema, spareSearchWhere, spareWhere,
  toSpareOption, type SpareCandidateCounts, type SpareCandidates,
} from "@/lib/spare-candidates";

/**
 * Phase 39 (spec §6): read-only — the profile's Fill, Replace and Reserve pickers ask for their spares when they
 * open instead of the page shipping every one. The profile's pool, matched on tag or model when text is typed,
 * the slot's type first, then by tag, at most SPARE_LIMIT. The untyped call also counts the whole pool (and the
 * slot's type): how many spares there are and how many are held or queued for someone else, so the dialogs'
 * "nothing in stock", "all held", "{n} more…" and sole-spare preselect never depend on which rows were loaded.
 * Nothing is written.
 */
export async function spareCandidates(input: unknown): Promise<ActionResult<SpareCandidates>> {
  const user = await actionUser();
  if (!user) return forbidden();
  if (!canSeeClass(user.role, "IT")) return forbidden();
  const rate = await checkRate(user.id, "check"); // a picker read writes nothing: the "check" budget
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = spareCandidatesSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { employeeId, assetTypeId, q } = parsed.data;

  const pool = spareSearchWhere(q);
  const find = (narrow: Prisma.AssetWhereInput) => prisma.asset.findMany({
    where: { AND: [pool, narrow] },
    include: SPARE_INCLUDE,
    orderBy: { tag: "asc" },
    take: SPARE_LIMIT,
  });
  // Two bounded reads, so the slot's own type is never crowded out by other types earlier in the alphabet.
  const [sameType, others, counts] = await Promise.all([
    assetTypeId ? find({ typeId: assetTypeId }) : Promise.resolve([]),
    find(assetTypeId ? { OR: [{ typeId: null }, { typeId: { not: assetTypeId } }] } : {}),
    q ? Promise.resolve(null) : poolCounts(employeeId, assetTypeId),
  ]);
  return ok({
    spares: orderSpareCandidates([...sameType, ...others], assetTypeId ?? null).map((r) => toSpareOption(r, employeeId)),
    counts,
  });
}

/** Four plain counts over the same pool: all of it and the slot's type, each in total and held or queued. */
async function poolCounts(employeeId: string, assetTypeId: string | undefined): Promise<SpareCandidateCounts> {
  const count = (...narrow: Prisma.AssetWhereInput[]) => prisma.asset.count({ where: { AND: [spareWhere(), ...narrow] } });
  const held = heldOrQueuedWhere(employeeId);
  const typed = assetTypeId ? { typeId: assetTypeId } : null;
  const [total, heldOrQueued, typeTotal, typeHeld] = await Promise.all([
    count(),
    count(held),
    typed ? count(typed) : Promise.resolve(0),
    typed ? count(typed, held) : Promise.resolve(0),
  ]);
  return {
    all: { total, heldOrQueued },
    sameType: typed ? { total: typeTotal, heldOrQueued: typeHeld } : null,
  };
}
