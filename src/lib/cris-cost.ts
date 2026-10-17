import type { CrisModelId } from "./cris-settings";

/**
 * Plan, "Models and prices" (spec §9: a small constant table in code). US cents per 1M tokens,
 * kept as integers so a sum is exact until the one division at the end.
 *
 * Besides Cris's three models, the models Anthropic's server-side refusal fallback may serve a Sonnet or
 * Opus reply with, so a fallback reply is priced at the model that actually served it.
 *
 * `CrisMessage.inputTokens` holds INPUT-EQUIVALENT tokens (see inputEquivalentTokens): with prompt caching on,
 * a reply's input is split into uncached, cache-write and cache-read tokens, billed at 1×, 1.25× (5-minute
 * cache) and 0.1× of the input price. Storing their weighted sum keeps this table — and every stored row —
 * priced correctly with the one input price, with no migration.
 */
const CENTS_PER_MTOK = {
  "claude-haiku-5-5": { in: 10, out: 50 },
  "claude-sonnet-5-5": { in: 200, out: 1000 },
  "claude-opus-5-5": { in: 400, out: 2000 },
  // server-side fallback targets
  "claude-sonnet-5": { in: 200, out: 1000 },
  "claude-opus-5": { in: 500, out: 2500 },
  "claude-opus-4-8": { in: 500, out: 2500 },
} as const satisfies Record<CrisModelId, { in: number; out: number }> & Record<string, { in: number; out: number }>;

export type PricedModelId = keyof typeof CENTS_PER_MTOK;

/** A model id this table can price (the model stored with a reply's usage). */
export function isPricedModel(id: string): id is PricedModelId {
  return Object.hasOwn(CENTS_PER_MTOK, id);
}

/** The dollar cost of one reply's (or a month's) token usage, for Settings › Cris "about {$ cost}". */
export function costUsd(model: PricedModelId, inTok: number, outTok: number): number {
  const p = CENTS_PER_MTOK[model];
  return (inTok * p.in + outTok * p.out) / 100_000_000;
}

/** A reply's input as the tokens it is billed like: uncached + 1.25 × cache writes + 0.1 × cache reads. */
export function inputEquivalentTokens(u: {
  input_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null;
}): number {
  return u.input_tokens + Math.ceil(1.25 * (u.cache_creation_input_tokens ?? 0)) + Math.ceil(0.1 * (u.cache_read_input_tokens ?? 0));
}
