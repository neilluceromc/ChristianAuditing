import { describe, expect, it } from "vitest";
import {
  PALETTE_LIMIT,
  SEARCH_MAX_IN_WINDOW,
  SEARCH_WINDOW_MS,
  assetHint,
  assetSearchWhere,
  createSequence,
  exactTagFirst,
  holderHint,
  holdsHint,
  isExactTag,
  rateLimitMessage,
  searchRateDecision,
  serialHint,
} from "./palette";

describe("isExactTag (spec §4: the query equals the tag, case-insensitive, trimmed)", () => {
  it("matches regardless of case and surrounding spaces", () => {
    expect(isExactTag("BR-LT-0148", "BR-LT-0148")).toBe(true);
    expect(isExactTag("BR-LT-0148", "  br-lt-0148 ")).toBe(true);
  });
  it("does not match a prefix or a longer tag", () => {
    expect(isExactTag("BR-LT-0148", "BR-LT-014")).toBe(false);
    expect(isExactTag("BR-LT-01480", "BR-LT-0148")).toBe(false);
    expect(isExactTag("BR-LT-0148", "")).toBe(false);
  });
});

describe("exactTagFirst (spec §4: the exact tag is the first result)", () => {
  const row = (id: string, tag: string) => ({ id, tag });
  it("puts the exact match first and drops its duplicate from the rest", () => {
    const rows = [row("a", "BR-LT-0140"), row("b", "BR-LT-0148"), row("c", "BR-LT-0149")];
    expect(exactTagFirst(row("b", "BR-LT-0148"), rows).map((r) => r.id)).toEqual(["b", "a", "c"]);
  });
  it("adds the exact match even when the contains query did not return it, and keeps the cap", () => {
    const rows = ["1", "2", "3", "4", "5"].map((n) => row(n, `X-${n}`));
    const out = exactTagFirst(row("e", "X"), rows);
    expect(out).toHaveLength(PALETTE_LIMIT);
    expect(out.map((r) => r.id)).toEqual(["e", "1", "2", "3", "4"]);
  });
  it("leaves the order alone when there is no exact match", () => {
    const rows = [row("a", "A"), row("b", "B")];
    expect(exactTagFirst(null, rows)).toEqual(rows);
  });
});

describe("hints (spec §4 copy, verbatim)", () => {
  it("reads serial …, held by {name} and holds {tag}", () => {
    expect(serialHint("5CG7123ABC")).toBe("serial 5CG7123ABC");
    expect(holderHint("Marites Bautista")).toBe("held by Marites Bautista");
    expect(holdsHint("BR-LT-0148")).toBe("holds BR-LT-0148");
  });

  const asset = { tag: "BR-LT-0148", model: "Dell Latitude 5420", serial: "5CG7123ABC", holderName: "Marites Bautista" };
  it("shows no hint when the tag or the model matched — the row already says why", () => {
    expect(assetHint(asset, "0148")).toBeNull();
    expect(assetHint(asset, "latitude")).toBeNull();
  });
  it("shows the serial when the serial matched", () => {
    expect(assetHint(asset, " 5cg7 ")).toBe("serial 5CG7123ABC");
  });
  it("shows the holder when the holder matched", () => {
    expect(assetHint(asset, "marites")).toBe("held by Marites Bautista");
  });
  it("prefers the serial when both the serial and the holder matched", () => {
    expect(assetHint({ ...asset, serial: "MAR-1", holderName: "Mara Cruz" }, "mar")).toBe("serial MAR-1");
  });
  it("shows nothing for an asset with no serial or holder that the query does not name", () => {
    expect(assetHint({ ...asset, serial: null, holderName: null }, "zzz")).toBeNull();
  });
});

describe("assetSearchWhere (spec §4: tag, model, serial and holder name)", () => {
  it("matches all four, case-insensitively", () => {
    const where = assetSearchWhere("5cg");
    expect(where.OR).toEqual([
      { tag: { contains: "5cg", mode: "insensitive" } },
      { model: { contains: "5cg", mode: "insensitive" } },
      { serial: { contains: "5cg", mode: "insensitive" } },
      { assignee: { is: { name: { contains: "5cg", mode: "insensitive" } } } },
    ]);
  });
});

describe("createSequence (review focus #4: an older response never replaces a newer one)", () => {
  it("only the latest ticket is current", () => {
    const seq = createSequence();
    const first = seq.next();
    const second = seq.next();
    expect(seq.isCurrent(second)).toBe(true);
    expect(seq.isCurrent(first)).toBe(false);
  });
  it("a response arriving out of order is ignored", () => {
    const seq = createSequence();
    const shown: string[] = [];
    const a = seq.next(); // "ab"
    const b = seq.next(); // "abc"
    // "abc" answers first, then the slower "ab"
    if (seq.isCurrent(b)) shown.push("abc");
    if (seq.isCurrent(a)) shown.push("ab");
    expect(shown).toEqual(["abc"]);
  });
  it("bumping without a request (closing, clearing) retires every ticket in flight", () => {
    const seq = createSequence();
    const t = seq.next();
    seq.next();
    expect(seq.isCurrent(t)).toBe(false);
  });
  it("two sequences are independent", () => {
    const a = createSequence();
    const b = createSequence();
    a.next();
    a.next();
    expect(b.isCurrent(b.next())).toBe(true);
  });
});

describe("searchRateDecision (the palette's in-memory sliding window)", () => {
  const now = 1_000_000;
  it("allows and records while under the cap", () => {
    const d = searchRateDecision([now - 1000], now);
    expect(d.allowed).toBe(true);
    expect(d.recent).toEqual([now - 1000, now]);
  });
  it("forgets searches older than the window", () => {
    const d = searchRateDecision([now - SEARCH_WINDOW_MS - 1, now - SEARCH_WINDOW_MS], now);
    expect(d.allowed).toBe(true);
    expect(d.recent).toEqual([now]);
  });
  it("refuses at the cap with the seconds until the oldest search leaves the window, and does not record", () => {
    const recent = Array.from({ length: SEARCH_MAX_IN_WINDOW }, (_, i) => now - 7_500 + i);
    const d = searchRateDecision(recent, now);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.retryAfterSec).toBe(3); // the oldest frees in 2.5 s → 3
    expect(d.recent).toHaveLength(SEARCH_MAX_IN_WINDOW);
  });
  it("never says 0 s", () => {
    const recent = Array.from({ length: SEARCH_MAX_IN_WINDOW }, () => now - SEARCH_WINDOW_MS + 1);
    const d = searchRateDecision(recent, now);
    expect(d.allowed === false && d.retryAfterSec).toBe(1);
  });
});

describe("rateLimitMessage (spec §4 copy, verbatim)", () => {
  it("names the seconds", () => {
    expect(rateLimitMessage(7)).toBe("Too many searches just now — try again in 7 s.");
  });
});
