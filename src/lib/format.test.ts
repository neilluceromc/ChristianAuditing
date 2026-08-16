import { describe, expect, it } from "vitest";
import { fmtDate, fmtDateTime, fmtMoney, fmtRelativeDays } from "./format";

describe("format", () => {
  it("fmtDate renders dd MMM yyyy in Asia/Manila and — for empty", () => {
    expect(fmtDate(new Date("2026-08-16T00:00:00Z"))).toBe("16 Aug 2026");
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate("2026-01-05T00:00:00Z")).toBe("05 Jan 2026");
  });
  it("fmtMoney renders whole pesos and — for empty", () => {
    expect(fmtMoney(55000)).toBe("₱55,000");
    expect(fmtMoney(null)).toBe("—");
    expect(fmtMoney("18400")).toBe("₱18,400");
  });
  it("fmtRelativeDays", () => {
    const now = new Date("2026-08-16T12:00:00Z");
    expect(fmtRelativeDays(new Date("2026-08-16T09:00:00Z"), now)).toBe("today");
    expect(fmtRelativeDays(new Date("2026-08-13T12:00:00Z"), now)).toBe("3 d ago");
    expect(fmtRelativeDays(new Date("2026-08-19T12:00:00Z"), now)).toBe("in 3 d");
  });
  it("fmtDateTime includes the clock, Asia/Manila", () => {
    expect(fmtDateTime(new Date("2026-08-16T01:41:00Z"))).toBe("16 Aug 2026 09:41");
    expect(fmtDateTime(null)).toBe("—");
  });
});
