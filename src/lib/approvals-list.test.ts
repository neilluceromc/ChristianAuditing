import { describe, expect, it } from "vitest";
import { parseTab, QUEUE_TABS, slaLabel, tabWhere } from "./approvals-list";

describe("queue tabs (README 1k: Open / Mine / Unclaimed / Failed / Closed)", () => {
  it("declares the five tabs in order", () => {
    expect(QUEUE_TABS.map((t) => t.id)).toEqual(["open", "mine", "unclaimed", "failed", "closed"]);
  });
  it("parseTab falls back to open", () => {
    expect(parseTab("mine")).toBe("mine");
    expect(parseTab("bogus")).toBe("open");
    expect(parseTab(null)).toBe("open");
  });
  it("tabWhere encodes each tab's Prisma filter", () => {
    expect(tabWhere("open", "u1")).toEqual({ state: { in: ["PENDING", "CLAIMED"] } });
    expect(tabWhere("mine", "u1")).toEqual({ state: "CLAIMED", claimedById: "u1" });
    expect(tabWhere("unclaimed", "u1")).toEqual({ state: "PENDING" });
    expect(tabWhere("failed", "u1")).toEqual({ state: "EXECUTION_FAILED" });
    expect(tabWhere("closed", "u1")).toEqual({ state: { in: ["REJECTED", "EXECUTED"] } });
  });
});

describe("slaLabel", () => {
  const now = new Date("2026-08-17T12:00:00Z");
  it("future SLAs read as runway", () => {
    expect(slaLabel(new Date("2026-08-19T12:00:00Z"), now)).toEqual({ text: "in 2 d", overdue: false });
  });
  it("past SLAs read overdue", () => {
    expect(slaLabel(new Date("2026-08-16T12:00:00Z"), now)).toEqual({ text: "1 d overdue", overdue: true });
  });
  it("same-day reads in hours", () => {
    expect(slaLabel(new Date("2026-08-17T15:00:00Z"), now)).toEqual({ text: "in 3 h", overdue: false });
    expect(slaLabel(new Date("2026-08-17T10:00:00Z"), now)).toEqual({ text: "2 h overdue", overdue: true });
  });
});
