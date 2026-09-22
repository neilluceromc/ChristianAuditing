import { describe, expect, it } from "vitest";
import { rateDecision, RATE_LIMITS } from "./rate-limit";

const now = new Date("2026-08-16T10:00:00Z");
const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);

describe("rateDecision", () => {
  it("allows while fewer than the limit exist in the window", () => {
    const recent = Array.from({ length: RATE_LIMITS.mutation.limit - 1 }, (_, i) => secondsAgo(i));
    expect(rateDecision(recent, "mutation", now)).toEqual({ allowed: true });
  });
  it("blocks at the limit and reports when the window frees up", () => {
    // 60 events, newest first; the 60th-newest is 30s old → frees in 30s.
    const recent = Array.from({ length: 60 }, (_, i) => secondsAgo(i * 0.5));
    const d = rateDecision(recent, "mutation", now);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.retryAfterSec).toBe(31); // ceil(30.5s remaining)
  });
  it("retryAfterSec is never below 1", () => {
    const recent = Array.from({ length: 60 }, () => secondsAgo(59.999));
    const d = rateDecision(recent, "mutation", now);
    if (!d.allowed) expect(d.retryAfterSec).toBeGreaterThanOrEqual(1);
  });
  it("import kind uses the 10/min budget", () => {
    const recent = Array.from({ length: 10 }, (_, i) => secondsAgo(i));
    expect(rateDecision(recent, "import", now).allowed).toBe(false);
  });

  // R-2 (round 2): the read-only dry-run stage gets its OWN kind, at the
  // mutation budget (60/min) rather than the write's 10.
  //
  // The count here has to sit STRICTLY BETWEEN the two budgets or the test
  // proves nothing — the first version used 9 and 60, and 9 is allowed under
  // both 10 and 60 while 60 is refused under both, so it passed identically
  // with `import_plan` set to 10. That is §6a rule 67's shape, in a test
  // written to prove a budget: 30 is allowed at 60 and refused at 10, so it
  // can only pass under the budget it names.
  // Phase 29 (final review I-4): the read-only form checks (taken number, next
  // free, policy preview, same-name) get their own, far larger budget so a
  // data-entry burst cannot spend the create button's 60. Same shape as the
  // import_plan case above: 240 is the boundary, and the counts are chosen so
  // the test can only pass under the budget it names — 100 is allowed at 240
  // and refused at 60.
  it("check kind allows the 240th event and refuses the 241st", () => {
    // 239 already in the window → the 240th is allowed; one more and it is not.
    const before = Array.from({ length: 239 }, (_, i) => secondsAgo(i * 0.25));
    expect(rateDecision(before, "check", now)).toEqual({ allowed: true });
    const atCap = Array.from({ length: 240 }, (_, i) => secondsAgo(i * 0.25));
    expect(rateDecision(atCap, "check", now).allowed).toBe(false);
    // …and it is a budget of its own: 100 checks a minute is fine here and
    // would already be refused on the mutation kind.
    const hundred = Array.from({ length: 100 }, (_, i) => secondsAgo(i * 0.25));
    expect(rateDecision(hundred, "check", now).allowed).toBe(true);
    expect(rateDecision(hundred, "mutation", now).allowed).toBe(false);
  });
  it("import_plan kind uses its own 60/min budget, not the write's 10/min", () => {
    const thirtyRecent = Array.from({ length: 30 }, (_, i) => secondsAgo(i));
    expect(rateDecision(thirtyRecent, "import_plan", now).allowed).toBe(true);
    expect(rateDecision(thirtyRecent, "import", now).allowed).toBe(false);
    const sixtyRecent = Array.from({ length: 60 }, (_, i) => secondsAgo(i * 0.5));
    expect(rateDecision(sixtyRecent, "import_plan", now).allowed).toBe(false);
  });
});
