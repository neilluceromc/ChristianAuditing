import { describe, expect, it } from "vitest";
import type { ApprovalState } from "@prisma/client";
import { approvalTransition, type QueueAction } from "./approval-flow";
import { approvalHeader, queueKeyAction, queueMoveKey, VERB_LABEL, type ApprovalVerb } from "./approval-header";
import { APPROVAL_KIND_LABEL, PRIORITY_LABEL } from "./labels";

const h = (state: ApprovalState, o: Partial<{ canAct: boolean; mine: boolean; isAdmin: boolean }> = {}) =>
  approvalHeader({ state, canAct: true, mine: false, isAdmin: false, ...o });

describe("approvalHeader — spec §4.1 with plan P-2", () => {
  it("PENDING: one-step Approve, Reject… visible, Claim and Escalate in More", () => {
    expect(h("PENDING")).toEqual({ primary: "approve-now", reject: true, more: ["claim", "escalate"] });
  });
  it("CLAIMED by me: Approve, Reject…, Release and Escalate", () => {
    expect(h("CLAIMED", { mine: true })).toEqual({ primary: "approve", reject: true, more: ["release", "escalate"] });
  });
  it("CLAIMED by someone else, admin: no primary (no override), Reject…, Release and Escalate", () => {
    expect(h("CLAIMED", { isAdmin: true })).toEqual({ primary: null, reject: true, more: ["release", "escalate"] });
  });
  it("CLAIMED by someone else, not admin: nothing", () => {
    expect(h("CLAIMED")).toEqual({ primary: null, reject: false, more: [] });
  });
  it("EXECUTION_FAILED: Retry and Reject…", () => {
    expect(h("EXECUTION_FAILED")).toEqual({ primary: "retry", reject: true, more: [] });
  });
  it("terminal states and roles that cannot act: nothing", () => {
    for (const s of ["APPROVED", "EXECUTED", "REJECTED"] as ApprovalState[]) expect(h(s)).toEqual({ primary: null, reject: false, more: [] });
    expect(h("PENDING", { canAct: false })).toEqual({ primary: null, reject: false, more: [] });
  });
  it("labels", () => {
    expect(VERB_LABEL).toEqual({
      "approve-now": "Approve", approve: "Approve", claim: "Claim", release: "Release", escalate: "Escalate", retry: "Retry",
    });
  });
  it("friendly priority and kind words", () => {
    expect(PRIORITY_LABEL).toEqual({ NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" });
    expect(APPROVAL_KIND_LABEL).toEqual({
      lifecycle_assign: "Assign", lifecycle_return: "Return", lifecycle_change_status: "Change status",
      lifecycle_replace: "Replace", lifecycle_transfer: "Transfer",
    });
  });
});

describe("approvalHeader never offers a verb approvalTransition refuses", () => {
  const states: ApprovalState[] = ["PENDING", "CLAIMED", "APPROVED", "EXECUTED", "EXECUTION_FAILED", "REJECTED"];
  const steps = (v: ApprovalVerb): QueueAction[] => (v === "approve-now" ? ["claim", "approve"] : [v]);
  for (const state of states) for (const mine of [false, true]) for (const isAdmin of [false, true]) {
    it(`${state} mine=${mine} admin=${isAdmin}`, () => {
      const r = approvalHeader({ state, canAct: true, mine, isAdmin });
      for (const v of [r.primary, ...r.more].filter((x): x is ApprovalVerb => x !== null)) {
        let s: ApprovalState = state;
        let owner = mine;
        for (const a of steps(v)) {
          const t = approvalTransition(s, a, { isOwner: owner, isAdmin });
          expect(t.ok, `${v} via ${a} from ${s}`).toBe(true);
          if (t.ok && t.next) s = t.next;
          if (a === "claim") owner = true;
        }
      }
      if (r.reject) expect(approvalTransition(state, "reject", { isOwner: mine, isAdmin }).ok).toBe(true);
    });
  }
});

describe("queueKeyAction — the queue's action keys (Phase 40 fix round 1)", () => {
  const press = (key: string, mods: Partial<{ repeat: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
    queueKeyAction({ key, repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });
  it("C claims, A runs the primary, E escalates, R rejects — either case", () => {
    expect(press("c")).toBe("claim");
    expect(press("A")).toBe("primary");
    expect(press("a")).toBe("primary");
    expect(press("e")).toBe("escalate");
    expect(press("r")).toBe("reject");
  });
  it("a held key's auto-repeat never fires an action again", () => {
    expect(press("a", { repeat: true })).toBeNull();
  });
  it("Ctrl/Cmd/Alt combinations stay the browser's (Ctrl+A selects all, it never approves)", () => {
    expect(press("a", { ctrlKey: true })).toBeNull();
    expect(press("a", { metaKey: true })).toBeNull();
    expect(press("r", { altKey: true })).toBeNull();
    expect(press("c", { ctrlKey: true })).toBeNull();
  });
  it("any other key is not an action key", () => {
    expect(press("j")).toBeNull();
    expect(press("Enter")).toBeNull();
  });
});

describe("queueMoveKey — J/K and the arrows move the cursor on a bare press (final review M2)", () => {
  const press = (key: string, mods: Partial<{ repeat: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
    queueMoveKey({ key, repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });
  it("J and ArrowDown move down, K and ArrowUp move up — either case", () => {
    expect(press("j")).toBe("down");
    expect(press("J")).toBe("down");
    expect(press("ArrowDown")).toBe("down");
    expect(press("k")).toBe("up");
    expect(press("K")).toBe("up");
    expect(press("ArrowUp")).toBe("up");
  });
  it("a held key keeps moving (auto-repeat is fine for moving)", () => {
    expect(press("j", { repeat: true })).toBe("down");
    expect(press("ArrowUp", { repeat: true })).toBe("up");
  });
  it("Ctrl/Cmd/Alt combinations stay the browser's — Ctrl+K opens the palette and never moves the cursor", () => {
    expect(press("k", { ctrlKey: true })).toBeNull();
    expect(press("k", { metaKey: true })).toBeNull();
    expect(press("j", { ctrlKey: true })).toBeNull();
    expect(press("j", { altKey: true })).toBeNull();
    expect(press("ArrowDown", { altKey: true })).toBeNull();
  });
  it("any other key is not a move", () => {
    expect(press("a")).toBeNull();
    expect(press("Enter")).toBeNull();
  });
});
