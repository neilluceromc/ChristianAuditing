import { prisma } from "../server/db/client";
import { dayFromISO } from "../lib/deadlines";
import { localDateISO } from "../lib/format";

/**
 * Phase 26 (spec §4.3): a hold is live through the whole of its last day
 * (Asia/Manila); anything older flips to EXPIRED. `expiresAt` is stored at UTC
 * midnight (schema.prisma, Reservation.expiresAt), so `lt: start of today` is
 * `isHoldExpired` written in SQL — the two agree only because of that invariant.
 */
export async function expireHolds(now: Date = new Date()): Promise<number> {
  const cutoff = dayFromISO(localDateISO(now));
  const r = await prisma.reservation.updateMany({
    where: { state: "ACTIVE", expiresAt: { lt: cutoff } },
    data: { state: "EXPIRED", resolvedAt: now },
  });
  return r.count;
}
