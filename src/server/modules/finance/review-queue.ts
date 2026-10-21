import type { AssetClass } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { regWhere } from "@/lib/registration";

/**
 * Finance follow-up (spec §4): how many of the class are still To review, for the approve toast's "Next: BR-LT-0204 ·
 * 3 left to review". The same set `nextToReview` picks from (queries.ts), counted after the approval commits, so the
 * asset just approved is not in it and the next one is.
 */
export async function toReviewCount(cls: AssetClass): Promise<number> {
  return prisma.asset.count({ where: { cls, ...regWhere("with-finance") } });
}
