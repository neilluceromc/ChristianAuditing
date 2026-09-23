import { describe, expect, it } from "vitest";
import { actionLabel, recordActions, recordPrimary, type RecordState } from "./record-actions";

const base: RecordState = {
  cls: "IT", status: "SPARE", hasHolder: false, returnedAt: null, itVerifiedAt: new Date("2025-01-01"),
  financeConfirmedAt: new Date("2025-02-01"), financeReturnedAt: null, pending: false, held: false,
};

describe("recordActions — one state-chosen primary per record (spec §4.1, plan P-4)", () => {
  it("an assignable spare: Assign, then Reserve, Change status, Print label", () => {
    expect(recordActions(base, "it_staff")).toEqual({ primary: "assign", more: ["reserve", "change-status", "print-label"], edit: true });
  });
  it("a held device: Return, then Replace, Change status, Print label", () => {
    expect(recordActions({ ...base, status: "DEPLOYED", hasHolder: true }, "it_staff"))
      .toEqual({ primary: "return", more: ["replace", "change-status", "print-label"], edit: true });
  });
  it("a loan adds Set loan date after Change status", () => {
    expect(recordActions({ ...base, status: "TEMPORARY", hasHolder: true }, "it_staff").more)
      .toEqual(["replace", "change-status", "set-loan-date", "print-label"]);
  });
  it("back, not checked: Triage, then Change status and Print label (not assignable yet)", () => {
    expect(recordActions({ ...base, returnedAt: new Date("2026-09-20") }, "it_staff"))
      .toEqual({ primary: "triage", more: ["change-status", "print-label"], edit: true });
  });
  it("a pending approval suppresses every lifecycle action", () => {
    expect(recordActions({ ...base, status: "DEPLOYED", hasHolder: true, pending: true }, "it_staff"))
      .toEqual({ primary: null, more: ["print-label"], edit: true });
  });
  it("a held spare (reserved) still offers Assign but not Reserve", () => {
    expect(recordActions({ ...base, held: true }, "it_staff").more).toEqual(["change-status", "print-label"]);
  });
  it("awaiting IT check: Mark checked for IT, Edit for the registrant too", () => {
    const awaiting = { ...base, itVerifiedAt: null, financeConfirmedAt: null };
    expect(recordPrimary(awaiting, "it_staff")).toBe("mark-checked");
    expect(recordActions(awaiting, "purchasing_staff")).toEqual({ primary: null, more: [], edit: true });
  });
  it("Finance on an unconfirmed record: Confirm details, Send back in More, no Edit", () => {
    expect(recordActions({ ...base, financeConfirmedAt: null }, "finance_staff"))
      .toEqual({ primary: "confirm-details", more: ["send-back"], edit: false });
  });
  it("a pending approval does not suppress Finance's review (plan P-4)", () => {
    expect(recordPrimary({ ...base, financeConfirmedAt: null, pending: true }, "finance_staff")).toBe("confirm-details");
  });
  it("admin on a Finance-returned IT spare: one primary, the rest in More in the fixed order", () => {
    const returned = { ...base, financeConfirmedAt: null, financeReturnedAt: new Date("2026-09-21") };
    expect(recordActions(returned, "admin")).toEqual({
      primary: "mark-corrected",
      more: ["confirm-details", "send-back", "assign", "reserve", "change-status", "print-label"],
      edit: true,
    });
  });
  it("a Purchasing record on the approval path: Assign (as a request), no Replace or Reserve", () => {
    const car = { ...base, cls: "PURCHASING" as const, status: "STORED" as const, itVerifiedAt: null };
    expect(recordActions(car, "purchasing_staff")).toEqual({ primary: "assign", more: ["change-status", "print-label"], edit: true });
  });
  it("a viewer gets nothing", () => {
    expect(recordActions(base, "viewer")).toEqual({ primary: null, more: [], edit: false });
  });
  it("a held Purchasing asset offers no Change status (no target to pick)", () => {
    const car = { ...base, cls: "PURCHASING" as const, status: "OPERATIONAL" as const, hasHolder: true, itVerifiedAt: null };
    expect(recordActions(car, "purchasing_staff").more).toEqual(["print-label"]);
  });
});

describe("actionLabel — header buttons, menu items, and the approval path's words (plan P-5)", () => {
  it("primaries have no ellipsis; menu items do", () => {
    expect(actionLabel("return", { cls: "IT", direct: true, inMenu: false })).toBe("Return");
    expect(actionLabel("return", { cls: "IT", direct: true, inMenu: true })).toBe("Return…");
    expect(actionLabel("replace", { cls: "IT", direct: true, inMenu: true })).toBe("Replace…");
    expect(actionLabel("print-label", { cls: "IT", direct: true, inMenu: true })).toBe("Print label");
  });
  it("the approval path keeps today's words", () => {
    expect(actionLabel("assign", { cls: "PURCHASING", direct: false, inMenu: false })).toBe("Assign holder");
    expect(actionLabel("change-status", { cls: "PURCHASING", direct: false, inMenu: true })).toBe("Request status change…");
  });
  it("Send back names the class it returns to", () => {
    expect(actionLabel("send-back", { cls: "PURCHASING", direct: false, inMenu: true })).toBe("Send back to Purchasing…");
  });
});
