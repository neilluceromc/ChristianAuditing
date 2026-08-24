import { describe, expect, it } from "vitest";
import { applySummary, hasDiverged } from "./import-outcome";

describe("hasDiverged", () => {
  // Task 11 round two, V-1: this exact case is the flagship happy path — an
  // unedited re-upload of a real export, where every row resolves to
  // `unchanged`. The pre-fix predicate (`applyOutcome.created +
  // applyOutcome.updated !== result.plan.counts.create +
  // result.plan.counts.update`) reads 0 !== 25 here and raises a false
  // alarm. This is the single case the round-two review named as the one
  // that "would have caught V-1 today, with no browser and no database."
  it("does not diverge when every row matches the approved plan and simply needed no change", () => {
    expect(
      hasDiverged(
        { create: 0, update: 25, blocked: 0 },
        { created: 0, updated: 0, unchanged: 25, skipped: 0, failed: 0 },
      ),
    ).toBe(false);
  });

  it("does not diverge on a 100%-creates file either (the case that was already silent)", () => {
    expect(
      hasDiverged(
        { create: 10, update: 0, blocked: 0 },
        { created: 10, updated: 0, unchanged: 0, skipped: 0, failed: 0 },
      ),
    ).toBe(false);
  });

  it("does not diverge on a mix of create, update and unchanged", () => {
    expect(
      hasDiverged(
        { create: 2, update: 3, blocked: 1 },
        { created: 2, updated: 1, unchanged: 2, skipped: 1, failed: 0 },
      ),
    ).toBe(false);
  });

  // A per-row write failure has its own panel (`applyOutcome.failures`) and
  // must not also masquerade as the world having moved between Validate and
  // Apply — it is counted on both sides of the reconstructed identity.
  it("does not diverge when a row fails to write, on its own", () => {
    expect(
      hasDiverged(
        { create: 0, update: 5, blocked: 0 },
        { created: 0, updated: 4, unchanged: 0, skipped: 0, failed: 1 },
      ),
    ).toBe(false);
  });

  // The world genuinely moving: an admin renamed a category between Validate
  // and Apply, so a row that was approved as an update now blocks instead.
  it("diverges when a previously-approved row blocks at apply time", () => {
    expect(
      hasDiverged(
        { create: 0, update: 5, blocked: 0 },
        { created: 0, updated: 4, unchanged: 0, skipped: 1, failed: 0 },
      ),
    ).toBe(true);
  });

  // The world moving the other way: something that was blocked at Validate
  // (e.g. a category got created) now resolves at Apply.
  it("diverges when a previously-blocked row resolves at apply time", () => {
    expect(
      hasDiverged(
        { create: 0, update: 5, blocked: 1 },
        { created: 0, updated: 6, unchanged: 0, skipped: 0, failed: 0 },
      ),
    ).toBe(true);
  });

  // R-1 (round two review): the SUMS agree here and the mix does not. Between
  // Validate and Apply another operator creates an asset carrying a tag this
  // file planned to CREATE; the re-plan matches it by tag and the row becomes
  // an UPDATE. An existing record was overwritten where a new one was
  // approved — the most consequential thing the world can do to an import —
  // and a totals-only predicate reports no divergence at all.
  it("diverges when an approved CREATE was applied as an update instead", () => {
    expect(
      hasDiverged(
        { create: 1, update: 4, blocked: 0 },
        { created: 0, updated: 5, unchanged: 0, skipped: 0, failed: 0 },
      ),
    ).toBe(true);
  });

  // The mirror: an approved UPDATE that could not be matched and was created
  // instead (the asset was deleted between the two calls).
  it("diverges when an approved UPDATE was applied as a create instead", () => {
    expect(
      hasDiverged(
        { create: 1, update: 4, blocked: 0 },
        { created: 2, updated: 3, unchanged: 0, skipped: 0, failed: 0 },
      ),
    ).toBe(true);
  });

  // ...and the reason the per-bucket comparison is one-directional: `failed`
  // is not split by row kind, so a failure on either side must be allowed to
  // absorb the shortfall rather than reading as a swap.
  it("does not call a per-row write failure a composition swap", () => {
    expect(
      hasDiverged(
        { create: 2, update: 3, blocked: 0 },
        { created: 1, updated: 3, unchanged: 0, skipped: 0, failed: 1 },
      ),
    ).toBe(false);
  });
});

describe("applySummary", () => {
  it("leads with unchanged when nothing else happened, rather than reading as a failure", () => {
    expect(applySummary({ created: 0, updated: 0, unchanged: 25, failed: 0, skipped: 0 })).toEqual({
      message: "25 rows already matched — nothing needed changing",
      tone: "settled",
    });
  });

  it("uses the singular for exactly one unchanged row", () => {
    expect(applySummary({ created: 0, updated: 0, unchanged: 1, failed: 0, skipped: 0 })).toEqual({
      message: "1 row already matched — nothing needed changing",
      tone: "settled",
    });
  });

  it("reports nothing imported when the file was entirely empty of eligible rows", () => {
    expect(applySummary({ created: 0, updated: 0, unchanged: 0, failed: 0, skipped: 0 })).toEqual({
      message: "Nothing was imported",
      tone: "settled",
    });
  });

  it("folds unchanged in as a trailing detail once there is real work to report", () => {
    expect(applySummary({ created: 3, updated: 2, unchanged: 20, failed: 0, skipped: 0 })).toEqual({
      message: "Imported 3 new and 2 updated · 20 already matched",
      tone: "settled",
    });
  });

  it("reports created alone without an 'and'", () => {
    expect(applySummary({ created: 3, updated: 0, unchanged: 0, failed: 0, skipped: 0 })).toEqual({
      message: "Imported 3 new",
      tone: "settled",
    });
  });

  // Round two review, Minor: "Nothing was imported" while rows were SKIPPED
  // is not a settled outcome — every row the operator approved blocked at
  // re-plan, so the import did none of what was asked. Same sentence, and it
  // must not arrive in green. (The divergence banner fires alongside it; the
  // toast contradicting that banner is what this pins.)
  it("is not settled when nothing was written because everything skipped", () => {
    expect(applySummary({ created: 0, updated: 0, unchanged: 0, failed: 0, skipped: 200 })).toEqual({
      message: "Nothing was imported",
      tone: "fault",
    });
  });

  it("appends failures and switches tone to fault, even on an otherwise happy import", () => {
    expect(applySummary({ created: 0, updated: 0, unchanged: 24, failed: 1, skipped: 0 })).toEqual({
      message: "24 rows already matched — nothing needed changing — 1 failed, refresh and re-check",
      tone: "fault",
    });
  });
});
