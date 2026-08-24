import { diffOf, type AuditDiff } from "@/lib/audit-diff";
import { toDay } from "@/lib/asset-diff";

/**
 * The employee update-write's comparison-and-write-set function — the same
 * shape as `assetDiff` (`src/lib/asset-diff.ts`), sharing its `toDay` rather
 * than a second hand-written copy (Task 12, E-9).
 *
 * Day-precision matters here for the identical reason it matters for
 * `purchasedAt`/`warrantyUntil`: `prisma/seed.ts`'s `day()` helper stamps
 * `Date.now()` shifted by whole days, NEVER truncated to midnight, so every
 * seeded employee's `joinedAt` carries a real time-of-day — while the
 * importer's `parseDateCell` always produces UTC midnight. Left at full
 * precision, re-uploading an unedited export would call every seeded
 * employee's row "changed" on `joinedAt` alone, the exact defect `assetDiff`
 * exists to prevent for `purchasedAt`/`warrantyUntil`.
 *
 * Unlike `assetDiff`, there is no cost-string normalisation (employees carry
 * no money field) — only the one date-shaped column needs it.
 *
 * `changed` is `patch` filtered down to exactly the keys `diff` names, so an
 * unedited re-upload writes nothing (no `updatedAt` bump, no audit row) —
 * the same "nothing needed doing" outcome `assetDiff` produces, counted as
 * `unchanged` by the caller rather than silently treated as a no-op update.
 */
export function employeeDiff(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): { diff: AuditDiff; changed: Record<string, unknown> } {
  const beforeForDiff: Record<string, unknown> = {
    ...before,
    joinedAt: toDay(before.joinedAt),
  };
  const diff = diffOf(beforeForDiff, patch);
  const changed = Object.fromEntries(Object.entries(patch).filter(([key]) => key in diff));
  return { diff, changed };
}
