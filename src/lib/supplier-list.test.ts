import { describe, expect, it, vi } from "vitest";
import { buildSupplierWhere, SUPPLIER_LIST_CONFIG } from "./supplier-list";
import { parseListState, serializeListState, type ListState } from "./url-state";

const st = (over: Partial<ListState> = {}): ListState => ({ q: "", page: 1, per: 25, sort: SUPPLIER_LIST_CONFIG.defaultSort, filters: {}, ...over });

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

describe("renewing=30 (Phase 46 spec §4.3: contractEnd within 30 days)", () => {
  it("is contractEnd from today to today + 30, both Manila days inclusive (stored as UTC-midnight days)", () => {
    const w = buildSupplierWhere(st({ filters: { renewing: ["30"] } }), "2026-10-20");
    expect(w).toEqual({
      archivedAt: null,
      contractEnd: { gte: new Date("2026-10-20T00:00:00.000Z"), lte: new Date("2026-11-19T00:00:00.000Z") },
    });
  });
  it("defaults today to the Manila day: 23:30 UTC on the 19th is already the 20th in Manila", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T23:30:00Z"));
    try {
      expect(buildSupplierWhere(st({ filters: { renewing: ["30"] } })).contractEnd)
        .toEqual({ gte: new Date("2026-10-20T00:00:00.000Z"), lte: new Date("2026-11-19T00:00:00.000Z") });
    } finally {
      vi.useRealTimers();
    }
  });
  it("parses only renewing=30 from the URL, and combines with the other facets", () => {
    expect(parseListState(new URLSearchParams("renewing=30"), SUPPLIER_LIST_CONFIG).filters).toEqual({ renewing: ["30"] });
    expect(parseListState(new URLSearchParams("renewing=7"), SUPPLIER_LIST_CONFIG).filters).toEqual({});
    const w = buildSupplierWhere(st({ filters: { renewing: ["30"], contract: ["ACTIVE"] } }), "2026-10-20");
    expect(w.contractStatus).toEqual({ in: ["ACTIVE"] });
    expect(w.contractEnd).toBeDefined();
  });
  it("round-trips through the URL", () => {
    const state = parseListState(new URLSearchParams("renewing=30"), SUPPLIER_LIST_CONFIG);
    expect(serializeListState(state, SUPPLIER_LIST_CONFIG)).toBe("?renewing=30");
  });
  it("leaves contractEnd alone without the filter", () => {
    expect(buildSupplierWhere(st(), "2026-10-20").contractEnd).toBeUndefined();
  });
});
