import { describe, expect, it } from "vitest";
import {
  PAID_BY_LABEL, PO_STATE_LABEL, canRegisterLine, legacyPoState, lineProgress, poProgress, poRefNo, poStateFor, stateAfterSave,
  poRefSearch, derivePoProgress,
} from "./po-flow";

describe("stateAfterSave", () => {
  it("Purchasing-only lines are ready to register; any IT or legacy line goes to IT", () => {
    expect(stateAfterSave([{ cls: "PURCHASING" }])).toBe("READY");
    expect(stateAfterSave([{ cls: "PURCHASING" }, { cls: "IT" }])).toBe("WITH_IT");
    expect(stateAfterSave([{ cls: "PURCHASING" }, { cls: null }])).toBe("WITH_IT");
    expect(stateAfterSave([{ cls: "IT" }])).toBe("WITH_IT");
  });
});

describe("poStateFor (one rule for the remaining IT work)", () => {
  const it_ = (remaining: number) => ({ cls: "IT" as const, remaining });
  const chairs = (remaining: number) => ({ cls: "PURCHASING" as const, remaining });
  it("WITH_IT while an IT or unclassified line has units left and no IT unit is registered", () => {
    expect(poStateFor({ state: "WITH_IT", lines: [it_(5), chairs(4)], itRegistered: false })).toBe("WITH_IT");
    expect(poStateFor({ state: "READY", lines: [it_(5)], itRegistered: false })).toBe("WITH_IT");
    expect(poStateFor({ state: "WITH_IT", lines: [{ cls: null, remaining: 1 }], itRegistered: false })).toBe("WITH_IT");
  });
  it("READY once IT has registered a unit, or no IT work is left (closed short or done)", () => {
    expect(poStateFor({ state: "WITH_IT", lines: [it_(4), chairs(4)], itRegistered: true })).toBe("READY");
    expect(poStateFor({ state: "WITH_IT", lines: [it_(0), chairs(4)], itRegistered: false })).toBe("READY");
    expect(poStateFor({ state: "WITH_IT", lines: [chairs(4)], itRegistered: false })).toBe("READY");
    expect(poStateFor({ state: "WITH_IT", lines: [], itRegistered: false })).toBe("READY");
  });
  it("a cancelled or sent-back PO stays where it is", () => {
    expect(poStateFor({ state: "CANCELLED", lines: [it_(5)], itRegistered: false })).toBe("CANCELLED");
    expect(poStateFor({ state: "SENT_BACK", lines: [chairs(0)], itRegistered: true })).toBe("SENT_BACK");
  });
});

describe("lineProgress", () => {
  it("counts what is left and words it", () => {
    expect(lineProgress({ qty: 5, registered: 3, closedShort: 0 })).toEqual({ remaining: 2, label: "3 of 5 registered" });
    expect(lineProgress({ qty: 5, registered: 3, closedShort: 2 })).toEqual({ remaining: 0, label: "3 of 5 registered · 2 closed short" });
    expect(lineProgress({ qty: 5, registered: 0, closedShort: 0 }).label).toBe("0 of 5 registered");
  });
  it("never goes negative", () => {
    expect(lineProgress({ qty: 2, registered: 3, closedShort: 0 }).remaining).toBe(0);
  });
});

describe("poProgress", () => {
  it("is null before anything is registered", () => {
    expect(poProgress([{ qty: 2, registered: 0, closedShort: 0 }], false)).toBeNull();
    expect(poProgress([], false)).toBeNull();
  });
  it("is Partly registered while any line has units left", () => {
    expect(poProgress([{ qty: 2, registered: 1, closedShort: 0 }, { qty: 1, registered: 1, closedShort: 0 }], false)).toBe("Partly registered");
  });
  it("is Registered once every line is registered or closed short", () => {
    expect(poProgress([{ qty: 2, registered: 1, closedShort: 1 }, { qty: 1, registered: 1, closedShort: 0 }], false)).toBe("Registered");
  });
  it("is Approved when everything is registered and every asset approved", () => {
    expect(poProgress([{ qty: 2, registered: 2, closedShort: 0 }], true)).toBe("Approved");
  });
  it("does not read Approved while lines are still open", () => {
    expect(poProgress([{ qty: 2, registered: 1, closedShort: 0 }], true)).toBe("Partly registered");
  });
});

