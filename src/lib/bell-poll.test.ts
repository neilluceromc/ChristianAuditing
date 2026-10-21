import { describe, expect, it } from "vitest";
import {
  BELL_IDLE_MS, BELL_POLL_MS, BELL_ROUTE_THROTTLE_MS, BELL_WAKE_DEDUPE_MS, bellPollStep, initialBellPollState, isBellIdle,
  type BellPollEvent, type BellPollState,
} from "./bell-poll";

/* Final review I4: the bell's polling rules (cheap on Vercel Hobby). */

const SEC = 1000;
const MIN = 60 * SEC;

/** Runs events at the given times from a fresh state at t=0; returns the times that polled. */
function run(events: Array<[number, BellPollEvent]>): number[] {
  let s: BellPollState = initialBellPollState(0);
  const polls: number[] = [];
  for (const [at, e] of events) {
    const r = bellPollStep(s, e, at);
    s = r.state;
    if (r.poll) polls.push(at);
  }
  return polls;
}

/** Interval ticks every BELL_POLL_MS up to `until`. */
const ticks = (until: number): Array<[number, BellPollEvent]> =>
  Array.from({ length: Math.floor(until / BELL_POLL_MS) }, (_, i) => [(i + 1) * BELL_POLL_MS, "interval"]);

describe("bell polling", () => {
  it("polls every 2 minutes", () => {
    expect(BELL_POLL_MS).toBe(2 * MIN);
    expect(run([[BELL_POLL_MS, "interval"], [2 * BELL_POLL_MS, "interval"]])).toEqual([2 * MIN, 4 * MIN]);
  });

  it("stops after 10 minutes with no input, and resumes (polling at once) on the next input", () => {
    expect(BELL_IDLE_MS).toBe(10 * MIN);
    const polls = run([...ticks(30 * MIN), [31 * MIN, "input"], [33 * MIN, "interval"]]);
    // ticks at 2, 4, 6, 8 min; from 10 min on the person is idle, so 10…30 min poll nothing
    expect(polls).toEqual([2 * MIN, 4 * MIN, 6 * MIN, 8 * MIN, 31 * MIN, 33 * MIN]);
  });

  it("input while active doesn't poll by itself but keeps the interval going", () => {
    const polls = run([[9 * MIN, "input"], ...ticks(20 * MIN)]);
    // active until 19 min: ticks at 2…18 poll, 20 min is idle
    expect(polls).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18].map((m) => m * MIN));
  });

  it("window focus polls and wakes an idle bell", () => {
    expect(run([[25 * MIN, "focus"], [26 * MIN, "interval"]])).toEqual([25 * MIN, 26 * MIN]);
  });

  it("focus and visibilitychange together poll once", () => {
    expect(run([[3 * MIN, "focus"], [3 * MIN + BELL_WAKE_DEDUPE_MS - 1, "focus"]])).toEqual([3 * MIN]);
  });

  it("route changes poll at most once per 30 s", () => {
    expect(BELL_ROUTE_THROTTLE_MS).toBe(30 * SEC);
    const polls = run([
      [10 * SEC, "route"], // 10 s after the layout's own count: skipped
      [31 * SEC, "route"],
      [40 * SEC, "route"],
      [55 * SEC, "route"],
      [62 * SEC, "route"],
    ]);
    expect(polls).toEqual([31 * SEC, 62 * SEC]);
  });

  it("an interval tick right after a route poll is skipped", () => {
    expect(run([[BELL_POLL_MS - 10 * SEC, "route"], [BELL_POLL_MS, "interval"]])).toEqual([BELL_POLL_MS - 10 * SEC]);
  });

  it("a navigation counts as activity", () => {
    const s = bellPollStep(initialBellPollState(0), "route", 9 * MIN).state;
    expect(isBellIdle(s, 18 * MIN)).toBe(false);
    expect(isBellIdle(s, 19 * MIN)).toBe(true);
  });
});
