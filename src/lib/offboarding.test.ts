import { describe, expect, it } from "vitest";
import { RETURN_STATUSES } from "./approval-execution";
import {
  OUTCOMES, OUTCOME_LABEL, OUTCOME_STATUS, WIZARD_STEPS, canContinue, decisionOf, outcomeOfStatus,
  parseStep, reasonRequired, reportTotals, returnTargetStatus,
  type DecisionCandidate, type Outcome,
} from "./offboarding";

describe("outcomes — Missing is first-class", () => {
  it("offers exactly the four the design names, in order", () => {
    expect(OUTCOMES).toEqual(["RETURNED", "DEFECTIVE", "BUYOUT", "MISSING"]);
    expect(OUTCOME_LABEL.MISSING).toBe("Missing");
  });

  it("maps each outcome to the asset status the worker will apply", () => {
    expect(OUTCOME_STATUS).toEqual({
      RETURNED: "SPARE", DEFECTIVE: "DEFECTIVE", BUYOUT: "BUYOUT", MISSING: "MISSING",
    });
  });

  it("agrees with the executor about what a return may become", () => {
    // Two copies of one truth: this map is what the wizard WRITES, RETURN_STATUSES
    // is what executionPlan will ACCEPT. If they ever drift, every decision of the
    // orphaned outcome becomes EXECUTION_FAILED — which is the exact bug Task 1
    // existed to fix. (Raised by the Task 1 code review.)
    expect(new Set(Object.values(OUTCOME_STATUS))).toEqual(new Set(RETURN_STATUSES));
  });

  it("requires a reason for everything except a clean return", () => {
    expect(reasonRequired("RETURNED")).toBe(false);
    for (const o of ["DEFECTIVE", "BUYOUT", "MISSING"] as Outcome[]) {
      expect(reasonRequired(o)).toBe(true);
    }
  });
});

describe("the four steps", () => {
  it("names them in order", () => {
    expect(WIZARD_STEPS.map((s) => s.id)).toEqual(["review", "collect", "accounts", "report"]);
    expect(WIZARD_STEPS[3].label).toBe("Farewell report");
  });

  it("parses ?step= and falls back to the first step", () => {
    expect(parseStep("collect")).toBe("collect");
    expect(parseStep(null)).toBe("review");
    expect(parseStep("nonsense")).toBe("review");
    expect(parseStep("REVIEW")).toBe("review"); // case-sensitive contract, no silent coercion
  });
});

describe("canContinue — undecided is not the same as returned", () => {
  it("blocks leaving Collect while any item is undecided", () => {
    expect(canContinue("collect", { undecided: 2 })).toBe(false);
    expect(canContinue("collect", { undecided: 0 })).toBe(true);
  });
  it("never blocks the steps that aren't about items", () => {
    for (const step of ["review", "accounts", "report"] as const) {
      expect(canContinue(step, { undecided: 5 })).toBe(true);
    }
  });
});

describe("reportTotals — what the receipt claims", () => {
  const items = [
    { outcome: "RETURNED" as Outcome, cost: 55_000 },
    { outcome: "DEFECTIVE" as Outcome, cost: 12_000 },
    { outcome: "BUYOUT" as Outcome, cost: 30_000 },
    { outcome: "MISSING" as Outcome, cost: 18_000 },
    { outcome: "RETURNED" as Outcome, cost: null },
  ];

  it("counts kit that came back as recovered, and says so separately from money in and value lost", () => {
    const t = reportTotals(items);
    expect(t.recovered).toBe(67_000); // returned + defective — both are back in the fleet
    expect(t.boughtOut).toBe(30_000); // the employee paid for it
    expect(t.lost).toBe(18_000);      // missing is a loss, not a recovery
  });

  it("counts every item even when its cost is unknown", () => {
    const t = reportTotals(items);
    expect(t.counts.RETURNED).toBe(2);
    expect(t.counts.MISSING).toBe(1);
    expect(t.total).toBe(5);
  });

  it("is all zeros for nothing held", () => {
    expect(reportTotals([])).toEqual({
      recovered: 0, boughtOut: 0, lost: 0, total: 0,
      counts: { RETURNED: 0, DEFECTIVE: 0, BUYOUT: 0, MISSING: 0 },
    });
  });
});

