import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TotalsLadder, type TotalsLadderProps } from "./totals-ladder";

/*
 * PO form redesign (spec §2.9, §3, §6): the PO page and Finance's group review show the seven totals Purchasing typed
 * off the sales invoice, read-only, in the invoice's order with TOTAL AMOUNT DUE bold — and, when the PO's stored
 * `totalsConsistent` is false, a "Totals didn't add up on the PO" note naming each line that doesn't (checkTotals).
 * A legacy PO with no totals shows today's Fees and Total instead.
 */

/** The owner's PCWORX invoice: 1 box of Belden Cat6 cable at ₱9,100.00. */
const OWNER = { totalSales: 9100, lessVat: 975, netOfVat: 8125, discount: null, amountDue: 8125, addVat: 975, totalAmountDue: 9100 };
const LINES = [{ qty: 1, unitPrice: 9100 }];
const render = (extra: Partial<TotalsLadderProps> = {}) =>
  renderToStaticMarkup(<TotalsLadder totals={OWNER} totalsConsistent lines={LINES} {...extra} />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
/** Each ladder row's label, in the order shown. */
const labels = (html: string) => [...html.matchAll(/<dt[^>]*>(.*?)<\/dt>/g)].map((m) => text(m[1]));

describe("TotalsLadder", () => {
  it("shows the seven figures in the invoice's order, a blank discount as a dash", () => {
    const html = render();
    expect(labels(html)).toEqual([
      "Total sales (VAT inclusive)", "Less: VAT", "Amount net of VAT", "Less: discount", "Amount due", "Add: VAT", "Total amount due",
    ]);
    const t = text(html);
    expect(t).toContain("Total sales (VAT inclusive) ₱9,100.00");
    expect(t).toContain("Less: discount —");
    expect(t).toContain("Total amount due ₱9,100.00");
  });

  it("TOTAL AMOUNT DUE is the bold, uppercase last row; no other row is", () => {
    const html = render();
    const rows = [...html.matchAll(/<div data-total="(\w+)"[^>]*class="([^"]*)"/g)].map((m) => [m[1], m[2]]);
    expect(rows.map(([k]) => k)).toEqual(["totalSales", "lessVat", "netOfVat", "discount", "amountDue", "addVat", "totalAmountDue"]);
    for (const [k, cls] of rows) {
      expect(cls.includes("font-semibold"), k).toBe(k === "totalAmountDue");
      expect(cls.includes("uppercase"), k).toBe(k === "totalAmountDue");
    }
  });

  it("no note while the totals add up, or before they were ever checked", () => {
    expect(render()).not.toContain("didn't add up");
    expect(render({ totalsConsistent: null })).not.toContain("didn't add up");
  });

  it("when the PO's totals didn't add up, a note names each line that doesn't, with what it expected", () => {
    // the line's price was fixed to ₱9,000.00 after the invoice was typed, and the total amount due is a typo
    const html = render({ totals: { ...OWNER, totalAmountDue: 9200 }, lines: [{ qty: 1, unitPrice: 9000 }], totalsConsistent: false });
    const t = text(html);
    expect(t).toContain("Totals didn't add up on the PO");
    expect(t).toContain("Total sales (VAT inclusive): Items add up to ₱9,000.00.");
    expect(t).toContain("Total amount due: Amount due + VAT = ₱9,100.00.");
    expect(t).not.toContain("Amount net of VAT: ");
  });

  it("a note with nothing to point at (no total amount due typed) says so", () => {
    const t = text(render({ totals: { ...OWNER, totalAmountDue: null }, totalsConsistent: false }));
    expect(t).toContain("Totals didn't add up on the PO");
    expect(t).toContain("No total amount due was typed.");
  });

  it("a legacy PO with no totals shows today's Fees and Total, and nothing without them", () => {
    const none = { totalSales: null, lessVat: null, netOfVat: null, discount: null, amountDue: null, addVat: null, totalAmountDue: null };
    const html = render({ totals: none, totalsConsistent: null, legacy: { fees: 250, total: 18200 } });
    expect(labels(html)).toEqual(["Fees", "Total"]);
    expect(text(html)).toContain("Fees ₱250.00 Total ₱18,200.00");
    expect(text(render({ totals: none, totalsConsistent: null, legacy: { fees: null, total: 18200 } }))).toContain("Fees —");
    expect(render({ totals: none, totalsConsistent: null })).toBe("");
  });

  it("a PO with totals that still carries old fees shows them under the ladder", () => {
    const html = render({ legacy: { fees: 250, total: 9100 } });
    expect(labels(html).at(-1)).toBe("Fees (before the new form)");
    expect(labels(render({ legacy: { fees: null, total: 9100 } }))).not.toContain("Fees (before the new form)");
  });
});
