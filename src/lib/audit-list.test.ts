import { describe, expect, it } from "vitest";
import { AUDIT_ENTITY_TYPES, AUDIT_LIST_CONFIG, NO_HIDDEN_REFS, buildAuditWhere } from "./audit-list";
import { parseListState } from "./url-state";

const parse = (qs: string) => parseListState(new URLSearchParams(qs), AUDIT_LIST_CONFIG);

describe("buildAuditWhere", () => {
  it("empty → empty", () => {
    expect(buildAuditWhere(parse(""))).toEqual({});
  });
  it("q searches action, entityId and actorLabel", () => {
    expect(buildAuditWhere(parse("q=SECRET"))).toEqual({
      OR: [
        { action: { contains: "SECRET", mode: "insensitive" } },
        { entityId: { contains: "SECRET", mode: "insensitive" } },
        { actorLabel: { contains: "SECRET", mode: "insensitive" } },
      ],
    });
  });
  it("entity facet filters entityType", () => {
    expect(buildAuditWhere(parse("entity=asset,employee")).entityType).toEqual({ in: ["asset", "employee"] });
  });
  it("lists the four Phase 27 entity types the page already renders", () => {
    expect(AUDIT_ENTITY_TYPES).toEqual(expect.arrayContaining(["vendor", "stock-item", "stock-category", "stocktake"]));
  });
  it("hides class-bearing rows per entity type, and emits no clause when nothing is hidden", () => {
    const state = parse("");
    expect(buildAuditWhere(state)).not.toHaveProperty("NOT");
    expect(buildAuditWhere(state, NO_HIDDEN_REFS)).not.toHaveProperty("NOT");
    expect(buildAuditWhere(state, { ...NO_HIDDEN_REFS, assetIds: ["a1"] })).toMatchObject({
      NOT: { OR: [{ entityType: "asset", entityId: { in: ["a1"] } }] },
    });
    expect(buildAuditWhere(state, { ...NO_HIDDEN_REFS, approvalIds: ["p1"] }).NOT).toEqual({ OR: [{ entityType: "approval", entityId: { in: ["p1"] } }] });
    expect(buildAuditWhere(state, { ...NO_HIDDEN_REFS, categoryIds: ["c1"] }).NOT).toEqual({ OR: [{ entityType: "asset-category", entityId: { in: ["c1"] } }] });
    expect(buildAuditWhere(state, { ...NO_HIDDEN_REFS, typeIds: ["t1"] }).NOT).toEqual({ OR: [{ entityType: "asset-type", entityId: { in: ["t1"] } }] });
    expect(buildAuditWhere(state, { assetIds: ["a1"], approvalIds: ["p1"], categoryIds: [], typeIds: ["t1"] }).NOT).toEqual({
      OR: [
        { entityType: "asset", entityId: { in: ["a1"] } },
        { entityType: "approval", entityId: { in: ["p1"] } },
        { entityType: "asset-type", entityId: { in: ["t1"] } },
      ],
    });
  });
});
