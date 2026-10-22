import { describe, expect, it } from "vitest";
import { TOTAL_KEYS, TOTAL_LABEL, checkTotals, formatTypedMoney, itemsTotal, parseMoney, totalsConsistency } from "./po-totals";

const GOOD = { totalSales: 9100, lessVat: 975, netOfVat: 8125, amountDue: 8125, addVat: 975, totalAmountDue: 9100 };

describe("TOTAL_KEYS and TOTAL_LABEL", () => {
  it("lists the seven keys in the invoice's order", () => {
    expect(TOTAL_KEYS).toEqual(["totalSales", "lessVat", "netOfVat", "discount", "amountDue", "addVat", "totalAmountDue"]);
  });

  it("labels each key the way the invoice reads", () => {
    expect(TOTAL_KEYS.map((k) => TOTAL_LABEL[k])).toEqual([
      "Total sales (VAT inclusive)", "Less: VAT", "Amount net of VAT", "Less: discount", "Amount due", "Add: VAT",
      "Total amount due",
    ]);
  });
});

describe("parseMoney", () => {
  it("strips commas, the peso sign and spaces", () => {
    expect(parseMoney("₱9,100.00")).toBe(9100);
    expect(parseMoney(" 1 250.50 ")).toBe(1250.5);
  });

  it("gives null for blank and NaN for a non-number", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("   ")).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney("abc")).toBeNaN();
    expect(parseMoney("12.5.1")).toBeNaN();
  });

  it("passes numbers through", () => {
    expect(parseMoney(975)).toBe(975);
  });
});

describe("formatTypedMoney (final review M5: one format for a stored total in a typed field)", () => {
  it("shows two decimals with thousands commas, and nothing for none", () => {
    expect(formatTypedMoney(9100)).toBe("9,100.00");
    expect(formatTypedMoney(975)).toBe("975.00");
    expect(formatTypedMoney(0)).toBe("0.00");
    expect(formatTypedMoney(0.5)).toBe("0.50");
    expect(formatTypedMoney(1234567.891)).toBe("1,234,567.89");
    expect(formatTypedMoney(null)).toBe("");
  });
  it("reads back as the same amount", () => {
    for (const n of [9100, 8125.5, 0.01, 1234567.89]) expect(parseMoney(formatTypedMoney(n))).toBe(n);
  });
});

describe("itemsTotal", () => {
  it("adds qty × unit price, counting a blank price as 0", () => {
    expect(itemsTotal([{ qty: 2, unitPrice: "1,000.50" }, { qty: "3", unitPrice: 0.1 }, { qty: 1, unitPrice: null }])).toBe(2001.3);
  });
});

describe("checkTotals", () => {
  it("the owner's invoice adds up", () => {
    expect(itemsTotal([{ qty: 1, unitPrice: "9,100.00" }])).toBe(9100);
    const r = checkTotals(9100, GOOD);
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual({});
  });

  it("flags total sales that don't match the items", () => {
    const r = checkTotals(9100, { ...GOOD, totalSales: 9101, netOfVat: 8126, amountDue: 8126, totalAmountDue: 9101 });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual({ totalSales: "Items add up to ₱9,100.00." });
  });

  it("flags net of VAT that isn't total sales − VAT", () => {
    const r = checkTotals(9100, { ...GOOD, netOfVat: 8126, amountDue: 8126, totalAmountDue: 9101 });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual({ netOfVat: "Total sales − VAT = ₱8,125.00." });
  });

  it("flags amount due that isn't net − discount", () => {
    const r = checkTotals(9100, { ...GOOD, amountDue: 8126, totalAmountDue: 9101 });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual({ amountDue: "Net − discount = ₱8,125.00." });
  });

  it("flags total amount due that isn't amount due + VAT", () => {
    const r = checkTotals(9100, { ...GOOD, totalAmountDue: 9101 });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual({ totalAmountDue: "Amount due + VAT = ₱9,100.00." });
  });

  it("allows ±₱0.01", () => {
    expect(checkTotals(9100, { ...GOOD, totalAmountDue: 9100.01 }).ok).toBe(true);
    expect(checkTotals(9100, { ...GOOD, totalAmountDue: 9099.99 }).ok).toBe(true);
    expect(checkTotals(9100, { ...GOOD, totalAmountDue: 9100.02 }).ok).toBe(false);
  });

  it("counts a blank discount as 0, and subtracts a typed one", () => {
    expect(checkTotals(9100, { ...GOOD, discount: null }).ok).toBe(true);
    const r = checkTotals(9100, { ...GOOD, discount: 125, amountDue: 8000, totalAmountDue: 8975 });
    expect(r.ok).toBe(true);
  });

  it("skips a check whose inputs are blank", () => {
    const r = checkTotals(9100, { totalAmountDue: 9100 });
    expect(r).toEqual({ ok: true, problems: {} });
    expect(checkTotals(9100, { totalSales: 9100, netOfVat: 1, totalAmountDue: 9100 }).problems).toEqual({});
  });

  it("is not ok without a total amount due", () => {
    const { totalAmountDue: _, ...rest } = GOOD;
    expect(checkTotals(9100, rest).ok).toBe(false);
    expect(checkTotals(9100, { ...rest, totalAmountDue: null }).ok).toBe(false);
    expect(checkTotals(9100, rest).problems).toEqual({});
  });

  it("is not ok when a typed total isn't a number", () => {
    expect(checkTotals(9100, { ...GOOD, lessVat: Number.NaN }).ok).toBe(false);
  });
});

describe("totalsConsistency (what a write stores as totalsConsistent)", () => {
  const BLANK = { totalSales: null, lessVat: null, netOfVat: null, discount: null, amountDue: null, addVat: null, totalAmountDue: null };
  const line = { qty: 1, unitPrice: 9100 };

  it("null when no total is typed (a legacy PO)", () => {
    expect(totalsConsistency([line], BLANK)).toBeNull();
  });

  it("checkTotals over the items for typed totals", () => {
    expect(totalsConsistency([line], { ...BLANK, ...GOOD })).toBe(true);
    expect(totalsConsistency([{ ...line, unitPrice: 9000 }], { ...BLANK, ...GOOD })).toBe(false);
  });

  it("the items are Σ qty × unit price (spec §3): units closed short still count, as on the paper invoice", () => {
    const five = { totalSales: 250000, totalAmountDue: 250000 };
    expect(totalsConsistency([{ qty: 5, unitPrice: 50000 }], { ...BLANK, ...five })).toBe(true);
    // a line row carrying closedShort is read for qty × price only
    const closed = { qty: 5, unitPrice: 50000, closedShort: 2 };
    expect(totalsConsistency([closed], { ...BLANK, ...five })).toBe(true);
  });
});
