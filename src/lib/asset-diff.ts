import { diffOf, type AuditDiff } from "@/lib/audit-diff";

/**
 * Day-precision truncation, for the COMPARISON only. Seed/legacy rows can
 * carry a real time-of-day on `purchasedAt`/`warrantyUntil`; both the
 * inventory edit form and the importer round-trip those columns at UTC
 * midnight. Left at full precision, comparing `before` against either
 * would call every unedited row of such an asset "changed". Non-Date
 * values (including `null`) pass through untouched.
 */
function toDay(value: unknown): unknown {
  return value instanceof Date ? new Date(`${value.toISOString().slice(0, 10)}T00:00:00Z`) : value;
}

/**
 * The single comparison-and-write-set function shared by `updateAsset`
 * (`src/server/modules/inventory/actions.ts`) and `applyAssetImport`
 * (`src/server/modules/import/asset-actions.ts`) — extracted (C-1, Task 10
 * round two) because the two paths had already drifted: `updateAsset`
 * carried its own copy of the day-precision `toDay`, and the import took
 * only HALF of `updateAsset`'s two-clause fix (compare at day precision,
 * AND write only the changed fields) — writing the whole patch instead of
 * the changed subset, which silently truncated `purchasedAt` and
 * `warrantyUntil` to midnight on every edited re-import, into an
 * append-only audit table that could never record the loss. Both callers
 * now go through here, so they cannot diverge again.
 *
 * Both normalisations below are COMPARISON-ONLY — `patch` itself (what a
 * caller actually writes) is never mutated:
 *  - day-precision dates, via `toDay` (see above).
 *  - `cost` read as a `Number`. `AssetUpdatePatch.cost` (and the direct-edit
 *    form's `data.cost`) is a decimal STRING by deliberate design, so no
 *    float ever reaches the WRITE — but `diffOf`'s own `normalize()` reduces
 *    a stored `Prisma.Decimal` to a `Number` via `toNumber()`, so comparing
 *    `before.cost` (a Decimal) against a bare string always disagrees. This
 *    reads the string as a Number for the comparison only, which is
 *    consistent with what `diffOf` already does to the other side, not a
 *    reintroduction of float money into anything that gets stored.
 *
 * Returns `diff` (unchanged — what `writeAudit` records) and `changed`,
 * `patch` filtered down to exactly the keys `diff` names. `diffOf` only
 * inspects keys PRESENT on `patch` (`Object.keys(after)`), and
 * `Object.entries` below does the same, so a key genuinely ABSENT from
 * `patch` — `AssetUpdatePatch`'s own absent/null/value contract — never
 * appears in `diff` NOR in `changed`. Writing `changed` instead of `patch`
 * itself is what keeps an untouched column at its stored value (including
 * time-of-day) instead of truncating it to midnight with no record.
 */
export function assetDiff(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): { diff: AuditDiff; changed: Record<string, unknown> } {
  const beforeForDiff: Record<string, unknown> = {
    ...before,
    purchasedAt: toDay(before.purchasedAt),
    warrantyUntil: toDay(before.warrantyUntil),
  };
  const patchForDiff: Record<string, unknown> = { ...patch };
  if (patchForDiff.cost !== undefined && patchForDiff.cost !== null) {
    patchForDiff.cost = Number(patchForDiff.cost as string);
  }
  const diff = diffOf(beforeForDiff, patchForDiff);
  const changed = Object.fromEntries(Object.entries(patch).filter(([key]) => key in diff));
  return { diff, changed };
}
