import { describe, expect, it } from "vitest";
import { parseProvenance, provenanceOf, provenanceWhere, PROVENANCES } from "./provenance";

describe("provenance (spec §6)", () => {
  it("derives the three values", () => {
    expect(provenanceOf({ purchaseRequestId: "pr1", importedAt: null })).toBe("PURCHASE_REQUEST");
    expect(provenanceOf({ purchaseRequestId: "pr1", importedAt: new Date() })).toBe("PURCHASE_REQUEST");
    expect(provenanceOf({ purchaseRequestId: null, importedAt: new Date() })).toBe("HISTORICAL");
    expect(provenanceOf({ purchaseRequestId: null, importedAt: null })).toBe("DIRECT");
  });
  it("where shapes partition the table", () => {
    expect(provenanceWhere("PURCHASE_REQUEST")).toEqual({ purchaseRequestId: { not: null } });
    expect(provenanceWhere("DIRECT")).toEqual({ purchaseRequestId: null, importedAt: null });
    expect(provenanceWhere("HISTORICAL")).toEqual({ purchaseRequestId: null, importedAt: { not: null } });
  });
  it("parses only the three names", () => {
    for (const p of PROVENANCES) expect(parseProvenance(p)).toBe(p);
    expect(parseProvenance("direct")).toBeNull();
    expect(parseProvenance(undefined)).toBeNull();
  });
});
