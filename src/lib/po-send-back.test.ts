import { describe, expect, it } from "vitest";
import { MONEY_FIELDS } from "./intake-rules";
import { PO_SEND_BACK_FIELDS, poFieldWords } from "./po-send-back";

describe("the PO send-back checklist", () => {
  it("offers every money field, the three money documents and Other — and nothing the server would refuse", () => {
    const keys = PO_SEND_BACK_FIELDS.map((f) => f.key);
    for (const k of MONEY_FIELDS) expect(keys).toContain(k);
    expect(keys).toEqual(expect.arrayContaining(["doc:invoice", "doc:official-receipt", "doc:delivery-receipt", "other"]));
    // Migration 39 (spec §5b.4): the PO number, paid by, and the seven totals as one "Invoice totals"
    expect(keys).toEqual(expect.arrayContaining(["poNumber", "paidBy", "totals"]));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(MONEY_FIELDS.length + 3 + 4);
    expect(poFieldWords(["poNumber", "paidBy", "totals"])).toEqual(["PO number", "Paid by", "Invoice totals"]);
  });
  it("words the fields the way a person says them (SI, OR, unit price)", () => {
    expect(poFieldWords(["invoiceRef", "cost"])).toEqual(["SI number", "Unit price"]);
    expect(poFieldWords(["vendorId", "doc:official-receipt", "nope"])).toEqual(["Supplier", "Official receipt", "nope"]);
  });
});
