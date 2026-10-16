import { describe, expect, it } from "vitest";
import {
  EMPLOYEE_CHANGED, EMPLOYMENT_CHANGE_REFUSAL, editEmploymentTarget, employmentChangeAllowed, employmentGuard,
} from "./employment-rules";

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

describe("editEmploymentTarget — what updateEmployee writes for employment (final review I1, M10)", () => {
  it("keeps the stored value when the Edit form sends no employment (the select was not shown)", () => {
    expect(editEmploymentTarget("OFFBOARDING", undefined)).toEqual({ ok: true, target: "OFFBOARDING" });
    expect(editEmploymentTarget("ACTIVE", undefined)).toEqual({ ok: true, target: "ACTIVE" });
    expect(editEmploymentTarget("OFFBOARDED", undefined)).toEqual({ ok: true, target: "OFFBOARDED" });
  });
  it("lets a leaver's select cancel the offboarding", () => {
    expect(editEmploymentTarget("OFFBOARDING", "ACTIVE")).toEqual({ ok: true, target: "ACTIVE" });
  });
  it("refuses any other move with the spec's sentence, under the employment field", () => {
    expect(editEmploymentTarget("ACTIVE", "OFFBOARDING")).toEqual({ ok: false, field: "employment", message: EMPLOYMENT_CHANGE_REFUSAL });
    expect(editEmploymentTarget("ACTIVE", "OFFBOARDED")).toEqual({ ok: false, field: "employment", message: EMPLOYMENT_CHANGE_REFUSAL });
    expect(editEmploymentTarget("OFFBOARDING", "OFFBOARDED")).toEqual({ ok: false, field: "employment", message: EMPLOYMENT_CHANGE_REFUSAL });
    expect(editEmploymentTarget("OFFBOARDED", "ACTIVE")).toEqual({ ok: false, field: "employment", message: EMPLOYMENT_CHANGE_REFUSAL });
  });
});

describe("employmentGuard — the state guard on updateEmployee's write (final review I1)", () => {
  it("matches only the employment the edit was read with", () => {
    expect(employmentGuard("e1", "OFFBOARDING")).toEqual({ id: "e1", employment: "OFFBOARDING" });
  });
  it("names the reload conflict in plain words", () => {
    expect(EMPLOYEE_CHANGED).toBe("That person changed — reload and try again");
  });
});
