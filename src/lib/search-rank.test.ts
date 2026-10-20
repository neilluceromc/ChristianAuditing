import { describe, expect, it, vi } from "vitest";
import { prefixFirst, prefixFirstPage, rankFirst, startsWithAny } from "./search-rank";

/* Spec §7.2: while searching, matches that START WITH the text come first, then the ones that only contain it. */

describe("startsWithAny", () => {
  it("is case-insensitive and ignores missing values", () => {
    expect(startsWithAny("e", ["Ella Cruz", null])).toBe(true);
    expect(startsWithAny("E", [null, undefined, "eMP-0042"])).toBe(true);
    expect(startsWithAny("e", ["Joel", "BR-LT-0001", null])).toBe(false);
  });
  it("takes the text literally: % and _ are not wildcards", () => {
    expect(startsWithAny("a_", ["abc"])).toBe(false);
    expect(startsWithAny("%", ["abc"])).toBe(false);
    expect(startsWithAny("a_", ["a_b"])).toBe(true);
  });
  it("trims the search, and an empty search ranks nothing first", () => {
    expect(startsWithAny("  el ", ["Ella"])).toBe(true);
    expect(startsWithAny("", ["Ella"])).toBe(false);
  });
});

describe("prefixFirst and rankFirst", () => {
  it("moves the starts-with rows first, each group keeping its order", () => {
    const rows = ["Joel", "Ella", "Rene", "Eve", "Abe"];
    expect(prefixFirst(rows, (r) => startsWithAny("e", [r]))).toEqual(["Ella", "Eve", "Joel", "Rene", "Abe"]);
  });
  it("ranks by tier, lowest first, each tier keeping its order", () => {
    const rows = ["c2", "a1", "b9", "a2", "c1", "b1"];
    expect(rankFirst(rows, (r) => ({ a: 0, b: 1, c: 2 })[r[0] as "a" | "b" | "c"])).toEqual(["a1", "a2", "b9", "b1", "c2", "c1"]);
  });
});

/** An in-memory "table" in the list's chosen order, read the way the Prisma reads read it: an id filter, skip, take. */
function table(names: string[]) {
  const rows = names.map((name, i) => ({ id: `id${i}`, name }));
  const fetch = vi.fn(async (ids: { in: string[] } | { notIn: string[] } | null, w: { skip: number; take: number }) => {
    const kept = rows.filter((r) => ids === null || ("in" in ids ? ids.in.includes(r.id) : !ids.notIn.includes(r.id)));
    return kept.slice(w.skip, w.skip + w.take);
  });
  return { rows, fetch };
}

describe("prefixFirstPage", () => {
  // The chosen sort (say, name Z–A) puts these in this order; "E" matches all of them.
  const names = ["Zoe Bell", "Rene", "Mike Eden", "Ella", "Dee", "Eve", "Abe", "Edgar"];
  const { rows, fetch } = table(names);
  const prefixIds = rows.filter((r) => startsWithAny("E", [r.name])).map((r) => r.id);
  const expected = ["Ella", "Eve", "Edgar", "Zoe Bell", "Rene", "Mike Eden", "Dee", "Abe"];

  it("every page window reads the starts-with group first, then the rest, each in the chosen sort", async () => {
    for (const take of [1, 2, 3, 5, 8, 10]) {
      const seen: string[] = [];
      for (let skip = 0; skip < names.length; skip += take) {
        const page = await prefixFirstPage([prefixIds], names.length, { skip, take }, fetch);
        seen.push(...page.map((r) => r.name));
      }
      expect(seen, `take ${take}`).toEqual(expected);
    }
  });

  it("with no starts-with match it is one plain read", async () => {
    fetch.mockClear();
    const page = await prefixFirstPage([[]], names.length, { skip: 0, take: 3 }, fetch);
    expect(page.map((r) => r.name)).toEqual(["Zoe Bell", "Rene", "Mike Eden"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(null, { skip: 0, take: 3 });
  });

  it("with tiers (name starts, then employee no. starts), every window reads tier by tier, then the rest", async () => {
    const tier0 = rows.filter((r) => startsWithAny("E", [r.name])).map((r) => r.id); // Ella, Eve, Edgar
    const tier1 = [rows[0].id, rows[6].id]; // Zoe Bell, Abe: say their employee nos. start with E
    const want = ["Ella", "Eve", "Edgar", "Zoe Bell", "Abe", "Rene", "Mike Eden", "Dee"];
    for (const take of [1, 2, 3, 4, 8]) {
      const seen: string[] = [];
      for (let skip = 0; skip < names.length; skip += take) {
        seen.push(...(await prefixFirstPage([tier0, tier1], names.length, { skip, take }, fetch)).map((r) => r.name));
      }
      expect(seen, `take ${take}`).toEqual(want);
    }
    fetch.mockClear();
    await prefixFirstPage([tier0, tier1], names.length, { skip: 5, take: 3 }, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith({ notIn: [...tier0, ...tier1] }, { skip: 0, take: 3 });
  });

  it("reads only the group(s) the window touches", async () => {
    fetch.mockClear();
    await prefixFirstPage([prefixIds], names.length, { skip: 0, take: 2 }, fetch);
    expect(fetch).toHaveBeenCalledTimes(1); // inside the starts-with group
    fetch.mockClear();
    await prefixFirstPage([prefixIds], names.length, { skip: 4, take: 2 }, fetch);
    expect(fetch).toHaveBeenCalledTimes(1); // inside the rest
    expect(fetch).toHaveBeenCalledWith({ notIn: prefixIds }, { skip: 1, take: 2 });
    fetch.mockClear();
    const all = ["Ella", "Eve", "Edgar"];
    const t = table(all);
    await prefixFirstPage([t.rows.map((r) => r.id)], all.length, { skip: 0, take: 25 }, t.fetch);
    expect(t.fetch).toHaveBeenCalledTimes(1); // everything starts with it: no read of an empty rest
  });
});
