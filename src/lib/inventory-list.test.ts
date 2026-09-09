import { describe, expect, it } from "vitest";
import {
  ASSET_STATUSES, buildAssetOrderBy, buildAssetWhere, INVENTORY_LIST_CONFIG,
  parsePurchaseYear, purchaseYearChips, withPurchaseYearQS,
} from "./inventory-list";
import { parseListState } from "./url-state";
import { STATUSES_BY_CLASS } from "./asset-class";

const parse = (qs: string) => parseListState(new URLSearchParams(qs), INVENTORY_LIST_CONFIG);

describe("buildAssetWhere", () => {
  it("empty state → IT-scoped where (cls defaults to IT — Phase 13)", () => {
    expect(buildAssetWhere(parse(""))).toEqual({ cls: "IT" });
  });
  it("q searches tag, model and serial (contains, insensitive — NOT equals)", () => {
    expect(buildAssetWhere(parse("q=latitude"))).toEqual({
      cls: "IT",
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
  it("provenance facet ORs the derived shapes inside AND, displacing nothing", () => {
    const w = buildAssetWhere({ q: "", page: 1, sort: [], filters: { provenance: ["DIRECT", "HISTORICAL"], status: ["SPARE"] } });
    expect(w.status).toEqual({ in: ["SPARE"] });
    expect(w.AND).toEqual([{ OR: [
      { purchaseRequestId: null, importedAt: null },
      { purchaseRequestId: null, importedAt: { not: null } },
    ] }]);
  });
  it("ignores an unknown provenance value", () => {
    expect(buildAssetWhere({ q: "", page: 1, sort: [], filters: { provenance: ["nope"] } }).AND).toBeUndefined();
  });
});

describe("buildAssetOrderBy", () => {
  it("defaults to tag asc, plus the id tiebreaker", () => {
    expect(buildAssetOrderBy([])).toEqual([{ tag: "asc" }, { id: "asc" }]);
  });
  it("category sorts through the relation name, plus the id tiebreaker", () => {
    expect(buildAssetOrderBy([{ key: "category", dir: "desc" }, { key: "model", dir: "asc" }]))
      .toEqual([{ category: { name: "desc" } }, { model: "asc" }, { id: "asc" }]);
  });
  it("buildAssetOrderBy ends with the id tiebreaker", () => {
    const order = buildAssetOrderBy([{ key: "tag", dir: "asc" }]);
    expect(order[order.length - 1]).toEqual({ id: "asc" });
    expect(buildAssetOrderBy([])[buildAssetOrderBy([]).length - 1]).toEqual({ id: "asc" });
  });
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
    expect(buildAssetWhere(parse(""))).toEqual({ cls: "IT" });
    expect(buildAssetWhere(parse(""), null)).toEqual({ cls: "IT" });
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

  // The regex rejects these by construction, but pinning it means a later
  // "simplify this to parseInt" refactor fails loudly instead of silently
  // accepting a year no fleet could ever have a purchase date in.
  it("rejects '0' and negative numbers, not just non-numeric strings", () => {
    expect(parsePurchaseYear("0")).toBeNull();
    expect(parsePurchaseYear("-1")).toBeNull();
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

describe("buildAssetWhere — class (Phase 13)", () => {
  const empty = { q: "", page: 1, sort: [], filters: {} };
  it("defaults to IT, so every pre-Phase-13 URL means what it used to", () => {
    expect(buildAssetWhere(empty).cls).toBe("IT");
    expect(buildAssetWhere(empty, null).cls).toBe("IT");
  });
  it("filters to the requested class", () => {
    expect(buildAssetWhere(empty, null, "PURCHASING").cls).toBe("PURCHASING");
  });
  it("a status filter outside the class is dropped, not passed through", () => {
    // ?status=SPARE on the Purchasing view is a stale link, not a query
    const w = buildAssetWhere({ ...empty, filters: { status: ["SPARE", "STORED"] } }, null, "PURCHASING");
    expect(w.status).toEqual({ in: ["STORED"] });
  });
  it("ASSET_STATUSES is now every status of both classes", () => {
    expect(ASSET_STATUSES).toHaveLength(14);
    expect(ASSET_STATUSES).toEqual([...STATUSES_BY_CLASS.IT, ...STATUSES_BY_CLASS.PURCHASING]);
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