describe("canRegisterLine", () => {
  it("Purchasing cannot register IT gear, IT cannot register the rest", () => {
    expect(canRegisterLine("purchasing_staff", "IT", "READY")).toEqual({ ok: false, why: "IT registers IT gear" });
    expect(canRegisterLine("it_staff", "PURCHASING", "READY")).toEqual({ ok: false, why: "Purchasing registers these items" });
  });
  it("owners and admin can register in WITH_IT and READY", () => {
    for (const state of ["WITH_IT", "READY"] as const) {
      expect(canRegisterLine("it_staff", "IT", state)).toEqual({ ok: true });
      expect(canRegisterLine("purchasing_staff", "PURCHASING", state)).toEqual({ ok: true });
      expect(canRegisterLine("admin", "IT", state)).toEqual({ ok: true });
      expect(canRegisterLine("admin", "PURCHASING", state)).toEqual({ ok: true });
    }
  });
  it("SENT_BACK and CANCELLED refuse everyone", () => {
    for (const state of ["SENT_BACK", "CANCELLED"] as const) {
      for (const role of ["admin", "it_staff", "purchasing_staff"] as const) {
        for (const cls of ["IT", "PURCHASING"] as const) expect(canRegisterLine(role, cls, state).ok).toBe(false);
      }
    }
  });
  it("Finance and viewers cannot register", () => {
    expect(canRegisterLine("finance_staff", "IT", "READY").ok).toBe(false);
    expect(canRegisterLine("viewer", "PURCHASING", "READY").ok).toBe(false);
  });
});

describe("legacyPoState", () => {
  it("maps the five old states", () => {
    expect(legacyPoState("DRAFT")).toBe("SENT_BACK");
    expect(legacyPoState("SUBMITTED")).toBe("WITH_IT");
    expect(legacyPoState("IT_REVIEWED")).toBe("WITH_IT");
    expect(legacyPoState("COMPLETED")).toBe("READY");
    expect(legacyPoState("CANCELLED")).toBe("CANCELLED");
  });
});

describe("labels and refs", () => {
  it("labels every state", () => {
    expect(PO_STATE_LABEL).toEqual({ WITH_IT: "With IT", SENT_BACK: "Sent back to Purchasing", READY: "Ready to register", CANCELLED: "Cancelled" });
  });
  it("labels the two ways a PO is paid", () => {
    expect(PAID_BY_LABEL).toEqual({ CREDIT_CARD: "Credit card", DEBIT_CARD: "Debit card" });
  });
  it("pads the PO number to four digits", () => {
    expect(poRefNo(188)).toBe("PO-0188");
    expect(poRefNo(1)).toBe("PO-0001");
    expect(poRefNo(12345)).toBe("PO-12345");
  });
});

describe("poRefSearch", () => {
  it("maps an old printed PR- number onto its PO- number, so PR-0188 still finds PO-0188", () => {
    expect(poRefSearch("PR-0188")).toBe("PO-0188");
    expect(poRefSearch("pr-188")).toBe("PO-188");
    expect(poRefSearch("  Pr-01 ")).toBe("PO-01");
    expect(poRefSearch("PR-")).toBe("PO-");
  });
  it("leaves everything else alone", () => {
    expect(poRefSearch("PO-0188")).toBe("PO-0188");
    expect(poRefSearch("laptop")).toBe("laptop");
    expect(poRefSearch("printer")).toBe("printer");
    expect(poRefSearch("0188")).toBe("0188");
    expect(poRefSearch("x PR-1")).toBe("x PR-1");
  });
});

