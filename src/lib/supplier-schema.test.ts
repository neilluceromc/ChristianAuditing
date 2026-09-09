import { describe, expect, it } from "vitest";
import { supplierSchema, toSupplierData, VENDOR_CONTRACT_STATUSES } from "./supplier-schema";

const base = { name: "Acme", contractStatus: "NONE" as const };

describe("supplierSchema (spec §4.3)", () => {
  it("requires a name and trims it", () => {
    expect(supplierSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
    expect(supplierSchema.parse({ ...base, name: "  Acme " }).name).toBe("Acme");
  });
  it("email is optional but must be an email when present", () => {
    expect(supplierSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
    expect(supplierSchema.parse({ ...base, email: "" }).email).toBe("");
    expect(supplierSchema.parse({ ...base, email: "a@b.ph" }).email).toBe("a@b.ph");
  });
  it("refuses an end date before the start", () => {
    const r = supplierSchema.safeParse({ ...base, contractStart: "2026-02-01", contractEnd: "2026-01-01" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["contractEnd"]);
  });
  it("accepts the four statuses and nothing else", () => {
    for (const s of VENDOR_CONTRACT_STATUSES) expect(supplierSchema.safeParse({ ...base, contractStatus: s }).success).toBe(true);
    expect(supplierSchema.safeParse({ ...base, contractStatus: "LAPSED" }).success).toBe(false);
  });
  it("toSupplierData turns blanks into null and dates into UTC midnight", () => {
    const d = toSupplierData(supplierSchema.parse({ ...base, phone: "", contractStart: "2026-03-05" }));
    expect(d.phone).toBeNull();
    expect(d.contractStart?.toISOString()).toBe("2026-03-05T00:00:00.000Z");
    expect(d.contractEnd).toBeNull();
  });
});
