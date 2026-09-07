import { describe, expect, it } from "vitest";
import {
  RETURN_OUTCOMES, RETURN_OUTCOME_STATUS, TRIAGE_OUTCOMES, reasonRequiredFor, replacePlan,
} from "./lifecycle";
import { RETURN_TARGETS } from "./asset-class";

describe("return outcomes", () => {
  it("map exactly onto RETURN_TARGETS.IT", () => {
    expect([...RETURN_OUTCOMES].map((o) => RETURN_OUTCOME_STATUS[o]).sort()).toEqual([...RETURN_TARGETS.IT].sort());
  });
  it("only MISSING requires a reason", () => {
    expect(RETURN_OUTCOMES.filter(reasonRequiredFor)).toEqual(["MISSING"]);
  });
  it("triage outcomes are the four dispositions", () => {
    expect(TRIAGE_OUTCOMES).toEqual(["SPARE", "DEFECTIVE", "DISPOSE", "DONATED"]);
  });
});

describe("replacePlan", () => {
  it("retires the old device by outcome and gives the new one the old holder status", () => {
    expect(replacePlan({ status: "DEPLOYED" }, "TRIAGE")).toEqual({ oldStatus: "SPARE", newStatus: "DEPLOYED" });
    expect(replacePlan({ status: "TEMPORARY" }, "DEFECTIVE")).toEqual({ oldStatus: "DEFECTIVE", newStatus: "TEMPORARY" });
    expect(replacePlan({ status: "DEPLOYED" }, "MISSING")).toEqual({ oldStatus: "MISSING", newStatus: "DEPLOYED" });
  });
  it("a device that is not held cannot be replaced", () => {
    expect(() => replacePlan({ status: "SPARE" }, "TRIAGE")).toThrow(/not held/);
  });
});
