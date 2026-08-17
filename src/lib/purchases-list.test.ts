import { describe, expect, it } from "vitest";
import {
  PURCHASE_PAGE_SIZE, PURCHASE_TABS, dwellLine, parsePurchaseState, purchaseWhere,
} from "./purchases-list";

const NOW = new Date("2026-08-17T09:00:00+08:00");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("parsePurchaseState — the ?state= tab contract", () => {
  it("accepts the five real states", () => {
    for (const s of ["DRAFT", "SUBMITTED", "IT_REVIEWED", "COMPLETED", "CANCELLED"] as const) {
      expect(parsePurchaseState(s)).toBe(s);
    }
  });
  it("treats anything else as All", () => {
    expect(parsePurchaseState(null)).toBeNull();
    expect(parsePurchaseState(undefined)).toBeNull();
    expect(parsePurchaseState("")).toBeNull();
    expect(parsePurchaseState("draft")).toBeNull();
    expect(parsePurchaseState("DELETED")).toBeNull();
  });
});

describe("PURCHASE_TABS", () => {
  it("leads with All and covers every state, hrefs writing ?state=", () => {
    expect(PURCHASE_TABS[0]).toEqual({ id: "ALL", label: "All", href: "/purchases" });
    expect(PURCHASE_TABS.map((t) => t.id)).toEqual([
      "ALL", "DRAFT", "SUBMITTED", "IT_REVIEWED", "COMPLETED", "CANCELLED",
    ]);
    expect(PURCHASE_TABS.find((t) => t.id === "IT_REVIEWED")!.href).toBe("/purchases?state=IT_REVIEWED");
  });

  // Every href is pinned: the sidebar's "By status" links target these exact
  // URLs and navIsActive compares them verbatim, so a typo in any one of them
  // silently stops highlighting that nav item.
  it("pins every tab's href and label", () => {
    expect(PURCHASE_TABS).toEqual([
      { id: "ALL", label: "All", href: "/purchases" },
      { id: "DRAFT", label: "Drafts", href: "/purchases?state=DRAFT" },
      { id: "SUBMITTED", label: "Awaiting IT", href: "/purchases?state=SUBMITTED" },
      { id: "IT_REVIEWED", label: "Awaiting finance", href: "/purchases?state=IT_REVIEWED" },
      { id: "COMPLETED", label: "Completed", href: "/purchases?state=COMPLETED" },
      { id: "CANCELLED", label: "Cancelled", href: "/purchases?state=CANCELLED" },
    ]);
  });

  it("labels the middle states by who is waiting, matching the sidebar", () => {
    const label = (id: string) => PURCHASE_TABS.find((t) => t.id === id)!.label;
    expect(label("SUBMITTED")).toBe("Awaiting IT");
    expect(label("IT_REVIEWED")).toBe("Awaiting finance");
  });
});

describe("purchaseWhere", () => {
  it("is empty for All with no search", () => {
    expect(purchaseWhere(null, "")).toEqual({});
  });
  it("filters by state", () => {
    expect(purchaseWhere("DRAFT", "")).toEqual({ state: "DRAFT" });
  });
  it("searches refNo and unit descriptions (contains — the sanctioned use)", () => {
    expect(purchaseWhere(null, "monitor")).toEqual({
      OR: [
        { refNo: { contains: "monitor", mode: "insensitive" } },
        { units: { some: { description: { contains: "monitor", mode: "insensitive" } } } },
      ],
    });
  });
  it("combines state and search", () => {
    const where = purchaseWhere("SUBMITTED", "PR-0198");
    expect(where.state).toBe("SUBMITTED");
    expect(where.OR).toHaveLength(2);
  });
  it("pages at 50", () => {
    expect(PURCHASE_PAGE_SIZE).toBe(50);
  });
});

describe("dwellLine — how long it's been there, not derivable from the enum", () => {
  const row = (over: Partial<Parameters<typeof dwellLine>[0]> = {}) => ({
    state: "SUBMITTED" as const, updatedAt: daysAgo(2), submittedAt: daysAgo(2),
    reviewedAt: null, completedAt: null, cancelledAt: null, bounced: false, ...over,
  });

  it("names the bounce-back before anything else", () => {
    expect(dwellLine(row({ state: "SUBMITTED", bounced: true, updatedAt: daysAgo(1) }), NOW))
      .toBe("back from finance · 1 d");
    expect(dwellLine(row({ state: "DRAFT", bounced: true, updatedAt: daysAgo(3) }), NOW))
      .toBe("sent back by IT · 3 d");
  });
  it("says who is waiting, and for how long", () => {
    expect(dwellLine(row({ submittedAt: daysAgo(2) }), NOW)).toBe("awaiting IT · 2 d");
    expect(dwellLine(row({ state: "IT_REVIEWED", reviewedAt: daysAgo(5) }), NOW)).toBe("awaiting finance · 5 d");
  });
  it("reads today for anything under a day", () => {
    expect(dwellLine(row({ submittedAt: new Date(NOW.getTime() - 3_600_000) }), NOW)).toBe("awaiting IT · today");
  });
  it("closes out terminal rows", () => {
    expect(dwellLine(row({ state: "COMPLETED", completedAt: daysAgo(30) }), NOW)).toBe("completed 30 d ago");
    expect(dwellLine(row({ state: "CANCELLED", cancelledAt: daysAgo(48) }), NOW)).toBe("cancelled 48 d ago");
  });
  it("describes an untouched draft by its last edit", () => {
    expect(dwellLine(row({ state: "DRAFT", submittedAt: null, updatedAt: daysAgo(4) }), NOW))
      .toBe("draft · edited 4 d ago");
  });
  it("falls back to updatedAt when a stamp is missing rather than printing NaN", () => {
    expect(dwellLine(row({ state: "IT_REVIEWED", reviewedAt: null, updatedAt: daysAgo(6) }), NOW))
      .toBe("awaiting finance · 6 d");
  });
  it("never says 'today ago'", () => {
    expect(dwellLine(row({ state: "DRAFT", submittedAt: null, updatedAt: NOW }), NOW)).toBe("draft · edited today");
    expect(dwellLine(row({ state: "COMPLETED", completedAt: NOW }), NOW)).toBe("completed today");
  });
});
