import { describe, expect, it } from "vitest";
import { RETURN_TARGETS } from "./asset-class";
import {
  OUTCOMES, OUTCOME_LABEL, OUTCOME_STATUS_BY_CLASS, WIZARD_STEPS, canContinue, decisionOf,
  outcomeOfStatus, outcomeStatus, outcomesFor,
  parseStep, reasonRequired, reportTotals, returnTargetStatus,
  type DecisionCandidate, type Outcome,
  completionBlockers, decisionStateLabel, defaultStep, m365Live, offboardingAttention, offboardingNext,
  orderByOffboardingAttention, readiness, type LeaverState,
} from "./offboarding";

describe("outcomes — Missing is first-class", () => {
  it("offers exactly the four the design names, in order", () => {
    expect(OUTCOMES).toEqual(["RETURNED", "DEFECTIVE", "BUYOUT", "MISSING"]);
    expect(OUTCOME_LABEL.MISSING).toBe("Missing");
  });

  it("maps each outcome to the asset status the worker will apply", () => {
    expect(OUTCOME_STATUS_BY_CLASS.IT).toEqual({
      RETURNED: "SPARE", DEFECTIVE: "DEFECTIVE", BUYOUT: "BUYOUT", MISSING: "MISSING",
    });
  });

  it("agrees with the executor about what a return may become", () => {
    // Two copies of one truth: this map is what the wizard WRITES, RETURN_TARGETS
    // is what executionPlan will ACCEPT. If they ever drift, every decision of the
    // orphaned outcome becomes EXECUTION_FAILED — which is the exact bug Task 1
    // existed to fix. (Raised by the Task 1 code review.)
    expect(new Set(Object.values(OUTCOME_STATUS_BY_CLASS.IT))).toEqual(new Set(RETURN_TARGETS.IT));
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
    expect(WIZARD_STEPS[3].label).toBe("Finish");
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
    expect(decisionOf([], { held: true })).toBeNull();
  });

  it("reports the outcome, ref, state, reason and stored target of a live decision", () => {
    expect(decisionOf([cand({ toStatus: "MISSING", state: "CLAIMED", reason: "never handed back" })], { held: true })).toEqual({
      id: "a1", refNo: "APR-2100", outcome: "MISSING", state: "CLAIMED", reason: "never handed back", toStatus: "MISSING",
      decidedBy: null, decidedAt: null,
    });
  });

  it("counts every non-rejected state as decided once the item has left their name", () => {
    for (const state of ["PENDING", "CLAIMED", "APPROVED", "EXECUTED", "EXECUTION_FAILED"]) {
      expect(decisionOf([cand({ state })], { held: false })?.state).toBe(state);
    }
  });

  it("ignores an EXECUTED return on an item they hold again — that one decided an earlier holding", () => {
    // executionPlan always clears the holder, so an EXECUTED return means the
    // asset left their name; holding it now means it came back afterwards. Left
    // in, a laptop returned once and later reassigned would read "decided"
    // forever and the wizard would complete with it still assigned.
    expect(decisionOf([cand({ state: "EXECUTED" })], { held: true })).toBeNull();
    // EXECUTION_FAILED never moved the asset, so while held it still decides
    for (const state of ["PENDING", "CLAIMED", "APPROVED", "EXECUTION_FAILED"]) {
      expect(decisionOf([cand({ state })], { held: true })?.state).toBe(state);
    }
  });

  it("a stale EXECUTION_FAILED from a previous holding does not decide this one", () => {
    // R1 failed transiently and nobody retried or rejected it; R2 was requested
    // later and executed, ending that holding; the asset came back afterwards.
    // Only what was created after the newest EXECUTED return belongs here.
    expect(decisionOf([
      cand({ id: "r1", refNo: "APR-2100", state: "EXECUTION_FAILED", createdAt: at(1_000) }),
      cand({ id: "r2", refNo: "APR-2101", state: "EXECUTED", createdAt: at(2_000) }),
    ], { held: true })).toBeNull();
  });

  it("a decision made after the last EXECUTED return is this holding's", () => {
    // the boundary must not eat the decision the operator just made
    expect(decisionOf([
      cand({ id: "r2", refNo: "APR-2101", state: "EXECUTED", createdAt: at(2_000) }),
      cand({ id: "r3", refNo: "APR-2102", state: "PENDING", toStatus: "MISSING", createdAt: at(3_000) }),
    ], { held: true })).toMatchObject({ refNo: "APR-2102", outcome: "MISSING" });
  });

  it("ignores a REJECTED return — that item is open for a new decision", () => {
    expect(decisionOf([cand({ state: "REJECTED" })], { held: true })).toBeNull();
  });

  it("ignores a live return whose target is a real asset status but not an outcome", () => {
    expect(decisionOf([cand({ toStatus: "DEPLOYED" })], { held: true })).toBeNull();
  });

  it("after a rejection, the newer decision wins", () => {
    expect(decisionOf([
      cand({ id: "old", refNo: "APR-2100", state: "REJECTED", createdAt: at(0) }),
      cand({ id: "new", refNo: "APR-2101", state: "PENDING", toStatus: "BUYOUT", createdAt: at(5_000) }),
    ], { held: true })).toEqual({
      id: "new", refNo: "APR-2101", outcome: "BUYOUT", state: "PENDING", reason: null, toStatus: "BUYOUT",
      decidedBy: null, decidedAt: null,
    });
  });

  it("the newest decision wins even when the older one is also live", () => {
    // the rejection case above cannot pin the sort direction — its older row is
    // filtered out either way. This one has two survivors to order.
    expect(decisionOf([
      cand({ id: "old", refNo: "APR-2100", state: "EXECUTION_FAILED", toStatus: "SPARE", createdAt: at(0) }),
      cand({ id: "new", refNo: "APR-2101", state: "PENDING", toStatus: "MISSING", createdAt: at(5_000) }),
    ], { held: true })).toMatchObject({ refNo: "APR-2101", outcome: "MISSING" });
  });

  it("a newer REJECTED row does not re-open an item whose older decision is still live", () => {
    // Deliberate: a rejection re-opens the item, EXCEPT where an earlier
    // retryable decision survives — that one can still be retried into effect.
    expect(decisionOf([
      cand({ id: "old", refNo: "APR-2100", state: "EXECUTION_FAILED", createdAt: at(0) }),
      cand({ id: "new", refNo: "APR-2101", state: "REJECTED", createdAt: at(5_000) }),
    ], { held: true })?.refNo).toBe("APR-2100");
  });

  it("ignores an approval whose payload names no outcome (the seeded APR-2040 shape)", () => {
    expect(decisionOf([cand({ toStatus: null })], { held: true })).toBeNull();
  });

  it("a REJECTED row with no target trips both filters and still decides nothing", () => {
    expect(decisionOf([cand({ state: "REJECTED", toStatus: null })], { held: true })).toBeNull();
  });

  it("breaks a same-millisecond tie by id, so two reads never disagree", () => {
    const rows = [
      cand({ id: "aaa", refNo: "APR-2100", toStatus: "SPARE", createdAt: at(0) }),
      cand({ id: "zzz", refNo: "APR-2101", toStatus: "MISSING", createdAt: at(0) }),
    ];
    expect(decisionOf(rows, { held: true })?.refNo).toBe("APR-2101");
    expect(decisionOf([...rows].reverse(), { held: true })?.refNo).toBe("APR-2101");
  });

  // Phase 20 (spec §4.1): attribution rides on the winning candidate, copied
  // straight across — decisionOf does not re-derive who decided or when.
  describe("attribution (decidedBy / decidedAt)", () => {
    it("carries the claimer and resolved time of an EXECUTED winner", () => {
      const resolvedAt = at(9_000);
      expect(decisionOf(
        [cand({ state: "EXECUTED", decidedBy: "A. Reyes", decidedAt: resolvedAt })],
        { held: false },
      )).toMatchObject({ decidedBy: "A. Reyes", decidedAt: resolvedAt });
    });

    it("is both null for a PENDING winner with no claimer yet", () => {
      expect(decisionOf([cand({ state: "PENDING" })], { held: false }))
        .toMatchObject({ decidedBy: null, decidedAt: null });
    });

    // A DecisionCandidate that never mentions decidedBy/decidedAt at all
    // (every candidate built before Phase 20) must still resolve to a real
    // Decision with both fields null, never undefined.
    it("defaults to null, not undefined, when the candidate carries neither field", () => {
      const decision = decisionOf([cand({ state: "CLAIMED" })], { held: false });
      expect(decision?.decidedBy).toBeNull();
      expect(decision?.decidedAt).toBeNull();
      expect(decision).toHaveProperty("decidedBy");
      expect(decision).toHaveProperty("decidedAt");
    });
  });
});

