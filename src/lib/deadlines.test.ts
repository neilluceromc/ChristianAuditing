import { describe, expect, it } from "vitest";
import {
  addDays, addWorkingDays, dayFromISO, defaultOffboardingDue, defaultStocktakeDue, dueStatus, isPastDue,
  minOffboardingDue, minStocktakeDue, offboardingCompletionText, OFFBOARDING_DUE_WORKING_DAYS, STOCKTAKE_DUE_DAYS,
} from "./deadlines";

const TODAY = "2026-09-16"; // a Wednesday
describe("addWorkingDays", () => {
  it("skips weekends from every start day", () => {
    expect(addWorkingDays("2026-09-14", 5)).toBe("2026-09-21"); // Mon → Mon
    expect(addWorkingDays("2026-09-15", 5)).toBe("2026-09-22"); // Tue → Tue
    expect(addWorkingDays("2026-09-16", 5)).toBe("2026-09-23"); // Wed → Wed
    expect(addWorkingDays("2026-09-17", 5)).toBe("2026-09-24"); // Thu → Thu
    expect(addWorkingDays("2026-09-18", 5)).toBe("2026-09-25"); // Fri → Fri
    expect(addWorkingDays("2026-09-19", 5)).toBe("2026-09-25"); // Sat → Fri
    expect(addWorkingDays("2026-09-20", 5)).toBe("2026-09-25"); // Sun → Fri
  });
  it("crosses a month end and a year end", () => {
    expect(addWorkingDays("2026-09-29", 5)).toBe("2026-10-06");
    expect(addWorkingDays("2026-12-30", 5)).toBe("2027-01-06");
  });
});
describe("addDays / defaults / floors", () => {
  it("adds calendar days across a month end", () => expect(addDays("2026-09-29", 3)).toBe("2026-10-02"));
  it("defaults are 5 working days and 3 days", () => {
    expect(OFFBOARDING_DUE_WORKING_DAYS).toBe(5); expect(STOCKTAKE_DUE_DAYS).toBe(3);
    expect(defaultOffboardingDue(TODAY)).toBe("2026-09-23"); expect(defaultStocktakeDue(TODAY)).toBe("2026-09-19");
  });
  it("floors: offboarding today, stocktake tomorrow", () => {
    expect(minOffboardingDue(TODAY)).toBe(TODAY); expect(minStocktakeDue(TODAY)).toBe("2026-09-17");
  });
});
describe("dueStatus", () => {
  it("labels overdue, today, tomorrow and later, with tone accent at or past the day", () => {
    expect(dueStatus(dayFromISO("2026-09-06"), TODAY)).toEqual({ days: -10, text: "10 d overdue", tone: "accent", overdue: true });
    expect(dueStatus(dayFromISO("2026-09-15"), TODAY)).toEqual({ days: -1, text: "1 d overdue", tone: "accent", overdue: true });
    expect(dueStatus(dayFromISO("2026-09-16"), TODAY)).toEqual({ days: 0, text: "due today", tone: "accent", overdue: false });
    expect(dueStatus(dayFromISO("2026-09-17"), TODAY)).toEqual({ days: 1, text: "due tomorrow", tone: "neutral", overdue: false });
    expect(dueStatus(dayFromISO("2026-09-19"), TODAY)).toEqual({ days: 3, text: "due in 3 d", tone: "neutral", overdue: false });
  });
  it("isPastDue is false on the due day itself", () => {
    expect(isPastDue(dayFromISO(TODAY), TODAY)).toBe(false);
    expect(isPastDue(dayFromISO("2026-09-15"), TODAY)).toBe(true);
  });
});
describe("offboardingCompletionText", () => {
  const due = dayFromISO("2026-09-14");
  it("no date", () => expect(offboardingCompletionText(null, null, TODAY)).toBe("No completion date set"));
  it("completed on or before the day", () =>
    expect(offboardingCompletionText(due, dayFromISO("2026-09-14"), TODAY)).toBe("Completed on time (due 14 Sept 2026)"));
  it("completed late", () =>
    expect(offboardingCompletionText(due, dayFromISO("2026-09-16"), TODAY)).toBe("Completed 2 d late (due 14 Sept 2026)"));
  it("still open", () => {
    expect(offboardingCompletionText(due, null, TODAY)).toBe("Still open · 2 d overdue (due 14 Sept 2026)");
    expect(offboardingCompletionText(dayFromISO("2026-09-19"), null, TODAY)).toBe("Still open · due in 3 d (due 19 Sept 2026)");
  });
});
