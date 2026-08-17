import { describe, expect, it } from "vitest";
import {
  PURCHASE_ACTION_ROLES, PURCHASE_NOTE_KIND, REASON_REQUIRED, canAct, purchaseTransition,
  unitEditorMode, type PurchaseAction,
} from "./purchase-flow";

const ALL_STATES = ["DRAFT", "SUBMITTED", "IT_REVIEWED", "COMPLETED", "CANCELLED"] as const;
const ALL_ACTIONS: PurchaseAction[] = ["submit", "it-review", "it-reject", "request-info", "cancel", "complete"];

describe("purchaseTransition — brief §6.1, exact", () => {
  it("submit only from DRAFT, purchasing or admin", () => {
    expect(purchaseTransition("DRAFT", "submit", "purchasing_staff")).toEqual({ ok: true, next: "SUBMITTED" });
    expect(purchaseTransition("DRAFT", "submit", "admin")).toEqual({ ok: true, next: "SUBMITTED" });
    expect(purchaseTransition("DRAFT", "submit", "it_staff").ok).toBe(false);
    for (const s of ["SUBMITTED", "IT_REVIEWED", "COMPLETED", "CANCELLED"] as const) {
      expect(purchaseTransition(s, "submit", "purchasing_staff").ok).toBe(false);
    }
  });

  it("it-review only from SUBMITTED, IT or admin", () => {
    expect(purchaseTransition("SUBMITTED", "it-review", "it_staff")).toEqual({ ok: true, next: "IT_REVIEWED" });
    expect(purchaseTransition("SUBMITTED", "it-review", "admin")).toEqual({ ok: true, next: "IT_REVIEWED" });
    expect(purchaseTransition("SUBMITTED", "it-review", "finance_staff").ok).toBe(false);
    expect(purchaseTransition("DRAFT", "it-review", "it_staff").ok).toBe(false);
    expect(purchaseTransition("IT_REVIEWED", "it-review", "it_staff").ok).toBe(false);
  });

  it("it-reject sends SUBMITTED back to DRAFT — the loop, not a dead end", () => {
    expect(purchaseTransition("SUBMITTED", "it-reject", "it_staff")).toEqual({ ok: true, next: "DRAFT" });
    expect(purchaseTransition("IT_REVIEWED", "it-reject", "it_staff").ok).toBe(false);
    expect(purchaseTransition("SUBMITTED", "it-reject", "purchasing_staff").ok).toBe(false);
  });

  it("request-info sends IT_REVIEWED back to SUBMITTED — finance's bounce-back", () => {
    expect(purchaseTransition("IT_REVIEWED", "request-info", "finance_staff")).toEqual({ ok: true, next: "SUBMITTED" });
    expect(purchaseTransition("IT_REVIEWED", "request-info", "admin")).toEqual({ ok: true, next: "SUBMITTED" });
    expect(purchaseTransition("SUBMITTED", "request-info", "finance_staff").ok).toBe(false);
    expect(purchaseTransition("IT_REVIEWED", "request-info", "it_staff").ok).toBe(false);
  });

  it("cancel from any non-terminal state; COMPLETED and CANCELLED are terminal", () => {
    for (const s of ["DRAFT", "SUBMITTED", "IT_REVIEWED"] as const) {
      expect(purchaseTransition(s, "cancel", "purchasing_staff")).toEqual({ ok: true, next: "CANCELLED" });
    }
    expect(purchaseTransition("COMPLETED", "cancel", "admin").ok).toBe(false);
    expect(purchaseTransition("CANCELLED", "cancel", "admin").ok).toBe(false);
    expect(purchaseTransition("DRAFT", "cancel", "finance_staff").ok).toBe(false);
  });

  it("complete only from IT_REVIEWED, finance or admin", () => {
    expect(purchaseTransition("IT_REVIEWED", "complete", "finance_staff")).toEqual({ ok: true, next: "COMPLETED" });
    expect(purchaseTransition("SUBMITTED", "complete", "finance_staff").ok).toBe(false);
    expect(purchaseTransition("IT_REVIEWED", "complete", "purchasing_staff").ok).toBe(false);
  });

  it("COMPLETED and CANCELLED refuse every action", () => {
    for (const action of ALL_ACTIONS) {
      expect(purchaseTransition("COMPLETED", action, "admin").ok).toBe(false);
      expect(purchaseTransition("CANCELLED", action, "admin").ok).toBe(false);
    }
  });

  it("viewer can do nothing at all", () => {
    for (const state of ALL_STATES) {
      for (const action of ALL_ACTIONS) {
        expect(purchaseTransition(state, action, "viewer").ok).toBe(false);
      }
    }
  });

  it("admin can do everything the state allows", () => {
    expect(purchaseTransition("DRAFT", "submit", "admin").ok).toBe(true);
    expect(purchaseTransition("SUBMITTED", "it-review", "admin").ok).toBe(true);
    expect(purchaseTransition("SUBMITTED", "it-reject", "admin").ok).toBe(true);
    expect(purchaseTransition("IT_REVIEWED", "request-info", "admin").ok).toBe(true);
    expect(purchaseTransition("IT_REVIEWED", "complete", "admin").ok).toBe(true);
    expect(purchaseTransition("DRAFT", "cancel", "admin").ok).toBe(true);
  });

  it("every refusal message is real English — no 'completeed', no 'request infoed'", () => {
    for (const action of ALL_ACTIONS) {
      for (const state of ALL_STATES) {
        const r = purchaseTransition(state, action, "viewer"); // viewer fails the role check
        if (!r.ok) expect(r.error).not.toMatch(/eed\b|infoed|canceled/);
      }
      const wrongState = purchaseTransition("COMPLETED", action, "admin");
      expect(wrongState.ok).toBe(false);
      if (!wrongState.ok) expect(wrongState.error).not.toMatch(/eed\b|infoed|canceled/);
    }
    expect(purchaseTransition("DRAFT", "complete", "admin")).toEqual({
      ok: false,
      error: "A DRAFT request can't be completed — it must be IT_REVIEWED.",
    });
    expect(purchaseTransition("SUBMITTED", "request-info", "admin")).toEqual({
      ok: false,
      error: "A SUBMITTED request can't be sent back for more information — it must be IT_REVIEWED.",
    });
    expect(purchaseTransition("SUBMITTED", "it-review", "purchasing_staff")).toEqual({
      ok: false,
      error: "Only IT (or an admin) can mark a request IT-reviewed.",
    });
  });

  it("failures carry a human reason naming the role or the state", () => {
    const wrongRole = purchaseTransition("SUBMITTED", "it-review", "purchasing_staff");
    expect(wrongRole.ok).toBe(false);
    if (!wrongRole.ok) expect(wrongRole.error).toMatch(/IT/i);
    const wrongState = purchaseTransition("DRAFT", "complete", "finance_staff");
    expect(wrongState.ok).toBe(false);
    if (!wrongState.ok) expect(wrongState.error).toMatch(/DRAFT/);
  });
});

