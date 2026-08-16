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
    // prototype-chain keys must not leak Function values into CSS var names
    expect(statusFamily("constructor")).toBe("neutral");
    expect(statusFamily("toString")).toBe("neutral");
    expect(statusFamily("__proto__")).toBe("neutral");
  });

  it("flags EXECUTION_FAILED as a system failure (dashed diamond treatment)", () => {
    expect(isSystemFailure("EXECUTION_FAILED")).toBe(true);
    expect(isSystemFailure("REJECTED")).toBe(false);
  });

  it("exports exactly six families", () => {
    expect(STATUS_FAMILIES).toEqual(["neutral", "inflight", "settled", "attention", "fault", "closed"]);
  });
});

describe("employment namespace (entry criterion #2)", () => {
  it("employment ACTIVE is settled — the person is in the right state", () => {
    expect(statusFamily("ACTIVE", "employment")).toBe("settled");
  });
  it("reservation ACTIVE stays inflight (no namespace)", () => {
    expect(statusFamily("ACTIVE")).toBe("inflight");
  });
  it("OFFBOARDING is inflight, OFFBOARDED is closed", () => {
    expect(statusFamily("OFFBOARDING", "employment")).toBe("inflight");
    expect(statusFamily("OFFBOARDED", "employment")).toBe("closed");
  });
  it("unknown employment values map to neutral, not the flat map", () => {
    expect(statusFamily("SUBMITTED", "employment")).toBe("neutral");
  });
});
