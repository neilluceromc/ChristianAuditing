import { prisma } from "./db/client";
import { RECENT_KINDS, parseRecent, pushRecent, recentKey, type RecentKind } from "@/lib/recent-picks";

/** Spec §5.3: the stored list for a page render, parsed defensively. */
export async function recentPicks(userId: string, kind: RecentKind): Promise<string[]> {
  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: recentKey(kind) } }, select: { value: true },
  });
  return parseRecent(row?.value);
}

/**
 * Best effort, called AFTER the caller's transaction committed (decision 7): a failure is logged and
 * swallowed — the domain action has already succeeded. Not audited, no rate event.
 */
export async function rememberPicks(userId: string, picks: Partial<Record<RecentKind, string | null | undefined>>): Promise<void> {
  for (const kind of RECENT_KINDS) {
    const id = picks[kind];
    if (!id) continue;
    try {
      const key = recentKey(kind);
      const next = pushRecent(await recentPicks(userId, kind), id);
      await prisma.userPreference.upsert({
        where: { userId_key: { userId, key } }, update: { value: next }, create: { userId, key, value: next },
      });
    } catch (err) {
      console.error(`recent-picks: could not remember ${kind} for user ${userId}`, err);
    }
  }
}
