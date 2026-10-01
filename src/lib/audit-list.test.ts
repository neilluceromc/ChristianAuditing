import { describe, expect, it } from "vitest";
import { AUDIT_ENTITY_TYPES, AUDIT_LIST_CONFIG, NO_HIDDEN_REFS, buildAuditWhere, whenRange, WHEN_LABEL } from "./audit-list";
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

describe("whenRange (Manila calendar)", () => {
  it("today, 7d, 30d start at Manila midnight; anything else is no filter", () => {
    expect(whenRange("today", "2026-09-25")).toEqual({ gte: new Date("2026-09-25T00:00:00+08:00") });
    expect(whenRange("7d", "2026-09-25")).toEqual({ gte: new Date("2026-09-19T00:00:00+08:00") });
    expect(whenRange("30d", "2026-09-25")).toEqual({ gte: new Date("2026-08-27T00:00:00+08:00") });
    expect(whenRange(undefined, "2026-09-25")).toBeNull();
    expect(whenRange("year", "2026-09-25")).toBeNull();
    expect(WHEN_LABEL).toEqual({ today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" });
  });
});

describe("buildAuditWhere — resolved matches and When", () => {
  const state = (q: string, when?: string) => ({ q, page: 1, sort: [], filters: (when ? { when: [when] } : {}) as Record<string, string[]> });
  it("q matches action, entityId, actor, and the resolved entity ids", () => {
    const w = buildAuditWhere(state("dennis"), NO_HIDDEN_REFS, ["e1", "a2"]);
    expect(JSON.stringify(w)).toContain('"entityId":{"in":["e1","a2"]}');
    expect(JSON.stringify(w)).toContain('"actorLabel"');
  });
  it("when narrows createdAt", () => {
    const w = buildAuditWhere(state("", "today"), NO_HIDDEN_REFS, [], "2026-09-25");
    expect(JSON.stringify(w)).toContain('"createdAt":{"gte":"2026-09-24T16:00:00.000Z"}');
  });
});
