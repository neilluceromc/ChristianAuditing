import { describe, expect, it } from "vitest";
import {
  approveRestore, latestFinanceChange, settingsRestore, undoCheck, undoState, UNDO_WINDOW_MS, type UndoAsset, type UndoEntry,
} from "./finance-undo";

/*
 * Finance follow-up, Task 2 (spec §3; Review Focus 1, 2 and 5): who may undo a review action, until when, and only
 * while it is still the latest finance change on the asset. Pure: the asset page and the server both read it.
 */

const ANA = { id: "u-ana", name: "Ana Cruz" };
const BEN = { id: "u-ben", name: "Ben Reyes" };
const IVAN = { id: "u-ivan", name: "Ivan Tan" };

// 10:42 in Manila (UTC+8)
const AT = new Date("2026-10-21T02:42:00Z");
const after = (min: number) => new Date(AT.getTime() + min * 60_000);

let seq = 0;
function entry(action: string, extra: Partial<UndoEntry> = {}): UndoEntry {
  seq += 1;
  return {
    id: `e${seq}`, actorId: ANA.id, actorLabel: ANA.name, entityType: "asset", action, diff: null, createdAt: AT, ...extra,
  };
}

const APPROVED: UndoAsset = { financeConfirmedAt: AT, financeReturnedAt: null };
const TO_REVIEW: UndoAsset = { financeConfirmedAt: null, financeReturnedAt: null };
const SENT_BACK: UndoAsset = { financeConfirmedAt: null, financeReturnedAt: AT };

const approve = (extra: Partial<UndoEntry> = {}) => entry("finance.confirm", { diff: { financeConfirmed: { from: null, to: ANA.name } }, ...extra });
const sendBack = (extra: Partial<UndoEntry> = {}) =>
  entry("finance.return", { diff: { financeReturn: { from: null, to: { fields: ["Cost"], note: "Check the OR" } } }, ...extra });
const override = (extra: Partial<UndoEntry> = {}) => entry("depreciation.override", {
  diff: { lifeMonths: { from: null, to: 24 }, salvage: { from: null, to: 1000 }, note: { from: null, to: "Field use" } }, ...extra,
});

describe("undoState: the person who did it, within 15 minutes", () => {
  it("offers the approval to its approver, with the minutes left and the banner's words", () => {
    const s = undoState(APPROVED, [approve()], ANA.id, after(3));
    expect(s).toMatchObject({ kind: "approve", at: AT, minutesLeft: 12, label: "You approved this at 10:42" });
  });

  it("names an approval as not capitalised", () => {
    const e = approve({ diff: { financeConfirmed: { from: null, to: ANA.name }, notCapitalised: { from: false, to: true } } });
    expect(undoState(APPROVED, [e], ANA.id, after(1))?.label).toBe("You approved this as not capitalised at 10:42");
  });

  it("offers a send-back and a settings change the same way", () => {
    expect(undoState(SENT_BACK, [sendBack()], ANA.id, after(1))).toMatchObject({ kind: "send-back", label: "You sent this back at 10:42" });
    expect(undoState(APPROVED, [override()], ANA.id, after(1))).toMatchObject({
      kind: "settings", label: "You changed the depreciation settings at 10:42",
    });
    const cleared = entry("depreciation.override.cleared", {
      diff: { lifeMonths: { from: 24, to: null }, salvage: { from: 1000, to: null }, note: { from: "Field use", to: null } },
    });
    expect(undoState(APPROVED, [cleared], ANA.id, after(1))?.kind).toBe("settings");
  });

  it("minutes left round up and never read 0 inside the window", () => {
    expect(undoState(APPROVED, [approve()], ANA.id, after(14.5))?.minutesLeft).toBe(1);
    expect(undoState(APPROVED, [approve()], ANA.id, AT)?.minutesLeft).toBe(15);
  });

  it("is null for anyone else (Review Focus 2)", () => {
    expect(undoState(APPROVED, [approve()], BEN.id, after(1))).toBeNull();
    const r = undoCheck(APPROVED, [approve()], BEN.id, after(1));
    expect(r).toEqual({ ok: false, reason: "Can't undo: only Ana Cruz can undo this." });
  });

  it("is null once 15 minutes have passed, by the server's clock (Review Focus 2)", () => {
    expect(UNDO_WINDOW_MS).toBe(15 * 60 * 1000);
    expect(undoState(APPROVED, [approve()], ANA.id, after(14.99))).not.toBeNull();
    expect(undoState(APPROVED, [approve()], ANA.id, after(15))).toBeNull();
    expect(undoCheck(APPROVED, [approve()], ANA.id, after(20))).toEqual({
      ok: false, reason: "Can't undo: the 15 minutes to undo it ended at 10:57.",
    });
  });
});

