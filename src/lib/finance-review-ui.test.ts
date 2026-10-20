import { describe, expect, it, vi } from "vitest";
import { fmtMoneyExact } from "./format";
import type { UndoAsset, UndoEntry } from "./finance-undo";
import {
  approveDetail, approveToast, canReopenReview, minutesLeftAt, reopenReasonError, runFinanceUndo, sendBackToast, settingsToast,
  undoBanner, type ReviewToastDeps,
} from "./finance-review-ui";

/*
 * Finance follow-up, Task 3 (spec §4): what each review action's toast says and which buttons it carries, what Undo
 * does when pressed (Review Focus 3: after the page moved on to the next asset), the asset page's Undo banner, and
 * who sees Reopen review.
 */

const deps = (): ReviewToastDeps & { undo: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn> } => ({ undo: vi.fn(), open: vi.fn() });

describe("approveDetail (spec §4: 'Depreciation starts Oct 2026 · ₱2,131.11 a month')", () => {
  it("names the start month (the purchase month) and the monthly charge", () => {
    const d = approveDetail({ costC: 102_293_28, policy: { lifeMonths: 48, salvage: 0, basis: "category" }, startMonth: 2026 * 12 + 9, category: "Laptops" });
    expect(d).toBe(`Depreciation starts Oct 2026 · ${fmtMoneyExact(2131.11)} a month`);
  });
  it("says so when the category has no policy, or the salvage is not below cost", () => {
    expect(approveDetail({ costC: 1000_00, policy: null, startMonth: 2026 * 12, category: "Laptops" })).toBe("No depreciation policy for Laptops yet");
    expect(approveDetail({ costC: 1000_00, policy: { lifeMonths: 12, salvage: 1000_00, basis: "custom" }, startMonth: 2026 * 12, category: "Laptops" }))
      .toBe("Salvage is not below cost, so it does not depreciate");
  });
  it("is null with no cost (approved as not capitalised)", () => {
    expect(approveDetail({ costC: null, policy: null, startMonth: null, category: "Laptops" })).toBeNull();
  });
});

describe("approveToast", () => {
  const base = { assetId: "a1", tag: "BR-LT-0201", notCapitalised: false, detail: "Depreciation starts Oct 2026 · ₱2,131.11 a month" };

  it("moved to the next asset: names it and the count left, with Undo and Open <tag>", () => {
    const d = deps();
    const t = approveToast({ ...base, next: { id: "a4", tag: "BR-LT-0204" }, remaining: 3 }, d);
    expect(t.message).toBe("Approved BR-LT-0201");
    expect(t.detail).toBe("Depreciation starts Oct 2026 · ₱2,131.11 a month\nNext: BR-LT-0204 · 3 left to review");
    expect(t.actions?.map((a) => a.label)).toEqual(["Undo", "Open BR-LT-0201"]);
    t.actions![0].onAction();
    expect(d.undo).toHaveBeenCalledWith({ assetId: "a1", tag: "BR-LT-0201", kind: "approve" });
    t.actions![1].onAction();
    expect(d.open).toHaveBeenCalledWith("a1");
  });

  it("one left reads in the singular", () => {
    expect(approveToast({ ...base, next: { id: "a4", tag: "BR-LT-0204" }, remaining: 1 }, deps()).detail).toContain("Next: BR-LT-0204 · 1 left to review");
  });

  it("nothing left: says so, and has no Open (the page did not move)", () => {
    const t = approveToast({ ...base, next: null, remaining: 0 }, deps());
    expect(t.detail).toBe("Depreciation starts Oct 2026 · ₱2,131.11 a month\nNothing left to review");
    expect(t.actions?.map((a) => a.label)).toEqual(["Undo"]);
  });

  it("as not capitalised", () => {
    const t = approveToast({ ...base, notCapitalised: true, detail: null, next: null, remaining: 0 }, deps());
    expect(t.message).toBe("Approved BR-LT-0201 as not capitalised");
    expect(t.detail).toBe("Nothing left to review");
  });
});

describe("sendBackToast", () => {
  it("names the department and what was flagged, with Undo", () => {
    const d = deps();
    const t = sendBackToast({ assetId: "a1", tag: "BR-LT-0201", deptLabel: "IT", flagged: ["Official receipt"], note: "" }, d);
    expect(t).toMatchObject({ message: "Sent BR-LT-0201 back to IT", detail: "Flagged: Official receipt" });
    expect(t.actions?.map((a) => a.label)).toEqual(["Undo"]);
    t.actions![0].onAction();
    expect(d.undo).toHaveBeenCalledWith({ assetId: "a1", tag: "BR-LT-0201", kind: "send-back" });
  });
  it("only a note: quotes it; nothing at all: no detail", () => {
    expect(sendBackToast({ assetId: "a1", tag: "T", deptLabel: "Purchasing", flagged: [], note: "Wrong supplier" }, deps()).detail)
      .toBe("Note: “Wrong supplier”");
    expect(sendBackToast({ assetId: "a1", tag: "T", deptLabel: "IT", flagged: [], note: " " }, deps()).detail).toBeUndefined();
  });
});

describe("settingsToast", () => {
  it("saved: the life in months and the salvage, with Undo", () => {
    const d = deps();
    const t = settingsToast({ assetId: "a1", tag: "BR-LT-0201", saved: { lifeMonths: 48, salvagePesos: 0 } }, d);
    expect(t).toMatchObject({ message: "Saved BR-LT-0201's depreciation settings", detail: `48 months, ${fmtMoneyExact(0)} salvage` });
    t.actions![0].onAction();
    expect(d.undo).toHaveBeenCalledWith({ assetId: "a1", tag: "BR-LT-0201", kind: "settings" });
  });
  it("cleared: back to the category policy", () => {
    const t = settingsToast({ assetId: "a1", tag: "BR-LT-0201", saved: null }, deps());
    expect(t).toMatchObject({ message: "Cleared BR-LT-0201's depreciation settings", detail: "Back to the category policy" });
    expect(t.actions?.map((a) => a.label)).toEqual(["Undo"]);
  });
});

