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
});

describe("applySummary", () => {
  it("leads with unchanged when nothing else happened, rather than reading as a failure", () => {
    expect(applySummary({ created: 0, updated: 0, unchanged: 25, failed: 0 })).toEqual({
      message: "25 rows already matched — nothing needed changing",
      tone: "settled",
    });
  });

  it("uses the singular for exactly one unchanged row", () => {
    expect(applySummary({ created: 0, updated: 0, unchanged: 1, failed: 0 })).toEqual({
      message: "1 row already matched — nothing needed changing",
      tone: "settled",
    });
  });

  it("reports nothing imported when the file was entirely empty of eligible rows", () => {
    expect(applySummary({ created: 0, updated: 0, unchanged: 0, failed: 0 })).toEqual({
      message: "Nothing was imported",
      tone: "settled",
    });
  });

  it("folds unchanged in as a trailing detail once there is real work to report", () => {
    expect(applySummary({ created: 3, updated: 2, unchanged: 20, failed: 0 })).toEqual({
      message: "Imported 3 new and 2 updated · 20 already matched",
      tone: "settled",
    });
  });

  it("reports created alone without an 'and'", () => {
    expect(applySummary({ created: 3, updated: 0, unchanged: 0, failed: 0 })).toEqual({
      message: "Imported 3 new",
      tone: "settled",
    });
  });

  it("appends failures and switches tone to fault, even on an otherwise happy import", () => {
    expect(applySummary({ created: 0, updated: 0, unchanged: 24, failed: 1 })).toEqual({
      message: "24 rows already matched — nothing needed changing — 1 failed, refresh and re-check",
      tone: "fault",
    });
  });
});
