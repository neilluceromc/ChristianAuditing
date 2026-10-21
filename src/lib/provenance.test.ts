import { describe, expect, it } from "vitest";
import { parseProvenance, provenanceOf, provenanceWhere, PROVENANCES } from "./provenance";

describe("provenance (spec §6)", () => {
  it("derives the three values", () => {
    expect(provenanceOf({ purchaseOrderId: "pr1", importedAt: null })).toBe("PURCHASE_REQUEST");
    expect(provenanceOf({ purchaseOrderId: "pr1", importedAt: new Date() })).toBe("PURCHASE_REQUEST");
    expect(provenanceOf({ purchaseOrderId: null, importedAt: new Date() })).toBe("HISTORICAL");
    expect(provenanceOf({ purchaseOrderId: null, importedAt: null })).toBe("DIRECT");
  });
  it("where shapes partition the table", () => {
    expect(provenanceWhere("PURCHASE_REQUEST")).toEqual({ purchaseOrderId: { not: null } });
    expect(provenanceWhere("DIRECT")).toEqual({ purchaseOrderId: null, importedAt: null });
    expect(provenanceWhere("HISTORICAL")).toEqual({ purchaseOrderId: null, importedAt: { not: null } });
  });
  it("parses only the three names", () => {
    for (const p of PROVENANCES) expect(parseProvenance(p)).toBe(p);
    expect(parseProvenance("direct")).toBeNull();
    expect(parseProvenance(undefined)).toBeNull();
  });
});
