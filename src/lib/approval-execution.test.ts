import { describe, expect, it } from "vitest";
import { executionPlan, summarizeApproval } from "./approval-execution";

describe("executionPlan — payload → asset updates (Phase 3 payload shapes)", () => {
  it("assign: sets assignee and the requested status", () => {
    expect(executionPlan("lifecycle_assign", { to: { assigneeId: "emp1", status: "DEPLOYED" }, reason: "x" }, "IT"))
      .toEqual({ ok: true, updates: { assigneeId: "emp1", status: "DEPLOYED" } });
  });
  it("assign: only DEPLOYED/TEMPORARY are valid targets", () => {
    const plan = executionPlan("lifecycle_assign", { to: { assigneeId: "emp1", status: "DISPOSE" } }, "IT");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/DEPLOYED|TEMPORARY/);
  });
  it("return: clears the assignee back to SPARE", () => {
    expect(executionPlan("lifecycle_return", { from: { assigneeId: "emp1" }, to: { assigneeId: null, status: "SPARE" } }, "IT"))
      .toEqual({ ok: true, updates: { assigneeId: null, status: "SPARE" } });
  });
  it("change-status: applies the target status", () => {
    expect(executionPlan("lifecycle_change_status", { from: { status: "SPARE" }, to: { status: "DISPOSE" }, reason: "x" }, "IT"))
      .toEqual({ ok: true, updates: { status: "DISPOSE" } });
  });
  it("malformed payloads fail with a verbatim-able error (seeded APR-2035 shape)", () => {
    const plan = executionPlan("lifecycle_assign", { note: "queued for execution" }, "IT");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error.length).toBeGreaterThan(10);
  });
  it("change-status: refuses out-of-enum targets instead of casting blindly", () => {
    const plan = executionPlan("lifecycle_change_status", { from: { status: "SPARE" }, to: { status: "BANANAS" } }, "IT");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/not a valid status for IT assets/);
  });
  it("unsupported types fail honestly", () => {
    const plan = executionPlan("lifecycle_transfer", { from: "EMP-0042", to: "EMP-0051" }, "IT");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/transfer/i);
  });
  it("return: accepts every offboarding outcome, always clearing the holder", () => {
    const cases = [
      ["SPARE", "SPARE"],
      ["DEFECTIVE", "DEFECTIVE"],
      ["BUYOUT", "BUYOUT"],
      ["MISSING", "MISSING"],
    ] as const;
    for (const [target, expected] of cases) {
      expect(
        executionPlan("lifecycle_return", { from: { assigneeId: "emp1" }, to: { assigneeId: null, status: target } }, "IT"),
      ).toEqual({ ok: true, updates: { assigneeId: null, status: expected } });
    }
  });

  it("return: refuses a target that isn't an offboarding outcome, naming it", () => {
    for (const bad of ["DEPLOYED", "TEMPORARY", "DONATED", "DISPOSE", "STORED"]) {
      const plan = executionPlan("lifecycle_return", { from: { assigneeId: "e" }, to: { assigneeId: null, status: bad } }, "IT");
      expect(plan.ok).toBe(false);
      // the offending value must END the message, not merely appear inside a
      // JSON dump of the whole payload — this is copy an operator reads verbatim
      if (!plan.ok) expect(plan.error).toMatch(new RegExp(`got ${bad}$`));
    }
  });

  it("return: still refuses a payload with no target status at all", () => {
    const plan = executionPlan("lifecycle_return", { from: { assigneeId: "e" } }, "IT");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/lifecycle\.return/);
  });

  it("assign (PURCHASING): OPERATIONAL is the only legal target", () => {
    expect(executionPlan("lifecycle_assign", { to: { assigneeId: "emp1", status: "OPERATIONAL" } }, "PURCHASING"))
      .toEqual({ ok: true, updates: { assigneeId: "emp1", status: "OPERATIONAL" } });
    const wrong = executionPlan("lifecycle_assign", { to: { assigneeId: "emp1", status: "DEPLOYED" } }, "PURCHASING");
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toMatch(/OPERATIONAL/);
  });
  it("assign (IT): OPERATIONAL is refused — the class sets are disjoint both ways", () => {
    const plan = executionPlan("lifecycle_assign", { to: { assigneeId: "emp1", status: "OPERATIONAL" } }, "IT");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/DEPLOYED or TEMPORARY/);
  });
  it("return (PURCHASING): STORED / REPAIRING / LOST, never BUYOUT", () => {
    expect(executionPlan("lifecycle_return", { from: { assigneeId: "e" }, to: { assigneeId: null, status: "STORED" } }, "PURCHASING"))
      .toEqual({ ok: true, updates: { assigneeId: null, status: "STORED" } });
    const buyout = executionPlan("lifecycle_return", { from: { assigneeId: "e" }, to: { assigneeId: null, status: "BUYOUT" } }, "PURCHASING");
    expect(buyout.ok).toBe(false);
    if (!buyout.ok) expect(buyout.error).toMatch(/STORED, REPAIRING, LOST/);
  });
  it("change-status validates against the CLASS's set, not the whole enum", () => {
    // DEPLOYED is a perfectly valid AssetStatus — and illegal for a car.
    const plan = executionPlan("lifecycle_change_status", { from: { status: "STORED" }, to: { status: "DEPLOYED" } }, "PURCHASING");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/not a valid status for Purchasing assets/);
    expect(executionPlan("lifecycle_change_status", { from: { status: "STORED" }, to: { status: "SOLD" } }, "PURCHASING"))
      .toEqual({ ok: true, updates: { status: "SOLD" } });
  });
});

