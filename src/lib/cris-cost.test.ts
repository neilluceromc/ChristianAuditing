import { describe, expect, it } from "vitest";
import { costUsd } from "./cris-cost";

describe("costUsd (plan: Models and prices)", () => {
  it("Haiku: 1M in + 1M out is $0.60", () => {
    expect(costUsd("claude-haiku-5-5", 1_000_000, 1_000_000)).toBe(0.6);
  });
  it("Sonnet and Opus use their own prices", () => {
    expect(costUsd("claude-sonnet-5-5", 1_000_000, 1_000_000)).toBe(12);
    expect(costUsd("claude-opus-5-5", 1_000_000, 1_000_000)).toBe(24);
  });
  it("prices input and output separately", () => {
    expect(costUsd("claude-haiku-5-5", 2_000, 0)).toBeCloseTo(0.0002, 10);
    expect(costUsd("claude-haiku-5-5", 0, 2_000)).toBeCloseTo(0.001, 10);
  });
  it("no tokens cost nothing", () => {
    expect(costUsd("claude-opus-5-5", 0, 0)).toBe(0);
  });
});
