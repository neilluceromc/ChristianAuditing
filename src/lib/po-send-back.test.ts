import { describe, expect, it } from "vitest";
import { MONEY_FIELDS } from "./intake-rules";
import { PO_SEND_BACK_FIELDS, poFieldWords, poSendBackFields } from "./po-send-back";

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
  it("offers Fees only on a legacy PO that has a fee (final review M2): the A3 form has no fees field", () => {
    const keys = (po: { formV2: boolean; fees: number | null }) => poSendBackFields(po).map((f) => f.key);
    expect(keys({ formV2: true, fees: null })).not.toContain("fees");
    expect(keys({ formV2: true, fees: 150 })).not.toContain("fees");
    expect(keys({ formV2: false, fees: null })).not.toContain("fees");
    expect(keys({ formV2: false, fees: 150 })).toContain("fees");
    expect(keys({ formV2: false, fees: 0 })).toContain("fees");
    // everything else is offered either way, in the checklist's order
    expect(keys({ formV2: true, fees: null })).toEqual(PO_SEND_BACK_FIELDS.map((f) => f.key).filter((k) => k !== "fees"));
    // an old send-back that ticked Fees still reads as "Fees"
    expect(poFieldWords(["fees"])).toEqual(["Fees"]);
  });
  it("words the fields the way a person says them (SI, OR, unit price)", () => {
    expect(poFieldWords(["invoiceRef", "cost"])).toEqual(["SI number", "Unit price"]);
    expect(poFieldWords(["vendorId", "doc:official-receipt", "nope"])).toEqual(["Vendor", "Official receipt", "nope"]);
    // the PO form redesign's words (spec §2.2, §2.5): a vendor, and the date on the invoice
    expect(poFieldWords(["purchasedAt"])).toEqual(["Invoice date"]);
  });
});
