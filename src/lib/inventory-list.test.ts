import { describe, expect, it } from "vitest";
import { ASSET_STATUSES, buildAssetOrderBy, buildAssetWhere, INVENTORY_LIST_CONFIG } from "./inventory-list";
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