describe("canAct — the UI asks the same function the action does", () => {
  it("is true exactly when the transition would be allowed", () => {
    expect(canAct("DRAFT", "submit", "purchasing_staff")).toBe(true);
    expect(canAct("DRAFT", "submit", "viewer")).toBe(false);
    expect(canAct("IT_REVIEWED", "complete", "finance_staff")).toBe(true);
    expect(canAct("IT_REVIEWED", "complete", "it_staff")).toBe(false);
  });
});

describe("unitEditorMode", () => {
  it("gives IT the slot editor while SUBMITTED and finance the unit editor while IT_REVIEWED", () => {
    expect(unitEditorMode("SUBMITTED", "it_staff")).toBe("it");
    expect(unitEditorMode("SUBMITTED", "admin")).toBe("it");
    expect(unitEditorMode("IT_REVIEWED", "finance_staff")).toBe("finance");
    expect(unitEditorMode("IT_REVIEWED", "admin")).toBe("finance");
    expect(unitEditorMode("SUBMITTED", "finance_staff")).toBeNull();
    expect(unitEditorMode("DRAFT", "admin")).toBeNull();
    expect(unitEditorMode("COMPLETED", "finance_staff")).toBeNull();
    expect(unitEditorMode("SUBMITTED", "viewer")).toBeNull();
  });
});

describe("action metadata", () => {
  it("maps every action to its NoteKind", () => {
    expect(PURCHASE_NOTE_KIND).toEqual({
      submit: "SUBMIT", "it-review": "IT_REVIEW", "it-reject": "IT_REJECT",
      "request-info": "REQUEST_INFO", cancel: "CANCEL", complete: "COMPLETE",
    });
  });
  it("requires a reason exactly for the three bounce/withdraw actions", () => {
    expect([...REASON_REQUIRED].sort()).toEqual(["cancel", "it-reject", "request-info"]);
  });
  it("gives admin every action and viewer none", () => {
    for (const action of ALL_ACTIONS) {
      expect(PURCHASE_ACTION_ROLES[action]).toContain("admin");
      expect(PURCHASE_ACTION_ROLES[action]).not.toContain("viewer");
    }
  });
});