describe("undoState: only while it is the latest finance change (Review Focus 1)", () => {
  it("refuses after IT resubmitted, naming who and when", () => {
    const entries = [sendBack(), entry("finance.resubmit", { actorId: IVAN.id, actorLabel: IVAN.name, createdAt: after(2) })];
    expect(undoState(TO_REVIEW, entries, ANA.id, after(3))).toBeNull();
    expect(undoCheck(TO_REVIEW, entries, ANA.id, after(3), "send-back")).toEqual({
      ok: false, reason: "Can't undo: Ivan Tan resubmitted the asset to Finance at 10:44.",
    });
  });

  it("refuses after another finance change: a cost change, a settings change, another review", () => {
    const cost = entry("update", { actorId: IVAN.id, actorLabel: IVAN.name, diff: { cost: { from: 100, to: 200 } }, createdAt: after(1) });
    expect(undoCheck(APPROVED, [approve(), cost], ANA.id, after(2), "approve")).toEqual({
      ok: false, reason: "Can't undo: Ivan Tan changed the cost at 10:43.",
    });
    const mine = override({ createdAt: after(1) });
    expect(undoCheck(APPROVED, [approve(), mine], ANA.id, after(2), "approve")).toEqual({
      ok: false, reason: "Can't undo: you set a custom depreciation at 10:43.",
    });
    const purchase = entry("update", { entityType: "purchase-record", diff: { fees: { from: 0, to: 500 } }, createdAt: after(1) });
    expect(undoState(APPROVED, [approve(), purchase], ANA.id, after(2))).toBeNull();
  });

  it("an undo is itself the latest change: nothing left to undo", () => {
    const undone = entry("finance.confirm.undone", { createdAt: after(1) });
    expect(undoCheck(TO_REVIEW, [approve(), undone], ANA.id, after(2))).toEqual({
      ok: false, reason: "Can't undo: you undid the approval at 10:43.",
    });
  });

  it("changes that are not finance changes do not block it: a location edit, a note, a document, the category's policy", () => {
    const later = { createdAt: after(1) };
    const entries = [
      approve(),
      entry("update", { diff: { location: { from: "A", to: "B" } }, ...later }),
      entry("lifecycle.assign", later),
      entry("note.posted", later),
      entry("document.uploaded", { diff: { document: { from: null, to: "or.pdf" } }, ...later }),
      entry("depreciation.policy", { entityType: "asset-category", ...later }),
      // on the purchase record too, where the history files everything under Cost (fix round 1)
      entry("document.uploaded", { entityType: "purchase-record", diff: { document: { from: null, to: "inv.pdf" } }, ...later }),
      entry("attachment.uploaded", { entityType: "purchase-record", ...later }),
      entry("note.posted", { entityType: "purchase-record", ...later }),
    ];
    expect(undoState(APPROVED, entries, ANA.id, after(2))?.kind).toBe("approve");
  });

  it("reads the latest by time, whatever order the entries come in", () => {
    const resubmit = entry("finance.resubmit", { createdAt: after(2) });
    expect(latestFinanceChange([resubmit, sendBack()])?.action).toBe("finance.resubmit");
  });

  it("a kind the caller asks for must be the latest one", () => {
    expect(undoCheck(APPROVED, [approve()], ANA.id, after(1), "settings")).toEqual({
      ok: false, reason: "Can't undo: you approved the asset for depreciation at 10:42.",
    });
  });

  it("refuses when the asset no longer matches the action (changed outside the audit trail)", () => {
    expect(undoState(TO_REVIEW, [approve()], ANA.id, after(1))).toBeNull();
    expect(undoState(APPROVED, [sendBack()], ANA.id, after(1))).toBeNull();
    expect(undoCheck(TO_REVIEW, [approve()], ANA.id, after(1))).toEqual({
      ok: false, reason: "Can't undo: the asset's review has changed since.",
    });
  });

  it("nothing to undo when there is no finance change at all", () => {
    expect(undoCheck(TO_REVIEW, [], ANA.id, after(1))).toEqual({ ok: false, reason: "Can't undo: there is no recent review action to undo." });
  });

  it("a send-back that replaced an earlier one, and a settings change saved without its earlier values, are final", () => {
    const second = sendBack({ diff: { financeReturn: { from: "returned", to: { fields: ["Cost"], note: null } } } });
    expect(undoCheck(SENT_BACK, [second], ANA.id, after(1))).toEqual({
      ok: false, reason: "Can't undo: this send-back replaced an earlier one.",
    });
    const legacy = entry("depreciation.override.cleared");
    expect(undoCheck(APPROVED, [legacy], ANA.id, after(1))).toEqual({
      ok: false, reason: "Can't undo: the earlier depreciation settings weren't recorded.",
    });
  });
});

describe("what an undo restores, from the original entry's diff", () => {
  it("approve: the not-capitalised flag's earlier value and IT's reply", () => {
    expect(approveRestore({ financeConfirmed: { from: null, to: "Ana" }, notCapitalised: { from: false, to: true } }))
      .toEqual({ notCapitalised: false, resubmitNote: null });
    expect(approveRestore({ notCapitalised: { from: true, to: false }, resubmitNote: { from: "Fixed the OR", to: null } }))
      .toEqual({ notCapitalised: true, resubmitNote: "Fixed the OR" });
    // no notCapitalised key: it was false before and after
    expect(approveRestore({ financeConfirmed: { from: null, to: "Ana" } })).toEqual({ notCapitalised: false, resubmitNote: null });
  });

  it("settings: the earlier override, exactly", () => {
    expect(settingsRestore({ lifeMonths: { from: 36, to: 24 }, salvage: { from: 500, to: 1000 }, note: { from: "Old", to: "New" } }))
      .toEqual({ lifeMonths: 36, salvage: 500, note: "Old" });
    expect(settingsRestore({ lifeMonths: { from: 24, to: null }, salvage: { from: 1000, to: null }, note: { from: "Field use", to: null } }))
      .toEqual({ lifeMonths: 24, salvage: 1000, note: "Field use" });
  });

  it("settings with no earlier override: back to the category policy, not zeros (Review Focus 5)", () => {
    expect(settingsRestore({ lifeMonths: { from: null, to: 24 }, salvage: { from: null, to: 1000 }, note: { from: null, to: "x" } }))
      .toEqual({ lifeMonths: null, salvage: null, note: null });
  });

  it("settings: null when the earlier values were not recorded", () => {
    expect(settingsRestore(null)).toBeNull();
  });
});
