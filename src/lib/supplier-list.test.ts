import { describe, expect, it } from "vitest";
import { buildSupplierWhere, SUPPLIER_LIST_CONFIG } from "./supplier-list";
import type { ListState } from "./url-state";

const st = (over: Partial<ListState> = {}): ListState => ({ q: "", page: 1, sort: SUPPLIER_LIST_CONFIG.defaultSort, filters: {}, ...over });

describe("buildSupplierWhere (spec §4.1)", () => {
  it("hides archived suppliers by default and shows only them under archived=1", () => {
    expect(buildSupplierWhere(st())).toEqual({ archivedAt: null });
    expect(buildSupplierWhere(st({ filters: { archived: ["1"] } }))).toEqual({ archivedAt: { not: null } });
  });
  it("searches four text columns case-insensitively", () => {
    const w = buildSupplierWhere(st({ q: "rina" }));
    expect(w.OR).toHaveLength(4);
    expect(w.OR?.[0]).toEqual({ name: { contains: "rina", mode: "insensitive" } });
  });
  it("applies category and contract facets as IN lists", () => {
    const w = buildSupplierWhere(st({ filters: { category: ["Furniture"], contract: ["ACTIVE", "EXPIRED"] } }));
    expect(w.category).toEqual({ in: ["Furniture"] });
    expect(w.contractStatus).toEqual({ in: ["ACTIVE", "EXPIRED"] });
  });
  it("drops a contract value that is not a status", () => {
    expect(buildSupplierWhere(st({ filters: { contract: ["BOGUS"] } })).contractStatus).toBeUndefined();
  });
});
