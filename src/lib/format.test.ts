import { describe, expect, it } from "vitest";
import { fmtDate, fmtDateTime, fmtDayMonth, fmtDayMonthYear, fmtMoney, fmtRelativeDays, localDateISO } from "./format";

describe("format", () => {
  it("localDateISO is the Asia/Manila calendar date, not the UTC one", () => {
    // 17:00Z on the 14th is 01:00 Manila on the 15th — the window in which
    // toISOString().slice(0, 10) still says the 14th.
    expect(localDateISO(new Date("2026-09-14T17:00:00Z"))).toBe("2026-09-15");
    expect(localDateISO(new Date("2026-09-14T15:59:00Z"))).toBe("2026-09-14");
    expect(localDateISO(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
  });
  it("fmtDate renders dd MMM yyyy in Asia/Manila and — for empty", () => {
    expect(fmtDate(new Date("2026-08-16T00:00:00Z"))).toBe("16 Aug 2026");
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate("2026-01-05T00:00:00Z")).toBe("05 Jan 2026");
  });
  it("fmtDayMonth / fmtDayMonthYear render d MMM [yyyy] in Asia/Manila (Phase 37 tiles and side panel)", () => {
    expect(fmtDayMonth("2026-01-05T00:00:00Z")).toBe("5 Jan");
    // 17:00Z on the 14th is already the 15th in Manila
    expect(fmtDayMonth(new Date("2026-03-14T17:00:00Z"))).toBe("15 Mar");
    expect(fmtDayMonthYear("2026-10-16T00:00:00Z")).toBe("16 Oct 2026");
    expect(fmtDayMonth(null)).toBe("—");
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
