import { describe, expect, it } from "vitest";
import { rateDecision, RATE_LIMITS } from "./rate-limit";

const now = new Date("2026-08-16T10:00:00Z");
const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);

describe("rateDecision", () => {
  it("allows while fewer than the limit exist in the window", () => {
    const recent = Array.from({ length: RATE_LIMITS.mutation.limit - 1 }, (_, i) => secondsAgo(i));
    expect(rateDecision(recent, "mutation", now)).toEqual({ allowed: true });
  });
  it("blocks at the limit and reports when the window frees up", () => {
    // 60 events, newest first; the 60th-newest is 30s old → frees in 30s.
    const recent = Array.from({ length: 60 }, (_, i) => secondsAgo(i * 0.5));
    const d = rateDecision(recent, "mutation", now);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.retryAfterSec).toBe(31); // ceil(30.5s remaining)
  });
  it("retryAfterSec is never below 1", () => {
    const recent = Array.from({ length: 60 }, () => secondsAgo(59.999));
    const d = rateDecision(recent, "mutation", now);
    if (!d.allowed) expect(d.retryAfterSec).toBeGreaterThanOrEqual(1);
  });
  it("import kind uses the 10/min budget", () => {
    const recent = Array.from({ length: 10 }, (_, i) => secondsAgo(i));
    expect(rateDecision(recent, "import", now).allowed).toBe(false);
  });
});