describe("outcomes by class (Phase 13)", () => {
  it("Purchasing offers Returned / Defective / Missing — Buyout does not exist for a company car", () => {
    expect(outcomesFor("PURCHASING")).toEqual(["RETURNED", "DEFECTIVE", "MISSING"]);
    expect(outcomesFor("IT")).toEqual(OUTCOMES);
  });
  it("Purchasing outcomes land on Purchasing statuses", () => {
    expect(outcomeStatus("PURCHASING", "RETURNED")).toBe("STORED");
    expect(outcomeStatus("PURCHASING", "DEFECTIVE")).toBe("REPAIRING");
    expect(outcomeStatus("PURCHASING", "MISSING")).toBe("LOST");
    expect(outcomeStatus("PURCHASING", "BUYOUT")).toBeNull();
    expect(outcomeStatus("IT", "BUYOUT")).toBe("BUYOUT");
  });
  it("every class's outcome map is exactly that class's return targets — no orphan and no extra", () => {
    // Set equality, not subset: a fourth Purchasing return target the wizard
    // could never produce should fail this test, as it already would for IT.
    for (const cls of ["IT", "PURCHASING"] as const) {
      expect(new Set(Object.values(OUTCOME_STATUS_BY_CLASS[cls]))).toEqual(new Set(RETURN_TARGETS[cls]));
    }
  });
  it("outcomeOfStatus reads both vocabularies", () => {
    expect(outcomeOfStatus("SPARE")).toBe("RETURNED");
    expect(outcomeOfStatus("STORED")).toBe("RETURNED");
    expect(outcomeOfStatus("LOST")).toBe("MISSING");
    expect(outcomeOfStatus("REPAIRING")).toBe("DEFECTIVE"); // the one Purchasing status whose outcome name differs
    expect(outcomeOfStatus("DEPLOYED")).toBeNull();
  });
});

