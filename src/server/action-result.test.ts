import { afterEach, describe, expect, it } from "vitest";
import { forbidden, PASSWORD_OWED_COPY, rateLimited, setForbiddenReasonProbe } from "./action-result";

describe("forbidden (Users & access spec §4.3)", () => {
  afterEach(() => setForbiddenReasonProbe(() => null));

  it("keeps the default sentence and carries no reason", () => {
    expect(forbidden()).toEqual({ ok: false, kind: "forbidden", message: "You don't have permission to do that." });
  });

  it("a password still owed reads \"Choose your own password first\"", () => {
    expect(PASSWORD_OWED_COPY).toBe("Choose your own password first");
    expect(forbidden("password_owed")).toEqual({
      ok: false, kind: "forbidden", reason: "password_owed", message: "Choose your own password first",
    });
  });

  it("an existing bare forbidden() call takes the request's reason from the probe the guards install", () => {
    setForbiddenReasonProbe(() => "password_owed");
    expect(forbidden()).toMatchObject({ reason: "password_owed", message: PASSWORD_OWED_COPY });
  });
});

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
