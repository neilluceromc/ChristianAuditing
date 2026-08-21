import { describe, expect, it } from "vitest";
import {
  ASSET_STATUSES, buildAssetOrderBy, buildAssetWhere, INVENTORY_LIST_CONFIG,
  parsePurchaseYear, purchaseYearChips, withPurchaseYearQS,
} from "./inventory-list";
import { parseListState } from "./url-state";

const parse = (qs: string) => parseListState(new URLSearchParams(qs), INVENTORY_LIST_CONFIG);

describe("buildAssetWhere", () => {
  it("empty state → empty where", () => {
    expect(buildAssetWhere(parse(""))).toEqual({});
  });
  it("q searches tag, model and serial (contains, insensitive — NOT equals)", () => {
    expect(buildAssetWhere(parse("q=latitude"))).toEqual({
      OR: [
        { tag: { contains: "latitude", mode: "insensitive" } },
        { model: { contains: "latitude", mode: "insensitive" } },
        { serial: { contains: "latitude", mode: "insensitive" } },
      ],
    });
  });
  it("maps facets to in-filters and silently drops invalid statuses", () => {
    const where = buildAssetWhere(parse("status=DEPLOYED,HACKED&category=c1&type=t1,t2&assignee=e1"));
    expect(where.status).toEqual({ in: ["DEPLOYED"] });
    expect(where.categoryId).toEqual({ in: ["c1"] });
    expect(where.typeId).toEqual({ in: ["t1", "t2"] });
    expect(where.assigneeId).toEqual({ in: ["e1"] });
  });
  it("all-invalid status facet filters nothing rather than everything", () => {
    expect(buildAssetWhere(parse("status=HACKED")).status).toBeUndefined();
  });
});

describe("buildAssetOrderBy", () => {
  it("defaults to tag asc", () => {
    expect(buildAssetOrderBy([])).toEqual([{ tag: "asc" }]);
  });
  it("category sorts through the relation name", () => {
    expect(buildAssetOrderBy([{ key: "category", dir: "desc" }, { key: "model", dir: "asc" }]))
      .toEqual([{ category: { name: "desc" } }, { model: "asc" }]);
  });
});

it("ASSET_STATUSES covers all 8 enum values", () => {
  expect(ASSET_STATUSES).toHaveLength(8);
  expect(ASSET_STATUSES).toContain("MISSING");
});

describe("the stage facet narrows to the repair candidate set", () => {
  it("any known stage adds the candidate clause — the final cut is repairStage's", () => {
    expect(buildAssetWhere(parse("stage=beyond-repair")).AND).toEqual([
      { OR: [{ status: "DEFECTIVE" }, { defectiveSince: { not: null } }] },
    ]);
  });

  it("an unknown stage narrows nothing", () => {
    expect(buildAssetWhere(parse("stage=sort-of-broken")).AND).toBeUndefined();
  });

  it("stage rides alongside q without eating its OR", () => {
    const where = buildAssetWhere(parse("q=dell&stage=at-vendor"));
    expect(where.OR).toHaveLength(3);
    expect(where.AND).toHaveLength(1);
  });

  it("stage is a configured facet, so the URL round-trips it", () => {
    expect(parse("stage=at-vendor").filters.stage).toEqual(["at-vendor"]);
  });

  it("defectiveSince is sortable — the Down column is a real header", () => {
    expect(INVENTORY_LIST_CONFIG.sortable).toContain("defectiveSince");
    expect(parse("sort=defectiveSince").sort).toEqual([{ key: "defectiveSince", dir: "asc" }]);
  });
});