const leaver = (over: Partial<LeaverState> = {}): LeaverState => ({
  id: "e1", employment: "OFFBOARDING", dueAt: new Date("2026-09-30T00:00:00+08:00"),
  undecided: 0, failed: null, m365Status: "inactive", ...over,
});

describe("m365Live — mirrors completeOffboarding's M365 gate", () => {
  it("null and any-case inactive are not live; everything else is", () => {
    expect(m365Live(null)).toBe(false);
    expect(m365Live("inactive")).toBe(false);
    expect(m365Live(" Inactive ")).toBe(false);
    expect(m365Live("active")).toBe(true);
    expect(m365Live("offboarding")).toBe(true);
    expect(m365Live("")).toBe(true);
  });
});

describe("offboardingNext — the one next step", () => {
  it("nothing once offboarded", () => {
    expect(offboardingNext(leaver({ employment: "OFFBOARDED" }))).toBeNull();
  });
  it("a failed return wins over everything", () => {
    expect(offboardingNext(leaver({ failed: { refNo: "APR-9", approvalId: "a9" }, dueAt: null, undecided: 2 })))
      .toEqual({ step: null, label: "Resolve APR-9", href: "/approvals/a9" });
  });
  it("no date comes next, pointing at the employee form", () => {
    expect(offboardingNext(leaver({ dueAt: null, undecided: 2 })))
      .toEqual({ step: null, label: "Set a date", href: "/employees/e1/edit" });
  });
  it("undecided items: Collect, singular and plural", () => {
    expect(offboardingNext(leaver({ undecided: 3 })))
      .toEqual({ step: "collect", label: "Collect 3 items", href: "/offboarding/e1?step=collect" });
    expect(offboardingNext(leaver({ undecided: 1 }))?.label).toBe("Collect 1 item");
  });
  it("a live account: Close account", () => {
    expect(offboardingNext(leaver({ m365Status: "active" })))
      .toEqual({ step: "accounts", label: "Close account", href: "/offboarding/e1?step=accounts" });
  });
  it("otherwise Complete, on the Finish step", () => {
    expect(offboardingNext(leaver()))
      .toEqual({ step: "report", label: "Complete", href: "/offboarding/e1?step=report" });
  });
});

