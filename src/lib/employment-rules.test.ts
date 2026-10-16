import { describe, expect, it } from "vitest";
import { EMPLOYMENT_CHANGE_REFUSAL, employmentChangeAllowed } from "./employment-rules";

describe("employmentChangeAllowed — employment moves only through offboarding (Phase 40 spec 2.2)", () => {
  it("allows a re-send of the same value (an edit that leaves employment alone)", () => {
    expect(employmentChangeAllowed("ACTIVE", "ACTIVE")).toBe(true);
    expect(employmentChangeAllowed("OFFBOARDING", "OFFBOARDING")).toBe(true);
    expect(employmentChangeAllowed("OFFBOARDED", "OFFBOARDED")).toBe(true);
  });
  it("allows cancelling an offboarding", () => {
    expect(employmentChangeAllowed("OFFBOARDING", "ACTIVE")).toBe(true);
  });
  it("refuses starting an offboarding by edit — the Start offboarding dialog does that", () => {
    expect(employmentChangeAllowed("ACTIVE", "OFFBOARDING")).toBe(false);
  });
  it("refuses marking someone offboarded by edit — only completeOffboarding does that", () => {
    expect(employmentChangeAllowed("ACTIVE", "OFFBOARDED")).toBe(false);
    expect(employmentChangeAllowed("OFFBOARDING", "OFFBOARDED")).toBe(false);
  });
  it("refuses bringing an offboarded person back by edit", () => {
    expect(employmentChangeAllowed("OFFBOARDED", "ACTIVE")).toBe(false);
    expect(employmentChangeAllowed("OFFBOARDED", "OFFBOARDING")).toBe(false);
  });
  it("carries the spec's refusal sentence verbatim", () => {
    expect(EMPLOYMENT_CHANGE_REFUSAL).toBe("Use Start offboarding — leavers go through the offboarding wizard");
  });
});
