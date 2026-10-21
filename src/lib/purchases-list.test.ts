import { describe, expect, it } from "vitest";
import {
  PURCHASE_TABS, dwellLine, parsePurchaseState, purchaseWhere,
} from "./purchases-list";

const NOW = new Date("2026-08-17T09:00:00+08:00");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("parsePurchaseState — the ?state= tab contract", () => {
  it("accepts the four purchase-order states", () => {
    for (const s of ["WITH_IT", "SENT_BACK", "READY", "CANCELLED"] as const) {
      expect(parsePurchaseState(s)).toBe(s);
    }
  });
  it("treats anything else as All, including the old request states", () => {
    expect(parsePurchaseState(null)).toBeNull();
    expect(parsePurchaseState(undefined)).toBeNull();
    expect(parsePurchaseState("")).toBeNull();
    expect(parsePurchaseState("with_it")).toBeNull();
    expect(parsePurchaseState("DRAFT")).toBeNull();
    expect(parsePurchaseState("IT_REVIEWED")).toBeNull();
  });
});

describe("PURCHASE_TABS", () => {
  it("leads with All and covers every state, hrefs writing ?state=", () => {
    expect(PURCHASE_TABS[0]).toEqual({ id: "ALL", label: "All", href: "/purchases" });
    expect(PURCHASE_TABS.map((t) => t.id)).toEqual(["ALL", "WITH_IT", "SENT_BACK", "READY", "CANCELLED"]);
  });

  // Every href is pinned: the sidebar's Purchase orders views target these exact
  // URLs and currentNav matches on their `state`, so a typo in any one of them
  // silently stops highlighting that view.
  it("pins every tab's href and label", () => {
    expect(PURCHASE_TABS).toEqual([
      { id: "ALL", label: "All", href: "/purchases" },
      { id: "WITH_IT", label: "With IT", href: "/purchases?state=WITH_IT" },
      { id: "SENT_BACK", label: "Sent back", href: "/purchases?state=SENT_BACK" },
      { id: "READY", label: "Ready to register", href: "/purchases?state=READY" },
      { id: "CANCELLED", label: "Cancelled", href: "/purchases?state=CANCELLED" },
    ]);
  });
});

describe("purchaseWhere", () => {
  it("is empty for All with no search", () => {
    expect(purchaseWhere(null, "")).toEqual({});
  });
  it("filters by state", () => {
    expect(purchaseWhere("SENT_BACK", "")).toEqual({ state: "SENT_BACK" });
  });
  it("Ready to register leaves out completed POs (final review I3: 71 migrated completed requests on day one)", () => {
    expect(purchaseWhere("READY", "")).toEqual({ state: "READY", completedAt: null });
  });
  it("searches refNo and line descriptions (contains — the sanctioned use)", () => {
    expect(purchaseWhere(null, "monitor")).toEqual({
      OR: [
        { refNo: { contains: "monitor", mode: "insensitive" } },
        { lines: { some: { description: { contains: "monitor", mode: "insensitive" } } } },
      ],
    });
  });
  it("reads an old printed PR-0188 as PO-0188, and still searches the line descriptions for what was typed", () => {
    expect(purchaseWhere(null, "PR-0188")).toEqual({
      OR: [
        { refNo: { contains: "PO-0188", mode: "insensitive" } },
        { lines: { some: { description: { contains: "PR-0188", mode: "insensitive" } } } },
      ],
    });
  });
  it("combines state and search", () => {
    const where = purchaseWhere("WITH_IT", "PO-0198");
    expect(where.state).toBe("WITH_IT");
    expect(where.OR).toHaveLength(2);
  });
  it("filters by requesting department, including the untagged bucket", () => {
    expect(purchaseWhere(null, "", "dep1").departmentId).toBe("dep1");
    expect(purchaseWhere(null, "", "none").departmentId).toBeNull();
    expect(purchaseWhere(null, "").departmentId).toBeUndefined();
  });
  it("filters by supplier", () => {
    expect(purchaseWhere("READY", "", null, "ven1")).toMatchObject({ state: "READY", vendorId: "ven1" });
  });
});

describe("dwellLine — how long it's been there, not derivable from the enum", () => {
  const row = (over: Partial<Parameters<typeof dwellLine>[0]> = {}) => ({
    state: "WITH_IT" as const, updatedAt: daysAgo(2), submittedAt: daysAgo(2),
    sentBackAt: null, cancelledAt: null, bounced: false, ...over,
  });

  it("names the bounce-back before anything else", () => {
    expect(dwellLine(row({ state: "WITH_IT", bounced: true, updatedAt: daysAgo(1) }), NOW))
      .toBe("back from finance · 1 d");
    expect(dwellLine(row({ state: "SENT_BACK", bounced: true, updatedAt: daysAgo(3) }), NOW))
      .toBe("sent back · 3 d");
    expect(dwellLine(row({ state: "SENT_BACK", sentBackAt: daysAgo(2), updatedAt: daysAgo(1) }), NOW))
      .toBe("sent back · 2 d");
  });
  it("says who is waiting, and for how long", () => {
    expect(dwellLine(row({ submittedAt: daysAgo(2) }), NOW)).toBe("with IT · 2 d");
    expect(dwellLine(row({ state: "READY", updatedAt: daysAgo(5) }), NOW)).toBe("ready to register · 5 d");
  });
  it("reads today for anything under a day", () => {
    expect(dwellLine(row({ submittedAt: new Date(NOW.getTime() - 3_600_000) }), NOW)).toBe("with IT · today");
  });
  it("closes out cancelled rows", () => {
    expect(dwellLine(row({ state: "CANCELLED", cancelledAt: daysAgo(48) }), NOW)).toBe("cancelled 48 d ago");
  });
  it("describes a never-sent legacy draft by its last edit", () => {
    expect(dwellLine(row({ state: "SENT_BACK", submittedAt: null, updatedAt: daysAgo(4) }), NOW))
      .toBe("with Purchasing · edited 4 d ago");
  });
  it("falls back to updatedAt when a stamp is missing rather than printing NaN", () => {
    expect(dwellLine(row({ submittedAt: null, updatedAt: daysAgo(6) }), NOW)).toBe("with IT · 6 d");
  });
  it("never says 'today ago'", () => {
    expect(dwellLine(row({ state: "SENT_BACK", submittedAt: null, updatedAt: NOW }), NOW)).toBe("with Purchasing · edited today");
    expect(dwellLine(row({ state: "CANCELLED", cancelledAt: NOW }), NOW)).toBe("cancelled today");
  });
});