describe("readiness / completionBlockers — the three server gates, shown first", () => {
  const input = { id: "e1", total: 5, undecided: 0, failed: [], m365Status: "inactive" };
  it("all clear: three ok lines, no blockers", () => {
    expect(readiness(input)).toEqual([
      { kind: "equipment", label: "Equipment · 5 of 5 decided", ok: true, href: null },
      { kind: "m365", label: "Microsoft 365 · inactive", ok: true, href: null },
    ]);
    expect(completionBlockers(input)).toEqual([]);
  });
  it("undecided items block and link Collect", () => {
    expect(completionBlockers({ ...input, undecided: 2 })).toEqual([
      { kind: "equipment", label: "Equipment · 3 of 5 decided", ok: false, href: "/offboarding/e1?step=collect" },
    ]);
  });
  it("each failed return is its own line linking the approval", () => {
    const failed = [{ refNo: "APR-1", approvalId: "a1" }, { refNo: "APR-2", approvalId: "a2" }];
    expect(completionBlockers({ ...input, failed }).map((l) => [l.label, l.href])).toEqual([
      ["Requests · APR-1 failed to execute", "/approvals/a1"],
      ["Requests · APR-2 failed to execute", "/approvals/a2"],
    ]);
  });
  it("no account at all is fine; a live one blocks and links Accounts", () => {
    expect(readiness({ ...input, m365Status: null })[1])
      .toEqual({ kind: "m365", label: "Microsoft 365 · never had an account", ok: true, href: null });
    expect(completionBlockers({ ...input, m365Status: "active" })).toEqual([
      { kind: "m365", label: "Microsoft 365 · active", ok: false, href: "/offboarding/e1?step=accounts" },
    ]);
  });
});

describe("offboardingAttention — worst reason first", () => {
  const today = "2026-09-24";
  it("each kind, in precedence", () => {
    expect(offboardingAttention(leaver({ failed: { refNo: "APR-1", approvalId: "a1" } }), today))
      .toEqual({ kind: "failed", label: "return failed · APR-1", severity: 6000 });
    expect(offboardingAttention(leaver({ dueAt: new Date("2026-09-21T00:00:00+08:00"), undecided: 2 }), today))
      .toEqual({ kind: "overdue", label: "overdue by 3 d", severity: 5003 });
    expect(offboardingAttention(leaver({ dueAt: null }), today))
      .toEqual({ kind: "no-date", label: "no completion date", severity: 4000 });
    expect(offboardingAttention(leaver({ undecided: 2 }), today))
      .toEqual({ kind: "undecided", label: "2 to decide", severity: 3002 });
    expect(offboardingAttention(leaver({ m365Status: "active" }), today))
      .toEqual({ kind: "m365", label: "account still active", severity: 2000 });
    expect(offboardingAttention(leaver(), today))
      .toEqual({ kind: "ready", label: "ready to complete", severity: 1000 });
  });
  it("due today is not overdue", () => {
    expect(offboardingAttention(leaver({ dueAt: new Date("2026-09-24T09:00:00+08:00") }), today)?.kind).toBe("ready");
  });
  it("nothing for someone already offboarded", () => {
    expect(offboardingAttention(leaver({ employment: "OFFBOARDED" }), today)).toBeNull();
  });
  it("orders desc worst first, ties by name then id, null last", () => {
    const at = (severity: number) => ({ kind: "ready" as const, label: "", severity });
    const rows = [
      { id: "3", name: "Cy", attention: at(1000) },
      { id: "1", name: "Ana", attention: null },
      { id: "2", name: "Ben", attention: at(6000) },
      { id: "5", name: "Ana", attention: at(1000) },
      { id: "4", name: "Ana", attention: at(1000) },
    ];
    expect(orderByOffboardingAttention(rows, "desc").map((r) => r.id)).toEqual(["2", "4", "5", "3", "1"]);
    expect(orderByOffboardingAttention(rows, "asc").map((r) => r.id)).toEqual(["4", "5", "3", "2", "1"]);
  });
});

describe("defaultStep — open where the work is", () => {
  it("review once offboarded; collect, accounts, report otherwise", () => {
    expect(defaultStep({ employment: "OFFBOARDED", undecided: 0, m365Status: null })).toBe("review");
    expect(defaultStep({ employment: "OFFBOARDING", undecided: 2, m365Status: "active" })).toBe("collect");
    expect(defaultStep({ employment: "OFFBOARDING", undecided: 0, m365Status: "active" })).toBe("accounts");
    expect(defaultStep({ employment: "OFFBOARDING", undecided: 0, m365Status: "inactive" })).toBe("report");
  });
});

describe("decisionStateLabel", () => {
  it("friendly words for the decision states", () => {
    expect(decisionStateLabel("PENDING")).toBe("awaiting approval");
    expect(decisionStateLabel("CLAIMED")).toBe("awaiting approval");
    expect(decisionStateLabel("APPROVED")).toBe("approved");
    expect(decisionStateLabel("EXECUTED")).toBe("done");
    expect(decisionStateLabel("EXECUTION_FAILED")).toBe("failed to execute");
    expect(decisionStateLabel("SOMETHING_NEW")).toBe("something new");
  });
});
