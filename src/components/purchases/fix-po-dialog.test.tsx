import { describe, expect, it, vi } from "vitest";

// The dialog's runner reaches for the router and the toast; the server action is a stand-in (nothing is pressed here).
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/server/modules/purchases/po-actions", () => ({ fixPurchaseOrder: vi.fn() }));

import { FIX_PO_CLAIMED, fixPoFormOf, fixPoPatch, type FixPoForm, type FixPoValues } from "./fix-po-dialog";

/*
 * PO form redesign (spec §5b.4): the PO number, paid by and each of the seven typed totals are money fields IT and
 * Finance can fix with a reason. The dialog claims the server's error for each (so it shows under its field, not in
 * the banner), and sends only what changed.
 */

const PO: FixPoValues = {
  id: "po7", refNo: "PO-0215", vendorId: "v1", invoiceRef: "44511", receiptRef: null, purchasedAt: "2025-11-22", fees: null,
  poNumber: "2025-0418", paidBy: "CREDIT_CARD", formV2: true,
  totals: { totalSales: 9100, lessVat: 975, netOfVat: 8125, discount: null, amountDue: 8125, addVat: 975, totalAmountDue: 9100 },
};
const LINES = [{ id: "l1", index: 1, description: "Belden Cat6 UTP cable", unitPrice: 9100 }];
/** The dialog as it opens: every field showing the PO's own value. */
const opened = (): FixPoForm => ({
  vendorId: "v1", poNumber: "2025-0418", paidBy: "CREDIT_CARD", invoiceRef: "44511", receiptRef: "", purchasedAt: "2025-11-22",
  fees: "", prices: { l1: "9100" },
  totals: { totalSales: "9100", lessVat: "975", netOfVat: "8125", discount: "", amountDue: "8125", addVat: "975", totalAmountDue: "9100" },
});

describe("FixPoDialog", () => {
  it("claims the server's error for the PO number, paid by and every total", () => {
    expect(FIX_PO_CLAIMED).toEqual(expect.arrayContaining([
      "reason", "patch.vendorId", "patch.invoiceRef", "patch.receiptRef", "patch.purchasedAt", "patch.fees",
      "patch.poNumber", "patch.paidBy",
      "patch.totalSales", "patch.lessVat", "patch.netOfVat", "patch.discount", "patch.amountDue", "patch.addVat", "patch.totalAmountDue",
    ]));
  });

  it("opens with each total as the edit form shows it (final review M5), and an untouched dialog sends nothing", () => {
    const f = fixPoFormOf(PO, LINES);
    expect(f.totals).toEqual({
      totalSales: "9,100.00", lessVat: "975.00", netOfVat: "8,125.00", discount: "", amountDue: "8,125.00", addVat: "975.00",
      totalAmountDue: "9,100.00",
    });
    expect(fixPoPatch(PO, LINES, f)).toEqual({});
    // the unit prices and fees keep their plain form (they are compared as numbers typed without commas)
    expect(f.prices).toEqual({ l1: "9100" });
    expect(fixPoFormOf({ ...PO, fees: 1250 }, LINES).fees).toBe("1250");
  });

  it("an untouched dialog sends nothing, even where a total is typed with commas or a peso sign", () => {
    expect(fixPoPatch(PO, LINES, opened())).toEqual({});
    expect(fixPoPatch(PO, LINES, { ...opened(), totals: { ...opened().totals, totalSales: "₱9,100.00" } })).toEqual({});
  });

  it("sends the PO number, paid by and only the totals that changed", () => {
    const f = opened();
    const patch = fixPoPatch(PO, LINES, {
      ...f, poNumber: " 2025-0419 ", paidBy: "DEBIT_CARD", totals: { ...f.totals, discount: "100", amountDue: "8,025.00", totalAmountDue: "" },
    });
    expect(patch).toEqual({ poNumber: "2025-0419", paidBy: "DEBIT_CARD", discount: "100", amountDue: "8,025.00", totalAmountDue: null });
  });

  it("a cleared PO number is sent (the server says it can't be cleared); a legacy PO's blank one stays unsent", () => {
    expect(fixPoPatch(PO, LINES, { ...opened(), poNumber: "  " })).toEqual({ poNumber: "" });
    const legacy = { ...PO, poNumber: null, paidBy: null };
    expect(fixPoPatch(legacy, LINES, { ...opened(), poNumber: "", paidBy: "" })).toEqual({});
  });

  it("an amount that isn't one goes to the server as typed, so its words come back under the field", () => {
    expect(fixPoPatch(PO, LINES, { ...opened(), totals: { ...opened().totals, addVat: "9x" } })).toEqual({ addVat: "9x" });
  });

  it("still sends the supplier, SI, OR, date, fees and changed unit prices as before", () => {
    const patch = fixPoPatch(PO, LINES, {
      ...opened(), vendorId: "v2", invoiceRef: "44512", receiptRef: "OR-9", purchasedAt: "2025-11-23", fees: "250", prices: { l1: "9000" },
    });
    expect(patch).toEqual({
      vendorId: "v2", invoiceRef: "44512", receiptRef: "OR-9", purchasedAt: "2025-11-23", fees: 250, lines: [{ id: "l1", unitPrice: 9000 }],
    });
  });
});
