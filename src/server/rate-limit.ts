import { prisma } from "./db/client";
import { RATE_LIMITS, rateDecision, type RateDecision, type RateKind } from "@/lib/rate-limit";

/**
 * Spec §5 step 2 — check-and-record against the RateEvent table. The event
 * is recorded only when allowed, so blocked retries don't extend the block.
 * Runs BEFORE validation: the cap counts attempts, not successes.
 */
export async function checkRate(userId: string, kind: RateKind = "mutation"): Promise<RateDecision> {
  const { limit, windowMs } = RATE_LIMITS[kind];
  const recent = await prisma.rateEvent.findMany({
    where: { userId, kind, at: { gte: new Date(Date.now() - windowMs) } },
    orderBy: { at: "desc" },
    take: limit,
    select: { at: true },
  });
  const decision = rateDecision(recent.map((r) => r.at), kind, new Date());
  if (decision.allowed) await prisma.rateEvent.create({ data: { userId, kind } });
  return decision;
}