describe("derivePoProgress (an old completed request has linked assets but no line links)", () => {
  const legacyLines = [{ qty: 3, registered: 0, closedShort: 0 }];
  it("all linked assets approved → Approved", () => {
    expect(derivePoProgress(legacyLines, { assetCount: 3, approvedCount: 3, completed: true })).toBe("Approved");
  });
  it("2 of 3 approved → Registered, not Partly registered and not null", () => {
    expect(derivePoProgress(legacyLines, { assetCount: 3, approvedCount: 2, completed: true })).toBe("Registered");
    expect(derivePoProgress(legacyLines, { assetCount: 3, approvedCount: 0, completed: false })).toBe("Registered");
  });
  it("a completed request with no linked asset reads Registered, never Approved", () => {
    expect(derivePoProgress(legacyLines, { assetCount: 0, approvedCount: 0, completed: true })).toBe("Registered");
  });
  it("a PO nothing has been registered from has no progress", () => {
    expect(derivePoProgress(legacyLines, { assetCount: 0, approvedCount: 0, completed: false })).toBeNull();
    expect(derivePoProgress([{ qty: 5, registered: 0, closedShort: 0 }], { assetCount: 0, approvedCount: 0, completed: false })).toBeNull();
  });
  it("a PO with line links keeps poProgress's reading", () => {
    expect(derivePoProgress([{ qty: 5, registered: 3, closedShort: 0 }], { assetCount: 3, approvedCount: 3, completed: false })).toBe("Partly registered");
    expect(derivePoProgress([{ qty: 3, registered: 3, closedShort: 0 }], { assetCount: 3, approvedCount: 1, completed: false })).toBe("Registered");
    expect(derivePoProgress([{ qty: 3, registered: 3, closedShort: 0 }], { assetCount: 3, approvedCount: 3, completed: false })).toBe("Approved");
  });
});

describe("derivePoProgress after Task 5 registers on a migrated PO (carried finding)", () => {
  // A migrated request: its old assets are linked to the PO but to no line. Registering one more today links it to
  // its line, so "some line is linked" no longer means "every asset is line-linked".
  const lines = [{ qty: 3, registered: 1, closedShort: 0 }, { qty: 2, registered: 0, closedShort: 0 }];
  it("a completed request that gets one more asset still reads off the asset counts, never Partly registered", () => {
    expect(derivePoProgress(lines, { assetCount: 6, approvedCount: 5, completed: true })).toBe("Registered");
    expect(derivePoProgress(lines, { assetCount: 6, approvedCount: 6, completed: true })).toBe("Approved");
  });
  it("an open request with old linked assets plus a new one reads Registered, as it did before the new one", () => {
    expect(derivePoProgress(lines, { assetCount: 3, approvedCount: 0, completed: false })).toBe("Registered");
  });
  it("a completed request with no old assets whose first asset is registered now still reads Registered", () => {
    expect(derivePoProgress(lines, { assetCount: 1, approvedCount: 0, completed: true })).toBe("Registered");
  });
  it("a migrated open request with no old assets reads its lines like any PO", () => {
    expect(derivePoProgress(lines, { assetCount: 1, approvedCount: 0, completed: false })).toBe("Partly registered");
  });
});

describe("poProgress when every line is closed short and nothing was registered (confirmed: null)", () => {
  // Nothing arrived, so there is no registration progress to show: the PO reads its state, and Purchasing can still
  // cancel it (cancel needs nothing registered). Register is closed on it — no line has anything left.
  it("is null, through derivePoProgress too", () => {
    const shut = [{ qty: 2, registered: 0, closedShort: 2 }, { qty: 1, registered: 0, closedShort: 1 }];
    expect(poProgress(shut, false)).toBeNull();
    expect(derivePoProgress(shut, { assetCount: 0, approvedCount: 0, completed: false })).toBeNull();
    expect(shut.every((l) => lineProgress(l).remaining === 0)).toBe(true);
  });
});
