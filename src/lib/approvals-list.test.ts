import { ApprovalType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  CLOSED_VIA,
  CLOSED_VIA_LABEL,
  DIRECT_KIND_LABEL,
  DIRECT_WINDOW_DAYS,
  parseTab,
  parseVia,
  QUEUE_TABS,
  slaLabel,
  tabWhere,
  viaWhere,
} from "./approvals-list";

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

describe("Closed tab's via filter (Phase 21: appliedDirectly)", () => {
  it("declares the three via values", () => {
    expect(CLOSED_VIA).toEqual(["all", "direct", "queue"]);
  });
  it("parseVia falls back to all", () => {
    expect(parseVia("direct")).toBe("direct");
    expect(parseVia("queue")).toBe("queue");
    expect(parseVia("all")).toBe("all");
    expect(parseVia("x")).toBe("all");
    expect(parseVia(null)).toBe("all");
    expect(parseVia(undefined)).toBe("all");
  });
  it("viaWhere encodes each via value's Prisma filter", () => {
    expect(viaWhere("direct")).toEqual({ appliedDirectly: true });
    expect(viaWhere("queue")).toEqual({ appliedDirectly: false });
    expect(viaWhere("all")).toEqual({});
  });
  it("CLOSED_VIA_LABEL covers every via value", () => {
    expect(CLOSED_VIA_LABEL).toEqual({ all: "All", direct: "Applied directly", queue: "Through the queue" });
  });
  it("DIRECT_WINDOW_DAYS is 7", () => {
    expect(DIRECT_WINDOW_DAYS).toBe(7);
  });
  it("DIRECT_KIND_LABEL has every ApprovalType key", () => {
    expect(Object.keys(DIRECT_KIND_LABEL).sort()).toEqual(Object.values(ApprovalType).sort());
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