describe("reading a decision back out of a payload", () => {
  it("maps a payload's target status back to its outcome", () => {
    expect(outcomeOfStatus("SPARE")).toBe("RETURNED");
    expect(outcomeOfStatus("DEFECTIVE")).toBe("DEFECTIVE");
    expect(outcomeOfStatus("BUYOUT")).toBe("BUYOUT");
    expect(outcomeOfStatus("MISSING")).toBe("MISSING");
  });

  it("refuses statuses that aren't offboarding outcomes", () => {
    expect(outcomeOfStatus("DEPLOYED")).toBeNull();
    expect(outcomeOfStatus("")).toBeNull();
    expect(outcomeOfStatus(null)).toBeNull();
  });

  it("digs to.status out of a payload without trusting its shape", () => {
    expect(returnTargetStatus({ to: { status: "MISSING" } })).toBe("MISSING");
    expect(returnTargetStatus({ to: { status: 7 } })).toBeNull();
    // the seeded APR-2040 shape: a return with no target at all
    expect(returnTargetStatus({ reason: "offboarding" })).toBeNull();
    expect(returnTargetStatus({ to: null })).toBeNull();
    expect(returnTargetStatus(null)).toBeNull();
    expect(returnTargetStatus("nope")).toBeNull();
  });
});

describe("decisionOf — decided is derived, and REJECTED re-opens the item", () => {
  const at = (ms: number) => new Date(1_760_000_000_000 + ms);
  const cand = (over: Partial<DecisionCandidate> = {}): DecisionCandidate => ({
    id: "a1", refNo: "APR-2100", state: "PENDING", toStatus: "SPARE",
    reason: null, createdAt: at(0), ...over,
  });

  it("is null when nothing has been decided", () => {
    expect(decisionOf([])).toBeNull();
  });

  it("reports the outcome, ref, state and reason of a live decision", () => {
    expect(decisionOf([cand({ toStatus: "MISSING", state: "CLAIMED", reason: "never handed back" })])).toEqual({
      refNo: "APR-2100", outcome: "MISSING", state: "CLAIMED", reason: "never handed back",
    });
  });

  it("counts every non-rejected state as decided — EXECUTION_FAILED included", () => {
    for (const state of ["PENDING", "CLAIMED", "APPROVED", "EXECUTED", "EXECUTION_FAILED"]) {
      expect(decisionOf([cand({ state })])?.state).toBe(state);
    }
  });

  it("ignores a REJECTED return — that item is open for a new decision", () => {
    expect(decisionOf([cand({ state: "REJECTED" })])).toBeNull();
  });

  it("after a rejection, the newer decision wins", () => {
    expect(decisionOf([
      cand({ id: "old", refNo: "APR-2100", state: "REJECTED", createdAt: at(0) }),
      cand({ id: "new", refNo: "APR-2101", state: "PENDING", toStatus: "BUYOUT", createdAt: at(5_000) }),
    ])).toEqual({ refNo: "APR-2101", outcome: "BUYOUT", state: "PENDING", reason: null });
  });

  it("ignores an approval whose payload names no outcome (the seeded APR-2040 shape)", () => {
    expect(decisionOf([cand({ toStatus: null })])).toBeNull();
  });

  it("breaks a same-millisecond tie by id, so two reads never disagree", () => {
    const rows = [
      cand({ id: "aaa", refNo: "APR-2100", toStatus: "SPARE", createdAt: at(0) }),
      cand({ id: "zzz", refNo: "APR-2101", toStatus: "MISSING", createdAt: at(0) }),
    ];
    expect(decisionOf(rows)?.refNo).toBe("APR-2101");
    expect(decisionOf([...rows].reverse())?.refNo).toBe("APR-2101");
  });
});
