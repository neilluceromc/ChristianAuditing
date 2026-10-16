"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { canSeeClass } from "@/lib/asset-class";
import {
  SPARE_INCLUDE, SPARE_LIMIT, orderSpareCandidates, spareCandidatesSchema, spareSearchWhere, toSpareOption,
  type SpareOption,
} from "@/lib/spare-candidates";

/**
 * Phase 39 (spec §6): read-only — the profile's Fill, Replace and Reserve pickers ask for their spares when they
 * open instead of the page shipping every one. The profile's pool, matched on tag or model when text is typed,
 * the slot's type first, then by tag, at most SPARE_LIMIT. Nothing is written.
 */
export async function spareCandidates(input: unknown): Promise<ActionResult<SpareOption[]>> {
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
  const [sameType, others] = await Promise.all([
    assetTypeId ? find({ typeId: assetTypeId }) : Promise.resolve([]),
    find(assetTypeId ? { OR: [{ typeId: null }, { typeId: { not: assetTypeId } }] } : {}),
  ]);
  return ok(orderSpareCandidates([...sameType, ...others], assetTypeId ?? null).map((r) => toSpareOption(r, employeeId)));
}
