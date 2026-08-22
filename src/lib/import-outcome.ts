/**
 * Two pure functions that used to live inside `import-wizard.tsx`, where a
 * node-environment vitest could never reach them (`vitest.config.ts`: "unit
 * tests are node-only by design; component behaviour is covered by
 * Playwright e2e"). Both take and return plain data — no React, no server
 * import — so both a client component and a unit test can call them.
 *
 * This is the third task in the phase whose defect lived in a function that
 * could not be reached by a test: `resolveAssetRefs` before `buildAssetRefs`,
 * `assetDiff` before it left `"use server"`, and now the divergence
 * predicate below.
 */

/** The verdict the operator approved at Validate — `AssetPlan.counts`. */
export interface ApprovedCounts {
  create: number;
  update: number;
  blocked: number;
}

/** What the write loop actually did — the shape `applyAssetImport` resolves to. */
export interface AppliedCounts {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

/**
 * Task 11 round two, V-1: `AssetPlan.counts` is `{create, update, blocked}`
 * with NO `unchanged` bucket, and it cannot have one — the plan can't know a
 * row is a no-op, because `AssetRecordRef` (`resolve.ts`) carries only
 * `id/tag/status/assigneeId/categoryId/typeId`, never `model`/`serial`/
 * `cost`. `unchanged` is discovered at write time by `assetDiff`. So a
 * predicate comparing `applied.created + applied.updated` against
 * `approved.create + approved.update` falls short by exactly the `unchanged`
 * count on every re-upload of an unedited file — the flagship happy path —
 * and reads that shortfall as the world having moved.
 *
 * The write loop (`applyAssetImport`) guarantees, by construction, that
 * every non-blocked row of the RE-PLAN resolves to exactly one of created,
 * updated, unchanged or failed — so `created + updated + unchanged + failed`
 * always equals the re-plan's own `create + update`, and `skipped` always
 * equals the re-plan's own `blocked`. Comparing THAT reconstructed sum
 * against the counts the operator approved at Validate is what actually asks
 * "did the world move between the two calls" — and it also keeps a per-row
 * write failure (it has its own panel) from masquerading as divergence: a
 * failed row is counted on both sides of the identity, not subtracted from
 * one.
 */
export function hasDiverged(approved: ApprovedCounts, applied: AppliedCounts): boolean {
  return (
    applied.created + applied.updated + applied.unchanged + applied.failed !==
      approved.create + approved.update ||
    applied.skipped !== approved.blocked
  );
}

/** The counts `applySummary` needs — a subset of `AppliedCounts`. */
export interface ApplySummaryCounts {
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
}

/**
 * The toast copy for a completed apply. `unchanged` is the happy path's
 * headline, not a detail folded away: re-uploading an unedited export is the
 * workflow this feature exists for, and every one of its rows is an update
 * that changes nothing. "Imported 0 new and 0 updated" would read as a
 * failure when the import did exactly the right thing.
 */
export function applySummary(data: ApplySummaryCounts): { message: string; tone: "settled" | "fault" } {
  const parts: string[] = [];
  if (data.created > 0) parts.push(`${data.created} new`);
  if (data.updated > 0) parts.push(`${data.updated} updated`);
  let message: string;
  if (parts.length > 0) {
    message = `Imported ${parts.join(" and ")}`;
    if (data.unchanged > 0) message += ` · ${data.unchanged} already matched`;
  } else if (data.unchanged > 0) {
    message = `${data.unchanged} row${data.unchanged === 1 ? "" : "s"} already matched — nothing needed changing`;
  } else {
    message = "Nothing was imported";
  }
  if (data.failed > 0) message += ` — ${data.failed} failed, refresh and re-check`;
  return { message, tone: data.failed > 0 ? "fault" : "settled" };
}