describe("summarizeApproval — the queue's two-line change cell", () => {
  it("assign", () => {
    const s = summarizeApproval("lifecycle_assign", { to: { assigneeId: "e", status: "DEPLOYED" }, reason: "slot fill" }, { assetTag: "BR-HS-0502", employeeName: "M. Bautista", cls: "IT" });
    expect(s.line1).toBe("lifecycle.assign · BR-HS-0502");
    expect(s.line2).toBe("→ DEPLOYED · M. Bautista — slot fill");
  });
  it("change-status shows from → to", () => {
    const s = summarizeApproval("lifecycle_change_status", { from: { status: "SPARE" }, to: { status: "DISPOSE" }, reason: "EOL" }, { assetTag: "BR-LT-0031", cls: "IT" });
    expect(s.line1).toBe("lifecycle.change-status · BR-LT-0031");
    expect(s.line2).toBe("SPARE → DISPOSE — EOL");
  });
  it("return", () => {
    const s = summarizeApproval("lifecycle_return", { from: { assigneeId: "e" }, to: { assigneeId: null, status: "SPARE" }, reason: "offboarding" }, { assetTag: "BR-LT-0148", employeeName: "D. Ong", cls: "IT" });
    expect(s.line1).toBe("lifecycle.return · BR-LT-0148");
    expect(s.line2).toBe("D. Ong → SPARE — offboarding");
  });
  it("degrades without names and without reason", () => {
    const s = summarizeApproval("lifecycle_assign", { to: { assigneeId: "e", status: "DEPLOYED" } }, { cls: undefined });
    expect(s.line1).toBe("lifecycle.assign");
    expect(s.line2).toBe("→ DEPLOYED");
  });
  it("return: the summary names the outcome the payload actually asks for", () => {
    const s = summarizeApproval(
      "lifecycle_return",
      { from: { assigneeId: "e" }, to: { assigneeId: null, status: "MISSING" }, reason: "not returned at offboarding" },
      { assetTag: "BR-PH-0301", employeeName: "D. Ong", cls: "IT" },
    );
    expect(s.line1).toBe("lifecycle.return · BR-PH-0301");
    expect(s.line2).toBe("D. Ong → MISSING — not returned at offboarding");
  });
  it("return: a payload with no target renders '?', not an invented SPARE (seeded APR-2040 shape)", () => {
    // The detail page shows this line beside a system check reading "no target
    // status in the payload" — the two panes must not contradict each other.
    const s = summarizeApproval("lifecycle_return", { reason: "offboarding" }, { employeeName: "D. Ong", cls: undefined });
    expect(s.line2).toBe("D. Ong → ? — offboarding");
  });
  it("assign summary defaults to the CLASS's assign status when the payload omits one", () => {
    expect(summarizeApproval("lifecycle_assign", { to: { assigneeId: "e" } }, { assetTag: "BR-VH-0001", cls: "PURCHASING" }).line2)
      .toBe("→ OPERATIONAL");
    expect(summarizeApproval("lifecycle_assign", { to: { assigneeId: "e" } }, { assetTag: "BR-LT-0001", cls: "IT" }).line2)
      .toBe("→ DEPLOYED");
  });
  it("assign summary prints an explicit status regardless of class fallback", () => {
    expect(summarizeApproval("lifecycle_assign", { to: { assigneeId: "e", status: "OPERATIONAL" } }, { assetTag: "BR-VH-0001", cls: "PURCHASING" }).line2)
      .toBe("→ OPERATIONAL");
  });
});
