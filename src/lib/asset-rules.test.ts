import { describe, expect, it } from "vitest";
import { creationPlan, warrantyProgress, CREATABLE_STATUSES } from "./asset-rules";

describe("creationPlan (README 3b: assignment routes through lifecycle.assign)", () => {
  it("SPARE is a plain direct write", () => {
    expect(creationPlan("SPARE", null)).toEqual({ ok: true, status: "SPARE", approval: null });
  });
  it("DEPLOYED/TEMPORARY require an assignee", () => {
    expect(creationPlan("DEPLOYED", null)).toEqual({ ok: false, error: "assignee_required" });
    expect(creationPlan("TEMPORARY", "")).toEqual({ ok: false, error: "assignee_required" });
  });
  it("assignment creates the asset SPARE plus an approval — never a direct DEPLOYED write", () => {
    expect(creationPlan("DEPLOYED", "emp1")).toEqual({
      ok: true, status: "SPARE", approval: { toStatus: "DEPLOYED", assigneeId: "emp1" },
    });
  });
  it("only SPARE/DEPLOYED/TEMPORARY are offered on creation", () => {
    expect(CREATABLE_STATUSES).toEqual(["SPARE", "DEPLOYED", "TEMPORARY"]);
  });
});

describe("warrantyProgress", () => {
  const now = new Date("2026-08-16T00:00:00Z");
  it("null without a warranty date", () => {
    expect(warrantyProgress(new Date(), null, now)).toBeNull();
  });
  it("reports elapsed share and days remaining", () => {
    const p = warrantyProgress(new Date("2026-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z"), now);
    expect(p?.label).toBe("expires in 138 d");
    expect(Math.round(p!.pct)).toBe(62);
  });
  it("clamps at 100% and reports expiry age", () => {
    const p = warrantyProgress(new Date("2024-01-01T00:00:00Z"), new Date("2025-01-01T00:00:00Z"), now);
    expect(p?.pct).toBe(100);
    expect(p?.label).toBe("expired 592 d ago");
  });
});
