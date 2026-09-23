import { describe, expect, it } from "vitest";
import { carryDocuments, singleOnlyNote } from "./register-documents";

const doc = (file: string, kind: "receipt" | "photo" | "invoice" = "receipt") => ({ file, kind });

describe("carryDocuments — staged files survive the quantity switch (review R11)", () => {
  it("1 → N with one file: it becomes the batch invoice", () => {
    expect(carryDocuments({ files: [doc("quote.pdf")], invoice: null }, 1, 3)).toEqual({ files: [], invoice: "quote.pdf" });
  });
  it("1 → N with several files: the first is the invoice, the rest stay listed", () => {
    expect(carryDocuments({ files: [doc("inv.pdf"), doc("pic.jpg", "photo")], invoice: null }, 1, 2))
      .toEqual({ files: [doc("pic.jpg", "photo")], invoice: "inv.pdf" });
  });
  it("1 → N with nothing staged stays empty", () => {
    expect(carryDocuments({ files: [], invoice: null }, 1, 5)).toEqual({ files: [], invoice: null });
  });
  it("N → 1: the invoice returns first, as an Invoice, ahead of the kept files", () => {
    expect(carryDocuments({ files: [doc("pic.jpg", "photo")], invoice: "inv.pdf" }, 3, 1))
      .toEqual({ files: [doc("inv.pdf", "invoice"), doc("pic.jpg", "photo")], invoice: null });
  });
  it("N → M changes nothing", () => {
    const state = { files: [doc("pic.jpg")], invoice: "inv.pdf" };
    expect(carryDocuments(state, 3, 7)).toBe(state);
    expect(carryDocuments(state, 1, 1)).toBe(state);
  });
  it("words the kept files, singular and plural", () => {
    expect(singleOnlyNote(0)).toBeNull();
    expect(singleOnlyNote(1)).toBe("1 more file applies to a single asset only — it is kept if you go back to 1.");
    expect(singleOnlyNote(2)).toBe("2 more files apply to a single asset only — they are kept if you go back to 1.");
  });
});
