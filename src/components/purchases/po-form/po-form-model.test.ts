import { describe, expect, it } from "vitest";
import {
  blankLine, checklist, emptyTotals, fileSize, filesTooBig, firstErrorTarget, initials, invoiceAttached, lineErrors, SECTIONS, saveLabel,
  sectionsDone, toFormData, toPayload, totalsReview, unitCounts, whenYouSave, unitChips, type DraftContext, type PoDraft,
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

describe("after a failed save, the field to focus", () => {
  it("is the first error in the order the form shows them", () => {
    const cardOf = [1, 3];
    expect(firstErrorTarget({ "totals.totalAmountDue": "x", paidBy: "x", poNumber: "x" }, cardOf)).toBe("poNumber");
    expect(firstErrorTarget({ "totals.lessVat": "x", "lines.1.qty": "x", "lines.1.description": "x", "lines.0.unitPrice": "x" }, cardOf))
      .toBe("line:1:unitPrice");
    expect(firstErrorTarget({ "lines.1.unit": "x", "lines.1.categoryId": "x" }, cardOf)).toBe("line:3:categoryId");
    expect(firstErrorTarget({ lines: "x", "lines.0.qty": "x" }, cardOf)).toBe("lines");
    expect(firstErrorTarget({ reply: "x", "totals.addVat": "x", "totals.totalSales": "x" }, cardOf)).toBe("totals.totalSales");
    expect(firstErrorTarget({ reply: "x" }, cardOf)).toBe("reply");
  });

  it("the document slots come after the items and before the totals, in slot order", () => {
    expect(firstErrorTarget({ "totals.totalAmountDue": "x", "doc:invoice": "Attach the sales invoice", reply: "x" }, [0])).toBe("doc:invoice");
    expect(firstErrorTarget({ "doc:warranty-slip": "x", "doc:official-receipt": "x" }, [0])).toBe("doc:official-receipt");
    expect(firstErrorTarget({ "doc:invoice": "x", "lines.0.qty": "x" }, [0])).toBe("line:0:qty");
    // the files together too big for one save: the Documents card
    expect(firstErrorTarget({ docs: "x", "totals.totalSales": "x" }, [0])).toBe("docs");
  });

  it("is none when no error is on a field the form shows: the banner takes focus", () => {
    expect(firstErrorTarget({}, [])).toBeNull();
    expect(firstErrorTarget({ payload: "The form didn't arrive whole" }, [0])).toBeNull();
    expect(firstErrorTarget({ "lines.4.qty": "x" }, [0])).toBeNull(); // a line the cards no longer map
  });
});

describe("the documents", () => {
  const pdf = (name: string, bytes = 10) => new File([new Uint8Array(bytes)], name, { type: "application/pdf" });

  it("the sales invoice check and the Documents tick follow the invoice slot: a held file or one on file", () => {
    const d = owner();
    const check = (c: DraftContext) => checklist(d, c).find((x) => x.label === "Sales invoice attached")?.done;
    expect(check(ctx({ invoiceAttached: invoiceAttached({}, {}) }))).toBe(false);
    expect(check(ctx({ invoiceAttached: invoiceAttached({ "official-receipt": pdf("or.pdf") }, {}) }))).toBe(false);
    expect(check(ctx({ invoiceAttached: invoiceAttached({ invoice: pdf("si.pdf") }, {}) }))).toBe(true);
    expect(check(ctx({ invoiceAttached: invoiceAttached({}, { invoice: true }) }))).toBe(true);
    expect(sectionsDone(d, ctx({ invoiceAttached: invoiceAttached({ invoice: pdf("si.pdf") }, {}) })).docs).toBe(true);
  });

  it("the save's FormData holds the payload and one file per filled slot", () => {
    const { payload } = toPayload(owner(), {});
    const si = pdf("si-44511.pdf");
    const ws = new File([new Uint8Array(5)], "warranty.jpg", { type: "image/jpeg" });
    const fd = toFormData(payload, { invoice: si, "warranty-slip": ws });
    expect(JSON.parse(String(fd.get("payload")))).toEqual(payload);
    expect([...fd.keys()].sort()).toEqual(["doc:invoice", "doc:warranty-slip", "payload"]);
    expect((fd.get("doc:invoice") as File).name).toBe("si-44511.pdf");
    expect((fd.get("doc:warranty-slip") as File).name).toBe("warranty.jpg");
    expect([...toFormData(payload, {}).keys()]).toEqual(["payload"]);
  });

  it("refuses files that together are over what one save carries", () => {
    expect(filesTooBig({ invoice: pdf("a.pdf", 3_000_000) })).toBeNull();
    expect(filesTooBig({ invoice: pdf("a.pdf", 2_500_000), "official-receipt": pdf("b.pdf", 2_000_000) })).toBe(
      "Together the files come to 4.5 MB, and one save carries 4 MB. Save with the sales invoice, then add the others on the purchase order's page.",
    );
  });

  it("file sizes read in KB or MB", () => {
    expect(fileSize(800)).toBe("1 KB");
    expect(fileSize(120_400)).toBe("120 KB");
    expect(fileSize(812_000)).toBe("0.8 MB");
    expect(fileSize(3_960_000)).toBe("4.0 MB");
  });
});

describe("a legacy PO (spec §5b.3)", () => {
  const legacy = (extra: Partial<DraftContext> = {}) => ctx({ legacy: true, ...extra });

  it("PO number, paid by and the sales invoice don't hold up the rail", () => {
    const d = owner({ poNumber: "", paidBy: "" });
    expect(sectionsDone(d, ctx()).invoice).toBe(false);
    expect(sectionsDone(d, legacy()).invoice).toBe(true);
    expect(sectionsDone(owner({ invoiceRef: "" }), legacy()).invoice).toBe(false); // the SI number is required on every PO
    expect(sectionsDone(d, legacy({ invoiceAttached: false })).docs).toBe(true);
    // the total amount due is optional too: blank totals are fine, totals that don't add up still aren't
    expect(sectionsDone(owner({ totals: emptyTotals() }), legacy()).totals).toBe(true);
    expect(sectionsDone(owner({ totals: { ...owner().totals, totalSales: "1.00" } }), legacy()).totals).toBe(false);
  });

  it("the checklist shows them as optional, done while blank", () => {
    const d = owner({ poNumber: "", totals: emptyTotals() });
    const items = checklist(d, legacy({ invoiceAttached: false }));
    expect(items.map((c) => c.label)).toEqual(checklist(d, ctx()).map((c) => c.label));
    const byLabel = Object.fromEntries(items.map((c) => [c.label, c]));
    for (const label of ["Purchase order number", "Sales invoice attached", "Totals add up"]) {
      expect(byLabel[label], label).toMatchObject({ done: true, optional: true });
    }
    expect(byLabel["SI number and date"]).toMatchObject({ done: true });
    expect(byLabel["SI number and date"].optional).toBeFalsy();
    // a new PO: required, so blank is not done
    const strict = Object.fromEntries(checklist(d, ctx({ invoiceAttached: false })).map((c) => [c.label, c]));
    expect(strict["Purchase order number"]).toMatchObject({ done: false });
    expect(strict["Purchase order number"].optional).toBeFalsy();
  });
});
