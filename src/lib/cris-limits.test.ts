import { describe, expect, it } from "vitest";
import { CRIS_DAILY_LIMIT_TEXT, dailyLeft, limitReached, manilaDayStart, monthStartManila } from "./cris-limits";
import { RATE_LIMITS, rateDecision } from "./rate-limit";

describe("manilaDayStart (spec §9: the daily limit counts since Manila midnight)", () => {
  it("one minute before Manila midnight is still the 16th's day", () => {
    expect(manilaDayStart(new Date("2026-10-17T15:59:00Z")).toISOString()).toBe("2026-10-16T16:00:00.000Z");
  });
  it("at Manila midnight a new day starts", () => {
    expect(manilaDayStart(new Date("2026-10-17T16:00:00Z")).toISOString()).toBe("2026-10-17T16:00:00.000Z");
  });
  it("is the same instant all Manila day long", () => {
    const start = "2026-10-17T16:00:00.000Z";
    expect(manilaDayStart(new Date("2026-10-18T00:00:00Z")).toISOString()).toBe(start);
    expect(manilaDayStart(new Date("2026-10-18T15:59:59.999Z")).toISOString()).toBe(start);
  });
});

describe("monthStartManila (spec §9: Settings › Cris counts \"This month\" from the Manila month's start)", () => {
  it("mid-month is the 1st at Manila midnight (the 30th, 16:00 UTC)", () => {
    expect(monthStartManila(new Date("2026-10-17T10:00:00Z")).toISOString()).toBe("2026-09-30T16:00:00.000Z");
  });
  it("the month's last Manila minute still belongs to it", () => {
    expect(monthStartManila(new Date("2026-10-31T15:59:59.999Z")).toISOString()).toBe("2026-09-30T16:00:00.000Z");
  });
  it("a new month starts at Manila midnight on the 1st, while UTC is still on the 31st", () => {
    expect(monthStartManila(new Date("2026-10-31T16:00:00Z")).toISOString()).toBe("2026-10-31T16:00:00.000Z");
  });
  it("in the first Manila minutes of the 1st, while UTC is still on the last day of the previous month", () => {
    expect(monthStartManila(new Date("2026-11-30T16:30:00Z")).toISOString()).toBe("2026-11-30T16:00:00.000Z");
  });
  it("crosses the year in Manila, not UTC", () => {
    expect(monthStartManila(new Date("2026-12-31T17:00:00Z")).toISOString()).toBe("2026-12-31T16:00:00.000Z");
    expect(monthStartManila(new Date("2026-12-31T15:00:00Z")).toISOString()).toBe("2026-11-30T16:00:00.000Z");
  });
  it("handles February in a leap year", () => {
    expect(monthStartManila(new Date("2028-02-29T15:00:00Z")).toISOString()).toBe("2028-01-31T16:00:00.000Z");
    expect(monthStartManila(new Date("2028-02-29T16:00:00Z")).toISOString()).toBe("2028-02-29T16:00:00.000Z");
  });
  it("is never after now, and is a Manila day start", () => {
    const now = new Date("2026-10-17T10:00:00Z");
    const start = monthStartManila(now);
    expect(start.getTime() <= now.getTime()).toBe(true);
    expect(manilaDayStart(start).toISOString()).toBe(start.toISOString());
  });
});

describe("dailyLeft", () => {
  it("counts down to zero and never below", () => {
    expect(dailyLeft(100, 100)).toBe(0);
    expect(dailyLeft(99, 100)).toBe(1);
    expect(dailyLeft(0, 100)).toBe(100);
    expect(dailyLeft(150, 100)).toBe(0);
  });
});

describe("limitReached (Review Focus #5: the 100th and the 101st)", () => {
  it("answers the 100th question and refuses the 101st", () => {
    expect(limitReached(99, 100)).toBe(false); // 99 asked: the 100th goes through
    expect(limitReached(100, 100)).toBe(true); // 100 asked: the 101st is refused
    expect(limitReached(0, 1)).toBe(false);
    expect(limitReached(1, 1)).toBe(true);
  });
  it("refuses when an admin lowered the limit below today's count", () => {
    expect(limitReached(150, 100)).toBe(true);
  });
  it("resets at Manila midnight, not UTC: yesterday's questions fall before today's start", () => {
    // 23:59 Manila on the 17th and 00:01 Manila on the 18th sit on different Manila days, though both are the 17th in UTC.
    const lastMinute = new Date("2026-10-17T15:59:00Z");
    const firstMinute = new Date("2026-10-17T16:01:00Z");
    const start = manilaDayStart(firstMinute);
    expect(lastMinute.getTime() < start.getTime()).toBe(true);
    expect(firstMinute.getTime() >= start.getTime()).toBe(true);
  });
  it("has the spec's copy verbatim", () => {
    expect(CRIS_DAILY_LIMIT_TEXT).toBe("That's all my questions for today — the limit resets at midnight");
  });
});

describe("rate kind cris (spec §9: 10 messages a minute)", () => {
  it("is 10 per 60 s", () => {
    expect(RATE_LIMITS.cris).toEqual({ limit: 10, windowMs: 60_000 });
  });
  it("blocks the 11th message inside the minute", () => {
    const now = new Date("2026-10-17T10:00:00Z");
    const recent = Array.from({ length: 10 }, (_, i) => new Date(now.getTime() - i * 1000));
    expect(rateDecision(recent, "cris", now).allowed).toBe(false);
    expect(rateDecision(recent.slice(1), "cris", now).allowed).toBe(true);
  });
});
