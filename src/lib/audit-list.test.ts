import { describe, expect, it } from "vitest";
import { AUDIT_LIST_CONFIG, buildAuditWhere } from "./audit-list";
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
  it("excludes hidden asset rows only when given ids", () => {
    const state = parse("");
    expect(buildAuditWhere(state)).not.toHaveProperty("NOT");
    expect(buildAuditWhere(state, ["a1"])).toMatchObject({ NOT: { entityType: "asset", entityId: { in: ["a1"] } } });
  });
});
