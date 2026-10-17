import { describe, expect, it } from "vitest";
import { dailyLeft, manilaDayStart } from "./cris-limits";
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

describe("dailyLeft", () => {
  it("counts down to zero and never below", () => {
    expect(dailyLeft(100, 100)).toBe(0);
    expect(dailyLeft(99, 100)).toBe(1);
    expect(dailyLeft(0, 100)).toBe(100);
    expect(dailyLeft(150, 100)).toBe(0);
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
