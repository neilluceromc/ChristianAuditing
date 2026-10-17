import { describe, expect, it } from "vitest";
import { costUsd, inputEquivalentTokens, isPricedModel } from "./cris-cost";

describe("inputEquivalentTokens (cache writes bill at 1.25×, cache reads at 0.1× of the input price)", () => {
  it("adds the cache write and read tokens at their weights, rounded up", () => {
    expect(inputEquivalentTokens({ input_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 10_000 })).toBe(100 + 1250 + 1000);
    expect(inputEquivalentTokens({ input_tokens: 0, cache_creation_input_tokens: 3, cache_read_input_tokens: 3 })).toBe(4 + 1);
  });
  it("treats missing or null cache fields as none", () => {
    expect(inputEquivalentTokens({ input_tokens: 42 })).toBe(42);
    expect(inputEquivalentTokens({ input_tokens: 42, cache_creation_input_tokens: null, cache_read_input_tokens: null })).toBe(42);
  });
});

describe("the priced models (a fallback reply is priced at the model that served it)", () => {
  it("knows Cris's three models and the server-side fallback targets", () => {
    for (const m of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-5", "claude-opus-5", "claude-opus-4-8"]) {
      expect(isPricedModel(m)).toBe(true);
    }
    expect(isPricedModel("fake")).toBe(false);
    expect(isPricedModel("toString")).toBe(false);
  });
  it("prices a fallback model at its own rate", () => {
    expect(costUsd("claude-opus-5", 1_000_000, 1_000_000)).toBe(30);
    expect(costUsd("claude-sonnet-5", 1_000_000, 1_000_000)).toBe(12);
  });
});

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