describe("purchaseYear filter on buildAssetWhere", () => {
  // Not registered in INVENTORY_LIST_CONFIG.facets — a single value naming a
  // nav destination (the year chips), same shape as ?state= on /purchases —
  // so it is not part of `state.filters` and buildAssetWhere takes it as its
  // own argument.
  it("does not appear in the parsed facets", () => {
    expect(parse("purchaseYear=2026").filters.purchaseYear).toBeUndefined();
  });

  it("a year narrows to the UTC calendar year", () => {
    expect(buildAssetWhere(parse(""), 2026).purchasedAt).toEqual({
      gte: new Date(Date.UTC(2026, 0, 1)),
      lt: new Date(Date.UTC(2027, 0, 1)),
    });
  });

  // Genuinely nullable in the schema, and exactly the assets a year filter
  // would otherwise hide forever.
  it("'none' narrows to assets with no purchase date at all", () => {
    expect(buildAssetWhere(parse(""), "none").purchasedAt).toBeNull();
  });

  it("omitted or null leaves purchasedAt untouched", () => {
    expect(buildAssetWhere(parse(""))).toEqual({});
    expect(buildAssetWhere(parse(""), null)).toEqual({});
  });

  it("rides alongside other facets and q without disturbing them", () => {
    const where = buildAssetWhere(parse("q=dell&status=SPARE"), 2025);
    expect(where.OR).toHaveLength(3);
    expect(where.status).toEqual({ in: ["SPARE"] });
    expect(where.purchasedAt).toEqual({
      gte: new Date(Date.UTC(2025, 0, 1)),
      lt: new Date(Date.UTC(2026, 0, 1)),
    });
  });
});

describe("parsePurchaseYear", () => {
  it("accepts a 4-digit year", () => {
    expect(parsePurchaseYear("2026")).toBe(2026);
  });

  it("accepts the literal 'none'", () => {
    expect(parsePurchaseYear("none")).toBe("none");
  });

  it("rejects garbage rather than throwing, same as the other facet parsers", () => {
    expect(parsePurchaseYear("abc")).toBeNull();
    expect(parsePurchaseYear("20266")).toBeNull();
    expect(parsePurchaseYear("")).toBeNull();
  });

  it("null/undefined (param absent) parses to null", () => {
    expect(parsePurchaseYear(null)).toBeNull();
    expect(parsePurchaseYear(undefined)).toBeNull();
  });
});

describe("purchaseYearChips", () => {
  it("is newest-first, because a recent year is the likelier filter", () => {
    const chips = purchaseYearChips([{ year: 2024, count: 9 }, { year: 2026, count: 4 }]);
    expect(chips.map((c) => c.year)).toEqual([2026, 2024]);
  });

  it("carries the count, so a chip can be sized to it", () => {
    expect(purchaseYearChips([{ year: 2026, count: 4 }])[0].count).toBe(4);
  });

  // A NULL purchasedAt is a real state in this schema and those assets are
  // exactly the ones a year filter would hide forever.
  it("keeps a bucket for assets with no purchase date, and puts it last", () => {
    const chips = purchaseYearChips([{ year: 2026, count: 4 }, { year: null, count: 2 }]);
    expect(chips[chips.length - 1]).toEqual({ year: null, count: 2, label: "No date", href: "/inventory?purchaseYear=none" });
  });

  it("returns nothing for an empty fleet rather than a single empty chip", () => {
    expect(purchaseYearChips([])).toEqual([]);
  });

  it("builds a plain href naming the numeric year", () => {
    expect(purchaseYearChips([{ year: 2025, count: 1 }])[0].href).toBe("/inventory?purchaseYear=2025");
  });
});

describe("withPurchaseYearQS", () => {
  it("appends as the first param when the existing qs is empty", () => {
    expect(withPurchaseYearQS("", 2026)).toBe("?purchaseYear=2026");
  });

  it("appends with & when other params are already present", () => {
    expect(withPurchaseYearQS("?status=SPARE", 2026)).toBe("?status=SPARE&purchaseYear=2026");
  });

  it("serializes the 'none' bucket as the literal string", () => {
    expect(withPurchaseYearQS("?status=SPARE", "none")).toBe("?status=SPARE&purchaseYear=none");
  });

  it("passes the qs through unchanged when there is nothing to add", () => {
    expect(withPurchaseYearQS("?status=SPARE", null)).toBe("?status=SPARE");
  });
});
