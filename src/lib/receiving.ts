/**
 * Receiving arithmetic. Pure by design: these are the rules that decide what
 * gets written into the asset register, so they are testable without a
 * database.
 *
 * `received` is always a COUNT OF ROWS (assets pointing at the unit), never a
 * stored flag — see the Phase 12 spec, decision 4. That is what makes partial
 * receipts and idempotency fall out for free instead of needing bookkeeping.
 */
export interface UnitReceipt {
  unitId: string;
  ordered: number;
  received: number;
}

/** Floors at zero: an over-receipt must not yield a negative that a caller
 *  renders as "-2 remaining" or uses to size an array. */
export function outstanding(r: UnitReceipt): number {
  return Math.max(0, r.ordered - r.received);
}

/** `>=`, not `===`: an over-received unit is finished, not perpetually open.
 *  A zero-quantity unit is vacuously complete. */
export function isFullyReceived(r: UnitReceipt): boolean {
  return r.received >= r.ordered;
}

const PREFIX_SHAPE = /^[A-Z]{2}$/;

/**
 * The largest number a tag can carry, because `TAG_SHAPE` in `./tag-key`
 * allows exactly four digits. This is the ARITHMETIC face of that regex's
 * `\d{4}`, so the two must move together — widen one and the other is wrong.
 * `receiving.test.ts` pins them to each other so that cannot happen quietly.
 */
const MAX_TAG_NUMBER = 9999;

export type TagRun =
  | { ok: true; tags: string[] }
  | { ok: false; reason: "bad-prefix" | "bad-count" | "overflow" };

/**
 * The next `count` tags for `prefix`, starting after `highest`.
 *
 * A discriminated union rather than a throw or a truncated array: the caller
 * renders these into form fields, and a refusal it can display beats an
 * exception it has to catch. `highest` is null when no asset uses the prefix
 * yet — the run then starts at 1, not at NaN.
 *
 * Refuses on overflow rather than emitting `BR-LT-10000`, which TAG_SHAPE
 * would reject at the server action three layers later. Fail where the number
 * is minted.
 */
export function nextTags(prefix: string, highest: number | null, count: number): TagRun {
  if (!PREFIX_SHAPE.test(prefix)) return { ok: false, reason: "bad-prefix" };
  if (!Number.isInteger(count) || count < 1) return { ok: false, reason: "bad-count" };

  const start = (highest ?? 0) + 1;
  if (start + count - 1 > MAX_TAG_NUMBER) return { ok: false, reason: "overflow" };

  const tags: string[] = [];
  for (let n = start; n < start + count; n++) {
    tags.push(`BR-${prefix}-${String(n).padStart(4, "0")}`);
  }
  return { ok: true, tags };
}

/**
 * Which two-letter prefix the assets in a given group already use.
 *
 * There is no rule to compute this from a category or type name — measured on
 * live data, the prefix follows the category five times out of six and the
 * type in the sixth ("Peripheral" holding a Keyboard tagged KB). So it is
 * LEARNED from existing rows rather than configured. Ties break
 * alphabetically so a form does not offer a different default on each render.
 */
export function preferredPrefix(counts: Array<{ prefix: string; n: number }>): string | null {
  if (counts.length === 0) return null;
  return [...counts].sort((a, b) => b.n - a.n || a.prefix.localeCompare(b.prefix))[0].prefix;
}
