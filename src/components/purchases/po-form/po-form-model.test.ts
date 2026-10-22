import { describe, expect, it } from "vitest";
import {
  blankLine, checklist, emptyTotals, initials, lineErrors, SECTIONS, saveLabel, sectionsDone, toPayload, totalsReview,
  unitCounts, whenYouSave, unitChips, type DraftContext, type PoDraft,
} from "./po-form-model";

/*
 * PO form redesign (A3, spec §2): the form's pure model — which rail sections are done, the "Before you save"
 * checklist, the Save button's words, the totals status, and the save payload (which always names every header
 * field, every total and every line's unit, so an edit never keeps a stale value by leaving a field out).
 */

const IT = "cat-cable";
const OFFICE = "cat-chair";

/** The owner's PCWORX invoice, typed in full: SI № 44511, 1 box of Belden Cat6 cable at ₱9,100.00. */
const owner = (extra: Partial<PoDraft> = {}): PoDraft => ({
  vendorId: "v-pcworx", poNumber: "2025-0418", invoiceRef: "44511", receiptRef: "", purchasedAt: "2025-11-22",
  paidBy: "CREDIT_CARD", departmentId: "",
  lines: [{ ...blankLine("k1"), description: "Belden Cat6 UTP cable, blue", specs: "305 m", categoryId: IT, qty: "1", unit: "box", unitPrice: "9,100.00" }],
  totals: {
    totalSales: "9,100.00", lessVat: "975.00", netOfVat: "8,125.00", discount: "", amountDue: "8,125.00", addVat: "975.00",
    totalAmountDue: "9,100.00",
  },
  ...extra,
});
const ctx = (extra: Partial<DraftContext> = {}): DraftContext => ({
  vendorTin: "004-845-988-00004", classes: { [IT]: "IT", [OFFICE]: "PURCHASING" }, invoiceAttached: true, ...extra,
});
const empty = (): PoDraft => ({
  vendorId: "", poNumber: "", invoiceRef: "", receiptRef: "", purchasedAt: "", paidBy: "", departmentId: "",
  lines: [blankLine("k1")], totals: emptyTotals(),
});

describe("the section rail", () => {
  it("lists the five sections in order, each linking to its card", () => {
    expect(SECTIONS.map((s) => [s.label, s.href])).toEqual([
      ["Vendor", "#po-vendor"], ["Invoice & payment", "#po-invoice"], ["Items", "#po-items"], ["Documents", "#po-docs"],
      ["Totals", "#po-totals"],
    ]);
  });

  it("every section is done on the owner's invoice with the sales invoice attached", () => {
    expect(sectionsDone(owner(), ctx())).toEqual({ vendor: true, invoice: true, items: true, docs: true, totals: true });
  });

  it("nothing is done on an empty form", () => {
    expect(sectionsDone(empty(), ctx({ vendorTin: null, invoiceAttached: false })))
      .toEqual({ vendor: false, invoice: false, items: false, docs: false, totals: false });
  });

  it("each section turns off on its own", () => {
    expect(sectionsDone(owner(), ctx({ vendorTin: null })).vendor).toBe(false);
    expect(sectionsDone(owner(), ctx({ vendorTin: "  " })).vendor).toBe(false);
    expect(sectionsDone(owner({ vendorId: "" }), ctx()).vendor).toBe(false);
    for (const k of ["poNumber", "invoiceRef", "purchasedAt", "paidBy"] as const) {
      expect(sectionsDone(owner({ [k]: "" }), ctx()).invoice, k).toBe(false);
    }
    // the OR number and department are optional
    expect(sectionsDone(owner({ receiptRef: "", departmentId: "" }), ctx()).invoice).toBe(true);
    const line = owner().lines[0];
    expect(sectionsDone(owner({ lines: [{ ...line, categoryId: "" }] }), ctx()).items).toBe(false);
    expect(sectionsDone(owner({ lines: [{ ...line, qty: "0" }] }), ctx()).items).toBe(false);
    expect(sectionsDone(owner({ lines: [{ ...line, unitPrice: "" }] }), ctx()).items).toBe(false);
    expect(sectionsDone(owner({ lines: [{ ...line, description: "" }] }), ctx()).items).toBe(false);
    // a blank card at the end is left out, not counted against the items
    expect(sectionsDone(owner({ lines: [line, blankLine("k2")] }), ctx()).items).toBe(true);
    expect(sectionsDone(owner(), ctx({ invoiceAttached: false })).docs).toBe(false);
    expect(sectionsDone(owner({ totals: { ...owner().totals, totalAmountDue: "" } }), ctx()).totals).toBe(false);
    expect(sectionsDone(owner({ totals: { ...owner().totals, totalSales: "9,000.00" } }), ctx()).totals).toBe(false);
  });
});

describe("Before you save", () => {
  it("lists the seven checks in order", () => {
    expect(checklist(owner(), ctx()).map((c) => c.label)).toEqual([
      "Purchase order number", "Vendor with a TIN", "SI number and date", "Every item has a category",
      "Every item has a quantity and price", "Sales invoice attached", "Totals add up",
    ]);
    expect(checklist(owner(), ctx()).every((c) => c.done)).toBe(true);
    expect(checklist(empty(), ctx({ vendorTin: null, invoiceAttached: false })).some((c) => c.done)).toBe(false);
  });

  it("each check follows its own fields", () => {
    const done = (d: PoDraft, c = ctx()) => Object.fromEntries(checklist(d, c).map((x) => [x.label, x.done]));
    expect(done(owner({ poNumber: " " }))["Purchase order number"]).toBe(false);
    expect(done(owner(), ctx({ vendorTin: null }))["Vendor with a TIN"]).toBe(false);
    expect(done(owner({ purchasedAt: "" }))["SI number and date"]).toBe(false);
    const line = owner().lines[0];
    const noCat = done(owner({ lines: [{ ...line, categoryId: "" }] }));
    expect([noCat["Every item has a category"], noCat["Every item has a quantity and price"]]).toEqual([false, true]);
    expect(done(owner({ lines: [{ ...line, unitPrice: "nine" }] }))["Every item has a quantity and price"]).toBe(false);
    expect(done(owner(), ctx({ invoiceAttached: false }))["Sales invoice attached"]).toBe(false);
  });
});

