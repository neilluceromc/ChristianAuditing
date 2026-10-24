import { describe, expect, it } from "vitest";
import { PASSWORD_COPY, passwordChecks, passwordProblem } from "./password-rules";

/* Users & access (spec §4.3): one set of rules for any new password, on the server and in the live checklist. */

describe("passwordChecks", () => {
  it("a long, letters-only password fails `mixed`", () => {
    expect(passwordChecks("abcdefghij", {})).toEqual({ long: true, mixed: false, fresh: true });
  });

  it("letters and a number, 10 long, passes all", () => {
    expect(passwordChecks("abcdefghi1", {})).toEqual({ long: true, mixed: true, fresh: true });
  });

  it("digits only fail `mixed`", () => {
    expect(passwordChecks("0123456789", {}).mixed).toBe(false);
  });

  it("9 characters fail `long`", () => {
    expect(passwordChecks("abcdefgh1", {}).long).toBe(false);
  });

  it("equal to the current password fails `fresh`", () => {
    expect(passwordChecks("abcdefghi1", { current: "abcdefghi1" }).fresh).toBe(false);
    expect(passwordChecks("abcdefghi2", { current: "abcdefghi1" }).fresh).toBe(true);
  });

  it("equal to the temporary password fails `fresh`", () => {
    expect(passwordChecks("Harbor-4207-cedar", { temporary: "Harbor-4207-cedar" }).fresh).toBe(false);
  });

  it("an empty password ticks nothing", () => {
    expect(passwordChecks("", {})).toEqual({ long: false, mixed: false, fresh: false });
  });
});

describe("passwordProblem", () => {
  it("is null for a good password", () => {
    expect(passwordProblem("abcdefghi1", { current: "something-else-1" })).toBeNull();
  });

  it("reports the first rule broken, in checklist order", () => {
    expect(passwordProblem("abc", {})).toBe(PASSWORD_COPY.long);
    expect(passwordProblem("abcdefghij", {})).toBe(PASSWORD_COPY.mixed);
    expect(passwordProblem("abcdefghi1", { current: "abcdefghi1" })).toBe(PASSWORD_COPY.sameAsCurrent);
    expect(passwordProblem("Harbor-4207-cedar", { temporary: "Harbor-4207-cedar" })).toBe(PASSWORD_COPY.sameAsTemporary);
  });

  it("keeps sign-up's length sentence", () => {
    expect(PASSWORD_COPY.long).toBe("Password must be at least 10 characters.");
  });
});