describe("runFinanceUndo (Review Focus 3: Undo from the toast after the page moved to the next asset)", () => {
  it("undoes the original asset by id, says so, and goes back to it", async () => {
    const call = vi.fn(async () => ({ ok: true as const, data: { tag: "BR-LT-0201", id: "a1" } }));
    const toast = vi.fn();
    const go = vi.fn();
    // The approve toast was built on a1's page; the page has since moved to a4. Its Undo still names a1.
    const t = approveToast(
      { assetId: "a1", tag: "BR-LT-0201", notCapitalised: false, detail: null, next: { id: "a4", tag: "BR-LT-0204" }, remaining: 2 },
      { undo: (target) => void runFinanceUndo(target, { call, toast, go }), open: go },
    );
    t.actions![0].onAction();
    await vi.waitFor(() => expect(go).toHaveBeenCalled());
    expect(call).toHaveBeenCalledWith({ assetId: "a1", kind: "approve" });
    expect(toast).toHaveBeenCalledWith("Undid the approval of BR-LT-0201", "settled");
    expect(go).toHaveBeenCalledWith("/finance/assets/a1");
  });

  it("names each kind it undid", async () => {
    const toast = vi.fn();
    const call = async () => ({ ok: true as const, data: { tag: "BR-LT-0201", id: "a1" } });
    await runFinanceUndo({ assetId: "a1", tag: "BR-LT-0201", kind: "send-back" }, { call, toast, go: vi.fn() });
    await runFinanceUndo({ assetId: "a1", tag: "BR-LT-0201", kind: "settings" }, { call, toast, go: vi.fn() });
    expect(toast.mock.calls.map((c) => c[0])).toEqual([
      "Undid the send-back of BR-LT-0201", "Undid the depreciation settings change of BR-LT-0201",
    ]);
  });

  it("a refusal: an error toast with the server's reason, and no navigation", async () => {
    const toast = vi.fn();
    const go = vi.fn();
    const call = async () => ({ ok: false as const, kind: "conflict" as const, message: "Can't undo: IT resubmitted it at 10:41." });
    await runFinanceUndo({ assetId: "a1", tag: "BR-LT-0201", kind: "approve" }, { call, toast, go });
    expect(toast).toHaveBeenCalledWith("Can't undo: IT resubmitted it at 10:41.", "fault");
    expect(go).not.toHaveBeenCalled();
  });

  it("rate limited: says when to try again", async () => {
    const toast = vi.fn();
    const call = async () => ({ ok: false as const, kind: "rate_limited" as const, message: "cap", retryAfterSec: 12 });
    await runFinanceUndo({ assetId: "a1", tag: "T", kind: "approve" }, { call, toast, go: vi.fn() });
    expect(toast).toHaveBeenCalledWith("Too many changes just now. Try Undo again in 12 s.", "fault");
  });
});

describe("undoBanner (the asset page, server-computed)", () => {
  const AT = new Date("2026-10-21T02:42:00Z"); // 10:42 in Manila
  const after = (min: number) => new Date(AT.getTime() + min * 60_000);
  const APPROVED: UndoAsset = { financeConfirmedAt: AT, financeReturnedAt: null };
  const approve: UndoEntry = {
    id: "e1", actorId: "u-ana", actorLabel: "Ana Cruz", entityType: "asset", action: "finance.confirm",
    diff: { financeConfirmed: { from: null, to: "Ana Cruz" } }, createdAt: AT,
  };

  it("shows for the person who acted, within the window: the words, the minutes and when it ends", () => {
    expect(undoBanner(APPROVED, [approve], "u-ana", after(3))).toEqual({
      kind: "approve", label: "You approved this at 10:42", minutesLeft: 12, endsAt: AT.getTime() + 15 * 60_000, msLeft: 12 * 60_000,
    });
  });
  it("never for anyone else, and not once the 15 minutes are up", () => {
    expect(undoBanner(APPROVED, [approve], "u-ben", after(3))).toBeNull();
    expect(undoBanner(APPROVED, [approve], "u-ana", after(15))).toBeNull();
  });
  it("the client's countdown: whole minutes rounded up, 0 once it ends", () => {
    const ends = AT.getTime() + 15 * 60_000;
    expect(minutesLeftAt(ends, AT.getTime() + 3 * 60_000)).toBe(12);
    expect(minutesLeftAt(ends, ends - 1)).toBe(1);
    expect(minutesLeftAt(ends, ends)).toBe(0);
    expect(minutesLeftAt(ends, ends + 60_000)).toBe(0);
  });
});

describe("Reopen review", () => {
  it("admins only, approved assets only", () => {
    expect(canReopenReview("admin", new Date())).toBe(true);
    expect(canReopenReview("finance_staff", new Date())).toBe(false);
    expect(canReopenReview("admin", null)).toBe(false);
  });
  it("the reason: 5 to 300 characters after cleaning", () => {
    expect(reopenReasonError("Wrong")).toBeNull();
    expect(reopenReasonError("x".repeat(300))).toBeNull();
    expect(reopenReasonError("abcd")).toBe("Give a reason of 5 to 300 characters");
    expect(reopenReasonError("  ab​  ")).toBe("Give a reason of 5 to 300 characters");
    expect(reopenReasonError("x".repeat(301))).toBe("Give a reason of 5 to 300 characters");
  });
});
