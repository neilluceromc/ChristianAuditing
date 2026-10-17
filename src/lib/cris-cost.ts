import type { CrisModelId } from "./cris-settings";

/**
 * Plan, "Models and prices" (spec §9: a small constant table in code). US cents per 1M tokens,
 * kept as integers so a sum is exact until the one division at the end.
 */
const CENTS_PER_MTOK: Record<CrisModelId, { in: number; out: number }> = {
  "claude-haiku-5-5": { in: 10, out: 50 },
  "claude-sonnet-5-5": { in: 200, out: 1000 },
  "claude-opus-5-5": { in: 400, out: 2000 },
};

/** The dollar cost of one reply's (or a month's) token usage, for Settings › Cris "about {$ cost}". */
export function costUsd(model: CrisModelId, inTok: number, outTok: number): number {
  const p = CENTS_PER_MTOK[model];
  return (inTok * p.in + outTok * p.out) / 100_000_000;
}
