import { describe, expect, it } from "vitest";
import {
  parseListState, serializeListState, toggleSort, withFilter, withSearch,
  clearFilters, toSearchParams, type ListConfig,
} from "./url-state";

const config: ListConfig = {
  facets: ["status", "category"],
  sortable: ["tag", "model", "purchasedAt"],
  defaultSort: [{ key: "tag", dir: "asc" }],
};

const parse = (qs: string) => parseListState(new URLSearchParams(qs), config);

describe("parseListState", () => {
  it("returns defaults for an empty query", () => {
    expect(parse("")).toEqual({ q: "", page: 1, sort: [{ key: "tag", dir: "asc" }], filters: {} });
  });
  it("parses q, page, comma-joined facets and the sort param", () => {
    expect(parse("q=latitude&page=3&status=DEPLOYED,SPARE&sort=-purchasedAt,model")).toEqual({
      q: "latitude",
      page: 3,
      sort: [{ key: "purchasedAt", dir: "desc" }, { key: "model", dir: "asc" }],
      filters: { status: ["DEPLOYED", "SPARE"] },
    });
  });
  it("drops unknown facets, unknown sort keys, and clamps bad pages", () => {
    const s = parse("evil=1&sort=-hax,tag&page=0");
    expect(s.filters).toEqual({});
    expect(s.sort).toEqual([{ key: "tag", dir: "asc" }]);
    expect(s.page).toBe(1);
  });
  it("caps sort at two keys", () => {
    expect(parse("sort=tag,model,purchasedAt").sort).toHaveLength(2);
  });
});

describe("serializeListState", () => {
  it("omits defaults entirely", () => {
    expect(serializeListState(parse(""), config)).toBe("");
  });
  it("round-trips a full state", () => {
    const qs = "?q=latitude&status=DEPLOYED,SPARE&sort=-purchasedAt,model&page=3";
    expect(serializeListState(parse(qs.slice(1)), config)).toBe(qs);
  });
});

describe("toggleSort", () => {
  const def = [{ key: "tag", dir: "asc" as const }];
  it("new key becomes primary asc and demotes the old primary", () => {
    expect(toggleSort(def, "model")).toEqual([
      { key: "model", dir: "asc" }, { key: "tag", dir: "asc" },
    ]);
  });
  it("primary asc flips to desc", () => {
    expect(toggleSort(def, "tag")).toEqual([{ key: "tag", dir: "desc" }]);
  });
  it("primary desc is removed and the secondary promotes", () => {
    expect(toggleSort([{ key: "tag", dir: "desc" }, { key: "model", dir: "asc" }], "tag"))
      .toEqual([{ key: "model", dir: "asc" }]);
  });
  it("secondary promotes to primary keeping its direction", () => {
    expect(toggleSort([{ key: "tag", dir: "asc" }, { key: "model", dir: "desc" }], "model"))
      .toEqual([{ key: "model", dir: "desc" }, { key: "tag", dir: "asc" }]);
  });
  it("never exceeds two keys", () => {
    expect(toggleSort([{ key: "tag", dir: "asc" }, { key: "model", dir: "asc" }], "purchasedAt"))
      .toEqual([{ key: "purchasedAt", dir: "asc" }, { key: "tag", dir: "asc" }]);
  });
});

describe("state updates reset the page", () => {
  it("withFilter replaces one facet and resets page", () => {
    const s = withFilter(parse("page=4&status=SPARE"), "status", ["DEPLOYED"]);
    expect(s.filters.status).toEqual(["DEPLOYED"]);
    expect(s.page).toBe(1);
  });
  it("withSearch sets q and resets page", () => {
    const s = withSearch(parse("page=4"), "dell");
    expect(s.q).toBe("dell");
    expect(s.page).toBe(1);
  });
  it("clearFilters drops filters and q but keeps sort", () => {
    const s = clearFilters(parse("q=x&status=SPARE&sort=-model"));
    expect(s.filters).toEqual({});
    expect(s.q).toBe("");
    expect(s.sort).toEqual([{ key: "model", dir: "desc" }]);
  });
});

describe("toSearchParams", () => {
  it("converts Next's searchParams record (last value wins for arrays)", () => {
    const sp = toSearchParams({ q: "x", status: ["a", "b"], gone: undefined });
    expect(sp.get("q")).toBe("x");
    expect(sp.get("status")).toBe("b");
    expect(sp.has("gone")).toBe(false);
  });
});
