import { describe, expect, it } from "vitest";
import { TRANSFER_RECENT_DAYS, isRecentTransfer, transferSchema } from "./transfer-schema";

const todayStr = () => new Date().toISOString().slice(0, 10);

const base = {
  employeeId: "e1",
  toDepartmentId: "dept-2",
  toTitle: "Analyst",
  effectiveAt: todayStr(),
  reason: "",
};

describe("transferSchema", () => {
  it("accepts a clean transfer effective today", () => {
    expect(transferSchema.safeParse(base).success).toBe(true);
  });

  // Same-department comparison needs the CURRENT record, which this schema
  // never sees — that refusal ("Already in this department") is the
  // action's job. This schema only requires a department was picked at all.
  it("requires toDepartmentId", () => {
    expect(transferSchema.safeParse({ ...base, toDepartmentId: "" }).success).toBe(false);
  });

  it("requires toTitle between 2 and 120 characters", () => {
    expect(transferSchema.safeParse({ ...base, toTitle: "A" }).success).toBe(false);
    expect(transferSchema.safeParse({ ...base, toTitle: "x".repeat(121) }).success).toBe(false);
    expect(transferSchema.safeParse({ ...base, toTitle: "x".repeat(120) }).success).toBe(true);
  });

  it("refuses a future effective date by name", () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const result = transferSchema.safeParse({ ...base, effectiveAt: tomorrow });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("That date is in the future");
  });

  it("accepts today, the max the date picker allows", () => {
    expect(transferSchema.safeParse({ ...base, effectiveAt: todayStr() }).success).toBe(true);
  });

  it("caps reason at 300 characters and defaults it to empty", () => {
    const noReason: Record<string, unknown> = { ...base };
    delete noReason.reason;
    expect(transferSchema.safeParse(noReason).success).toBe(true);
    expect(transferSchema.safeParse(noReason).data?.reason).toBe("");
    expect(transferSchema.safeParse({ ...base, reason: "x".repeat(301) }).success).toBe(false);
    expect(transferSchema.safeParse({ ...base, reason: "x".repeat(300) }).success).toBe(true);
  });
});

describe("isRecentTransfer", () => {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);

  it("is true at 89 days", () => {
    expect(isRecentTransfer(day(-89))).toBe(true);
  });

  it("is false at 91 days", () => {
    expect(isRecentTransfer(day(-91))).toBe(false);
  });

  it("is inclusive at exactly 90 days — the seeded EMP-0099 fixture", () => {
    expect(isRecentTransfer(day(-90))).toBe(true);
  });

  it("names the window as 90 days", () => {
    expect(TRANSFER_RECENT_DAYS).toBe(90);
  });
});
