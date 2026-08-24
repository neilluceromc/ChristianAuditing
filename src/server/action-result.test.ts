import { describe, expect, it } from "vitest";
import { rateLimited } from "./action-result";

describe("rateLimited", () => {
  it("keeps the default 60/min message for every caller that doesn't override it", () => {
    const r = rateLimited(30);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toBe(
        "You've made 60 changes this minute — the cap. Nothing was lost: this form still holds your input.",
      );
      expect(r.retryAfterSec).toBe(30);
    }
  });

  // R-2 (round 2): the dry-run stage's cap is 10 (not 60), it wrote nothing
  // (not "changes"), and a file input isn't repopulated by any browser (not
  // "this form still holds your input") — three false claims in the
  // default sentence on that one path, so it needs its own.
  it("uses the override message when one is given, verbatim", () => {
    const r = rateLimited(12, "You've checked 60 files this minute — the cap.");
    if (!r.ok) expect(r.message).toBe("You've checked 60 files this minute — the cap.");
  });
});
