import { describe, expect, it } from "vitest";
import { buildStockItemWhere, buildStockOrderBy, STOCK_LIST_CONFIG } from "./stock-list";
import type { ListState } from "./url-state";

const st = (over: Partial<ListState> = {}): ListState => ({ q: "", page: 1, sort: STOCK_LIST_CONFIG.defaultSort, filters: {}, ...over });

describe("buildStockItemWhere (spec §4.1-style list rules)", () => {
  it("hides archived items by default and shows only them under archived=1", () => {
    expect(buildStockItemWhere(st())).toEqual({ archivedAt: null });
    expect(buildStockItemWhere(st({ filters: { archived: ["1"] } }))).toEqual({ archivedAt: { not: null } });
  });
  it("searches code and name case-insensitively", () => {
    const w = buildStockItemWhere(st({ q: "ball" }));
    expect(w.OR).toEqual([
      { code: { contains: "ball", mode: "insensitive" } },
      { name: { contains: "ball", mode: "insensitive" } },
    ]);
  });
  it("applies the category facet as an IN list", () => {
    const w = buildStockItemWhere(st({ filters: { category: ["c1"] } }));
    expect(w.categoryId).toEqual({ in: ["c1"] });
  });
  it("leaves the low facet out of the where — it is derived from balances after the query", () => {
    const w = buildStockItemWhere(st({ filters: { low: ["1"] } }));
    expect(w).not.toHaveProperty("low");
    expect(w).toEqual({ archivedAt: null });
  });
});

describe("buildStockOrderBy", () => {
  it("defaults to code asc, plus the id tiebreaker", () => {
    expect(buildStockOrderBy([])).toEqual([{ code: "asc" }, { id: "asc" }]);
  });
  it("name desc", () => {
    expect(buildStockOrderBy([{ key: "name", dir: "desc" }])).toEqual([{ name: "desc" }, { id: "asc" }]);
  });
  it("ignores an unknown sort key", () => {
    expect(buildStockOrderBy([{ key: "bogus", dir: "asc" }])).toEqual([{ id: "asc" }]);
  });
  it("always ends with the id tiebreaker", () => {
    const order = buildStockOrderBy([{ key: "code", dir: "asc" }]);
    expect(order[order.length - 1]).toEqual({ id: "asc" });
  });
});
