import { describe, expect, it } from "vitest";
import { ACTIVITY_FEEDS, ACTIVITY_LIST_CONFIG, buildActivityWhere, feedWhere } from "./activity-list";
import { NO_HIDDEN_REFS } from "./audit-list";

const empty = { q: "", page: 1, sort: [], filters: {} };

describe("the activity feeds' list rules (spec §3.4)", () => {
  it("names the four feeds and one facet, no sort, no search", () => {
    expect(ACTIVITY_FEEDS).toEqual(["inventory", "employees", "finance", "purchases"]);
    expect(ACTIVITY_LIST_CONFIG).toEqual({ facets: ["action"], sortable: [], defaultSort: [] });
  });
  it("keeps each feed's base predicate", () => {
    expect(feedWhere("inventory", NO_HIDDEN_REFS)).toEqual({ entityType: "asset" });
    expect(feedWhere("employees", NO_HIDDEN_REFS)).toEqual({ entityType: "employee" });
    expect(feedWhere("purchases", NO_HIDDEN_REFS)).toEqual({ entityType: "purchase-request" });
    const finance = feedWhere("finance", NO_HIDDEN_REFS);
    expect(finance.OR).toHaveLength(2);
    expect(finance.OR?.[0]).toEqual({ entityType: "purchase-request" });
    expect(finance.OR?.[1]).toMatchObject({ entityType: "asset", diff: { path: ["cost"] } });
  });
  it("hides the assets a role cannot see, in the inventory feed and finance's asset branch", () => {
    const hidden = { ...NO_HIDDEN_REFS, assetIds: ["a1", "a2"] };
    expect(feedWhere("inventory", hidden)).toEqual({ entityType: "asset", entityId: { notIn: ["a1", "a2"] } });
    expect(feedWhere("finance", hidden).OR?.[1]).toMatchObject({ entityType: "asset", entityId: { notIn: ["a1", "a2"] } });
    expect(feedWhere("employees", hidden)).toEqual({ entityType: "employee" });
  });
  it("layers the action facet on top, and is the bare base without it", () => {
    expect(buildActivityWhere("employees", empty, NO_HIDDEN_REFS)).toEqual({ entityType: "employee" });
    expect(buildActivityWhere("inventory", { ...empty, filters: { action: ["lifecycle.assign", "create"] } }, NO_HIDDEN_REFS)).toEqual({
      AND: [{ entityType: "asset" }, { action: { in: ["lifecycle.assign", "create"] } }],
    });
  });
});
