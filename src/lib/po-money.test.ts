import { describe, expect, it } from "vitest";
import { moneyForAsset } from "./po-money";

const po = { vendorId: "v1", invoiceRef: "INV-9", receiptRef: "OR-4", purchasedAt: new Date("2026-10-01T00:00:00Z") };

describe("moneyForAsset", () => {
  it("copies the four PO fields and takes cost from the line's unit price", () => {
    expect(moneyForAsset(po, { unitPrice: 1250.5 })).toEqual({ cost: 1250.5, ...po });
  });
  it("a null unit price gives a null cost", () => {
    expect(moneyForAsset(po, { unitPrice: null })).toEqual({ cost: null, ...po });
  });
  it("carries null PO fields through", () => {
    const empty = { vendorId: null, invoiceRef: null, receiptRef: null, purchasedAt: null };
    expect(moneyForAsset(empty, { unitPrice: 10 })).toEqual({ cost: 10, ...empty });
  });
});