describe("the Save button", () => {
  it("sends IT gear to IT, and anything else is registered", () => {
    expect(saveLabel(owner(), ctx())).toBe("Save and send to IT");
    const chair = { ...owner().lines[0], description: "Office chair", categoryId: OFFICE };
    expect(saveLabel(owner({ lines: [chair] }), ctx())).toBe("Save and register");
    expect(saveLabel(owner({ lines: [chair, owner().lines[0]] }), ctx())).toBe("Save and send to IT");
    // no category yet: nothing goes to IT
    expect(saveLabel(empty(), ctx())).toBe("Save and register");
  });

  it("on an edit, IT gear that is all registered (or IT has started registering) no longer goes to IT", () => {
    const done = { ...owner().lines[0], id: "ln1", qty: "2", locked: 2 };
    expect(saveLabel(owner({ lines: [done] }), ctx())).toBe("Save and register");
    expect(saveLabel(owner({ lines: [{ ...done, locked: 1 }] }), ctx())).toBe("Save and send to IT");
    expect(saveLabel(owner({ lines: [{ ...done, locked: 1 }] }), ctx({ itRegistered: true }))).toBe("Save and register");
  });
});

describe("where the units go", () => {
  it("counts the units by class", () => {
    const chairs = { ...blankLine("k2"), description: "Office chair", categoryId: OFFICE, qty: "4", unitPrice: "4500" };
    const counts = unitCounts(owner({ lines: [...owner().lines, chairs] }), ctx());
    expect(counts).toEqual({ it: 1, office: 4 });
    expect(unitChips(counts)).toEqual(["1 unit to IT", "4 units to register"]);
    expect(whenYouSave(counts)).toEqual([
      "1 unit of IT gear goes to IT to check and register.", "4 units are ready for you to register.",
    ]);
    expect(whenYouSave({ it: 3, office: 1 })).toEqual([
      "3 units of IT gear go to IT to check and register.", "1 unit is ready for you to register.",
    ]);
    expect(whenYouSave({ it: 0, office: 0 })).toEqual(["No IT gear on this order.", "Nothing for you to register yet."]);
  });
});

describe("the invoice totals", () => {
  it("says what to do, whether it adds up, and which lines don't", () => {
    expect(totalsReview(owner({ totals: emptyTotals() }))).toMatchObject({
      status: "empty", text: "Type the total amount due from the invoice.", problems: {},
    });
    expect(totalsReview(owner())).toMatchObject({
      items: 9100, status: "ok", text: "The figures add up, and the items match total sales.", problems: {},
    });
    const off = totalsReview(owner({ totals: { ...owner().totals, totalSales: "9,000.00", lessVat: "x" } }));
    expect(off.status).toBe("off");
    expect(off.text).toBe(
      "Some figures don't add up — check the highlighted lines against the invoice. You can still save if the invoice itself is off; Finance will see the note.",
    );
    expect(off.problems).toEqual({ totalSales: "Items add up to ₱9,100.00.", lessVat: "Type an amount, like 9,100.00" });
  });
});

describe("the save payload", () => {
  it("always names every header field, all seven totals and each line's unit", () => {
    const d = owner({ poNumber: "", paidBy: "", totals: { ...emptyTotals(), totalAmountDue: "9,100.00" } });
    const { payload } = toPayload(d, { id: "po1", reply: "  " });
    expect(payload).toEqual({
      id: "po1", vendorId: "v-pcworx", poNumber: "", invoiceRef: "44511", receiptRef: "", purchasedAt: "2025-11-22",
      paidBy: "", departmentId: "",
      lines: [{ description: "Belden Cat6 UTP cable, blue", specs: "305 m", categoryId: IT, qty: 1, unit: "box", unitPrice: 9100 }],
      totals: { totalSales: "", lessVat: "", netOfVat: "", discount: "", amountDue: "", addVat: "", totalAmountDue: "9,100.00" },
    });
    expect(Object.keys(toPayload(owner(), { reply: "fixed the SI" }).payload)).toContain("reply");
    expect(toPayload(owner(), {}).payload).not.toHaveProperty("id");
  });

  it("leaves blank cards out and maps the server's line errors back to the cards", () => {
    const line = owner().lines[0];
    const d = owner({ lines: [blankLine("a"), { ...line, id: "ln1", unit: " " }, blankLine("b"), { ...line, qty: "x", unitPrice: "" }] });
    const { payload, cardOf } = toPayload(d, {});
    expect(payload.lines).toEqual([
      expect.objectContaining({ id: "ln1", unit: "pc", qty: 1 }),
      expect.objectContaining({ qty: null, unitPrice: null }),
    ]);
    expect(cardOf).toEqual([1, 3]);
    expect(lineErrors({ "lines.1.qty": "Enter a quantity", "lines.0.categoryId": "Pick a category", vendorId: "x" }, cardOf)).toEqual({
      3: { qty: "Enter a quantity" }, 1: { categoryId: "Pick a category" },
    });
  });
});

it("initials: two letters from the name", () => {
  expect(initials("PCWORX")).toBe("PC");
  expect(initials("Quezon Furniture Works")).toBe("QF");
  expect(initials("  ")).toBe("?");
});
