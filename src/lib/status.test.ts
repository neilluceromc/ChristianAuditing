import { describe, expect, it } from "vitest";
import { statusFamily, isSystemFailure, STATUS_FAMILIES } from "./status";

describe("statusFamily", () => {
  const cases: Array<[string, string]> = [
    // Asset status (8 — MISSING is the approved schema extension for the offboarding wizard)
    ["DEPLOYED", "settled"], ["SPARE", "neutral"], ["DEFECTIVE", "fault"], ["MISSING", "fault"],
    ["DONATED", "closed"], ["TEMPORARY", "attention"], ["BUYOUT", "closed"], ["DISPOSE", "closed"],
    // Purchase request state (5)
    ["DRAFT", "neutral"], ["SUBMITTED", "inflight"], ["IT_REVIEWED", "inflight"],
    ["COMPLETED", "settled"], ["CANCELLED", "closed"],
    // Purchase unit / approval shared values
    ["PENDING", "attention"], ["APPROVED", "settled"], ["REJECTED", "fault"],
    // Approval-specific
    ["CLAIMED", "inflight"], ["EXECUTED", "settled"], ["EXECUTION_FAILED", "fault"],
    // Reservation (4)
    ["ACTIVE", "inflight"], ["FULFILLED", "settled"], ["RELEASED", "closed"], ["EXPIRED", "closed"],
    // M365 (lowercase — case-sensitive on purpose: reservation ACTIVE is inflight, M365 active is settled)
    ["pending", "attention"], ["active", "settled"], ["offboarding", "inflight"], ["inactive", "closed"],
  ];

  it.each(cases)("%s → %s", (value, family) => {
    expect(statusFamily(value)).toBe(family);
  });

  it("maps unknown/custom values to neutral", () => {
    expect(statusFamily("contractor")).toBe("neutral");
    expect(statusFamily("")).toBe("neutral");
    expect(statusFamily("SOMETHING_NEW")).toBe("neutral");
  });

  it("flags EXECUTION_FAILED as a system failure (dashed diamond treatment)", () => {
    expect(isSystemFailure("EXECUTION_FAILED")).toBe(true);
    expect(isSystemFailure("REJECTED")).toBe(false);
  });

  it("exports exactly six families", () => {
    expect(STATUS_FAMILIES).toEqual(["neutral", "inflight", "settled", "attention", "fault", "closed"]);
  });
});
