import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOAN_DAYS, RETURN_OUTCOMES, RETURN_OUTCOME_STATUS, TRIAGE_OUTCOMES,
  defaultLoanDue, humanizeGuard, loanDueFor, minLoanDue, reasonRequiredFor, replacePlan,
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

describe("humanizeGuard", () => {
  it("strips the worker's 'Execution guard: ' prefix and the trailing refusal tag", () => {
    expect(humanizeGuard("Execution guard: target employee no longer exists — assignment refused"))
      .toBe("target employee no longer exists");
  });
  it("rewrites the request-a-return sentence for a reader who isn't the worker", () => {
    expect(humanizeGuard("Execution guard: BR-LT-0201 is still assigned — request a lifecycle.return first, then change its status"))
      .toBe("BR-LT-0201 is still assigned — return it first, then change its status");
  });
  it("drops the return-refused tag", () => {
    expect(humanizeGuard("Execution guard: BR-LT-0201 is not held by anyone — return refused"))
      .toBe("BR-LT-0201 is not held by anyone");
  });
  it("passes through text that isn't a worker guard unchanged", () => {
    expect(humanizeGuard("Already DEPLOYED.")).toBe("Already DEPLOYED.");
  });
});

describe("loanDueFor (Phase 16 §4.2)", () => {
  const today = new Date("2026-09-07T10:00:00Z");
  it("DEPLOYED ignores any date and stores null", () => {
    expect(loanDueFor("DEPLOYED", "2026-10-01", today)).toEqual({ ok: true, value: null });
  });
  it("TEMPORARY needs a date", () => {
    expect(loanDueFor("TEMPORARY", undefined, today)).toEqual({ ok: false, error: "A loan needs a due date." });
    expect(loanDueFor("TEMPORARY", "", today)).toEqual({ ok: false, error: "A loan needs a due date." });
  });
  it("TEMPORARY accepts today or later, refuses the past", () => {
    expect(loanDueFor("TEMPORARY", "2026-09-07", today)).toEqual({ ok: true, value: new Date("2026-09-07T00:00:00Z") });
    expect(loanDueFor("TEMPORARY", "2026-09-06", today).ok).toBe(false);
  });
  it("the default loan is 30 days", () => expect(DEFAULT_LOAN_DAYS).toBe(30));
});

describe("defaultLoanDue", () => {
  it("is DEFAULT_LOAN_DAYS out from today, UTC", () => {
    expect(defaultLoanDue(new Date("2026-09-07T10:00:00Z"))).toBe("2026-10-07");
  });
});

describe("minLoanDue", () => {
  it("is the UTC day after today", () => {
    expect(minLoanDue(new Date("2026-09-07T23:30:00Z"))).toBe("2026-09-08");
  });
  it("rolls over the year boundary", () => {
    expect(minLoanDue(new Date("2026-12-31T10:00:00Z"))).toBe("2027-01-01");
  });
});
