import { describe, expect, it } from "vitest";
import { approvalTransition, escalatePriority } from "./approval-flow";

const owner = { isOwner: true, isAdmin: false };
const stranger = { isOwner: false, isAdmin: false };
const admin = { isOwner: false, isAdmin: true };

describe("approvalTransition — brief §6.2, exact", () => {
  it("claim only from PENDING", () => {
    expect(approvalTransition("PENDING", "claim", stranger)).toEqual({ ok: true, next: "CLAIMED" });
    for (const s of ["CLAIMED", "APPROVED", "REJECTED", "EXECUTED", "EXECUTION_FAILED"] as const) {
      expect(approvalTransition(s, "claim", stranger).ok).toBe(false);
    }
  });
  it("release only from CLAIMED, by the owner or an admin", () => {
    expect(approvalTransition("CLAIMED", "release", owner)).toEqual({ ok: true, next: "PENDING" });
    expect(approvalTransition("CLAIMED", "release", admin)).toEqual({ ok: true, next: "PENDING" });
    expect(approvalTransition("CLAIMED", "release", stranger).ok).toBe(false);
    expect(approvalTransition("PENDING", "release", owner).ok).toBe(false);
  });
  it("approve only from CLAIMED and ONLY by the owner — admins can't approve others' claims", () => {
    expect(approvalTransition("CLAIMED", "approve", owner)).toEqual({ ok: true, next: "APPROVED" });
    expect(approvalTransition("CLAIMED", "approve", admin).ok).toBe(false);
    expect(approvalTransition("PENDING", "approve", owner).ok).toBe(false);
  });
  it("reject from PENDING and EXECUTION_FAILED by anyone with the role; from CLAIMED owner/admin only", () => {
    expect(approvalTransition("PENDING", "reject", stranger)).toEqual({ ok: true, next: "REJECTED" });
    expect(approvalTransition("EXECUTION_FAILED", "reject", stranger)).toEqual({ ok: true, next: "REJECTED" });
    expect(approvalTransition("CLAIMED", "reject", owner)).toEqual({ ok: true, next: "REJECTED" });
    expect(approvalTransition("CLAIMED", "reject", admin)).toEqual({ ok: true, next: "REJECTED" });
    expect(approvalTransition("CLAIMED", "reject", stranger).ok).toBe(false);
    expect(approvalTransition("APPROVED", "reject", admin).ok).toBe(false); // queued for execution — too late
  });
  it("escalate keeps state, only from PENDING/CLAIMED", () => {
    expect(approvalTransition("PENDING", "escalate", stranger)).toEqual({ ok: true, next: null });
    expect(approvalTransition("CLAIMED", "escalate", stranger)).toEqual({ ok: true, next: null });
    expect(approvalTransition("EXECUTED", "escalate", admin).ok).toBe(false);
  });
  it("retry re-queues only EXECUTION_FAILED", () => {
    expect(approvalTransition("EXECUTION_FAILED", "retry", stranger)).toEqual({ ok: true, next: "APPROVED" });
    expect(approvalTransition("REJECTED", "retry", admin).ok).toBe(false);
  });
  it("REJECTED and EXECUTED are terminal for every action", () => {
    for (const action of ["claim", "release", "approve", "reject", "escalate", "retry"] as const) {
      expect(approvalTransition("REJECTED", action, admin).ok).toBe(false);
      expect(approvalTransition("EXECUTED", action, admin).ok).toBe(false);
    }
  });
  it("failures carry a human reason", () => {
    const r = approvalTransition("CLAIMED", "approve", stranger);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/own/i);
  });
});

describe("escalatePriority", () => {
  it("cycles NORMAL → HIGH → URGENT and saturates", () => {
    expect(escalatePriority("NORMAL")).toBe("HIGH");
    expect(escalatePriority("HIGH")).toBe("URGENT");
    expect(escalatePriority("URGENT")).toBe("URGENT");
  });
});
