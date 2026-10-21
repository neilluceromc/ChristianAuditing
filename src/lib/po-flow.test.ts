import { describe, expect, it } from "vitest";
import {
  PO_STATE_LABEL, canRegisterLine, legacyPoState, lineProgress, poProgress, poRefNo, stateAfterResubmit, stateAfterSave,
} from "./po-flow";

describe("stateAfterSave", () => {
  it("Purchasing-only lines are ready to register; any IT or legacy line goes to IT", () => {
    expect(stateAfterSave([{ cls: "PURCHASING" }])).toBe("READY");
    expect(stateAfterSave([{ cls: "PURCHASING" }, { cls: "IT" }])).toBe("WITH_IT");
    expect(stateAfterSave([{ cls: "PURCHASING" }, { cls: null }])).toBe("WITH_IT");
    expect(stateAfterSave([{ cls: "IT" }])).toBe("WITH_IT");
  });
});

describe("stateAfterResubmit", () => {
  it("IT's send-back returns to IT; Finance's goes straight to ready", () => {
    expect(stateAfterResubmit("IT")).toBe("WITH_IT");
    expect(stateAfterResubmit("FINANCE")).toBe("READY");
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
  it("pads the PO number to four digits", () => {
    expect(poRefNo(188)).toBe("PO-0188");
    expect(poRefNo(1)).toBe("PO-0001");
    expect(poRefNo(12345)).toBe("PO-12345");
  });
});
