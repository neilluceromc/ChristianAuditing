import { Prisma } from "@prisma/client";

/** A row-local failure with an operator-facing reason, never a raw Prisma error. */
export class RowWriteError extends Error {}

/**
 * A-6: the operator gets a number that adds up and a reason to act on for
 * every failed row, never a raw Prisma error string (§6a rule 59 — never
 * quote one at an operator). Extracted out of `asset-actions.ts` (a `"use
 * server"` module, which permits only async exports, so this was
 * structurally unreachable by any unit test) alongside `assetDiff`
 * (`src/lib/asset-diff.ts`) — the same discovery Task 9 made about
 * `resolveAssetRefs`/`buildAssetRefs`.
 *
 * `kind` distinguishes the CREATE-side P2002 from the update-side one
 * (I-4, Task 10 round two): a concurrent double-click on Apply re-plans
 * before either call writes, so both calls plan CREATE for the same tag,
 * and the loser hits this exact constraint. Asserting "would duplicate a
 * tag or serial already on file" on that row is a misattribution — it sends
 * the operator hunting for a duplicate in their spreadsheet that isn't
 * there. Naming the possibility, rather than asserting the wrong cause, is
 * the fix here; disabling the Apply button is T11's, and is a courtesy, not
 * a guarantee (a re-POST, a refresh, a second tab all bypass it), which is
 * why this can't be "fixed" by a lock instead.
 */
export function classifyRowError(err: unknown, kind: "create" | "update"): string {
  if (err instanceof RowWriteError) return err.message;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return kind === "create"
        ? "would duplicate a tag or serial already on file — or this same file may have just been " +
            "applied twice at once (a second click, tab, or retry)"
        : "would duplicate a tag or serial already on file";
    }
    if (err.code === "P2003") return "names a category, type or vendor that no longer exists";
  }
  return "could not be written — re-check this row and retry";
}
