import { describe, expect, it } from "vitest";
import { executionPlan, summarizeApproval } from "./approval-execution";

describe("executionPlan — payload → asset updates (Phase 3 payload shapes)", () => {
  it("assign: sets assignee and the requested status", () => {
    expect(executionPlan("lifecycle_assign", { to: { assigneeId: "emp1", status: "DEPLOYED" }, reason: "x" }))
      .toEqual({ ok: true, updates: { assigneeId: "emp1", status: "DEPLOYED" } });
  });
  it("assign: only DEPLOYED/TEMPORARY are valid targets", () => {
    const plan = executionPlan("lifecycle_assign", { to: { assigneeId: "emp1", status: "DISPOSE" } });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/DEPLOYED|TEMPORARY/);
  });
  it("return: clears the assignee back to SPARE", () => {
    expect(executionPlan("lifecycle_return", { from: { assigneeId: "emp1" }, to: { assigneeId: null, status: "SPARE" } }))
      .toEqual({ ok: true, updates: { assigneeId: null, status: "SPARE" } });
  });
  it("change-status: applies the target status", () => {
    expect(executionPlan("lifecycle_change_status", { from: { status: "SPARE" }, to: { status: "DISPOSE" }, reason: "x" }))
      .toEqual({ ok: true, updates: { status: "DISPOSE" } });
  });
  it("malformed payloads fail with a verbatim-able error (seeded APR-2035 shape)", () => {
    const plan = executionPlan("lifecycle_assign", { note: "queued for execution" });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error.length).toBeGreaterThan(10);
  });
  it("unsupported types fail honestly", () => {
    const plan = executionPlan("lifecycle_transfer", { from: "EMP-0042", to: "EMP-0051" });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/transfer/i);
  });
});

describe("summarizeApproval — the queue's two-line change cell", () => {
  it("assign", () => {
    const s = summarizeApproval("lifecycle_assign", { to: { assigneeId: "e", status: "DEPLOYED" }, reason: "slot fill" }, { assetTag: "BR-HS-0502", employeeName: "M. Bautista" });
    expect(s.line1).toBe("lifecycle.assign · BR-HS-0502");
    expect(s.line2).toBe("→ DEPLOYED · M. Bautista — slot fill");
  });
  it("change-status shows from → to", () => {
    const s = summarizeApproval("lifecycle_change_status", { from: { status: "SPARE" }, to: { status: "DISPOSE" }, reason: "EOL" }, { assetTag: "BR-LT-0031" });
    expect(s.line1).toBe("lifecycle.change-status · BR-LT-0031");
    expect(s.line2).toBe("SPARE → DISPOSE — EOL");
  });
  it("return", () => {
    const s = summarizeApproval("lifecycle_return", { from: { assigneeId: "e" }, to: { assigneeId: null, status: "SPARE" }, reason: "offboarding" }, { assetTag: "BR-LT-0148", employeeName: "D. Ong" });
    expect(s.line1).toBe("lifecycle.return · BR-LT-0148");
    expect(s.line2).toBe("D. Ong → SPARE — offboarding");
  });
  it("degrades without names and without reason", () => {
    const s = summarizeApproval("lifecycle_assign", { to: { assigneeId: "e", status: "DEPLOYED" } }, {});
    expect(s.line1).toBe("lifecycle.assign");
    expect(s.line2).toBe("→ DEPLOYED");
  });
});
