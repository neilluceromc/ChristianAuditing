import { describe, expect, it } from "vitest";
import {
  allocate, consumptionOrder, DEFAULT_EXPIRY_WINDOW, EXPIRY_WINDOWS, expiryLabel, isExpired, lotRemaining, onHand,
  type LotState,
} from "./stock-allocation";

const TODAY = "2026-09-16";
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Spec §4.1's own fixture: expiry +3d, null, -2d, +10d, in that literal order. */
function fixture(): LotState[] {
  return [
    { id: "plus3", remaining: 10, unitCost: 5, lotDate: d("2026-09-01"), expiresAt: d("2026-09-19") }, // +3d
    { id: "undated", remaining: 10, unitCost: 5, lotDate: d("2026-09-01"), expiresAt: null },
    { id: "minus2", remaining: 10, unitCost: 5, lotDate: d("2026-09-01"), expiresAt: d("2026-09-14") }, // -2d, expired
    { id: "plus10", remaining: 10, unitCost: 5, lotDate: d("2026-09-01"), expiresAt: d("2026-09-26") }, // +10d
  ];
}

describe("isExpired", () => {
  it("is false for a null expiry", () => {
    expect(isExpired(null, TODAY)).toBe(false);
  });
  it("is false for a lot expiring today or later", () => {
    expect(isExpired(d("2026-09-16"), TODAY)).toBe(false);
    expect(isExpired(d("2026-09-17"), TODAY)).toBe(false);
  });
  it("is true for a lot that expired before today", () => {
    expect(isExpired(d("2026-09-15"), TODAY)).toBe(true);
  });
});

describe("consumptionOrder", () => {
  it('"skip": drops the expired lot, ascending expiry with null last', () => {
    const order = consumptionOrder(fixture(), TODAY, "skip").map((l) => l.id);
    expect(order).toEqual(["plus3", "plus10", "undated"]);
  });

  it('"first": expired lots first (ascending), then the rest in the same order as "skip"', () => {
    const order = consumptionOrder(fixture(), TODAY, "first").map((l) => l.id);
    expect(order).toEqual(["minus2", "plus3", "plus10", "undated"]);
  });

  it("breaks a tie on identical expiry and lot date by id, ascending", () => {
    const lots: LotState[] = [
      { id: "z", remaining: 1, unitCost: null, lotDate: d("2026-09-01"), expiresAt: null },
      { id: "a", remaining: 1, unitCost: null, lotDate: d("2026-09-01"), expiresAt: null },
    ];
    expect(consumptionOrder(lots, TODAY, "skip").map((l) => l.id)).toEqual(["a", "z"]);
  });

  it("orders undated lots by lot date ascending when expiry does not distinguish them", () => {
    const lots: LotState[] = [
      { id: "later", remaining: 1, unitCost: null, lotDate: d("2026-09-05"), expiresAt: null },
      { id: "earlier", remaining: 1, unitCost: null, lotDate: d("2026-09-01"), expiresAt: null },
    ];
    expect(consumptionOrder(lots, TODAY, "skip").map((l) => l.id)).toEqual(["earlier", "later"]);
  });
});

describe("allocate", () => {
  it("throws on a non-positive quantity — a programming error, not user input", () => {
    expect(() => allocate(fixture(), 0, TODAY, "skip")).toThrow();
    expect(() => allocate(fixture(), -1, TODAY, "skip")).toThrow();
  });

  it("allocates 70 across remaining [30, 50, 20] as [30, 40], the third lot untouched", () => {
    const lots: LotState[] = [
      { id: "l1", remaining: 30, unitCost: 2, lotDate: d("2026-09-01"), expiresAt: d("2026-09-20") },
      { id: "l2", remaining: 50, unitCost: 2, lotDate: d("2026-09-01"), expiresAt: d("2026-09-21") },
      { id: "l3", remaining: 20, unitCost: 2, lotDate: d("2026-09-01"), expiresAt: d("2026-09-22") },
    ];
    const result = allocate(lots, 70, TODAY, "skip");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.allocations).toEqual([
        { lotId: "l1", quantity: 30, unitCost: 2 },
        { lotId: "l2", quantity: 40, unitCost: 2 },
      ]);
    }
  });

  it("allocates an exact fit, leaving nothing short", () => {
    const lots: LotState[] = [
      { id: "l1", remaining: 12, unitCost: 1, lotDate: d("2026-09-01"), expiresAt: null },
    ];
    const result = allocate(lots, 12, TODAY, "skip");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.allocations).toEqual([{ lotId: "l1", quantity: 12, unitCost: 1 }]);
  });

  it("reports a shortfall with the expired remaining the caller needs for its refusal message", () => {
    const lots: LotState[] = [
      { id: "fresh", remaining: 12, unitCost: 1, lotDate: d("2026-09-01"), expiresAt: null },
      { id: "old", remaining: 20, unitCost: 1, lotDate: d("2026-08-01"), expiresAt: d("2026-09-01") }, // expired
    ];
    const result = allocate(lots, 17, TODAY, "skip");
    expect(result).toEqual({ ok: false, short: 5, expiredRemaining: 20 });
  });

  it("cost is null when every allocated unit came from an uncosted lot", () => {
    const lots: LotState[] = [{ id: "l1", remaining: 10, unitCost: null, lotDate: d("2026-09-01"), expiresAt: null }];
    const result = allocate(lots, 4, TODAY, "skip");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cost).toBeNull();
      expect(result.costedUnits).toBe(0);
      expect(result.uncostedUnits).toBe(4);
    }
  });

  it("cost is the costed part plus an uncosted-units count when the allocation is mixed", () => {
    const lots: LotState[] = [
      { id: "costed", remaining: 5, unitCost: 3, lotDate: d("2026-09-01"), expiresAt: d("2026-09-20") },
      { id: "uncosted", remaining: 10, unitCost: null, lotDate: d("2026-09-01"), expiresAt: d("2026-09-25") },
    ];
    const result = allocate(lots, 8, TODAY, "skip");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cost).toBe(15); // 5 units * 3
      expect(result.costedUnits).toBe(5);
      expect(result.uncostedUnits).toBe(3);
    }
  });

  it("cost is the full sum when every allocated unit is costed", () => {
    const lots: LotState[] = [
      { id: "l1", remaining: 5, unitCost: 4, lotDate: d("2026-09-01"), expiresAt: null },
      { id: "l2", remaining: 5, unitCost: 6, lotDate: d("2026-09-02"), expiresAt: null },
    ];
    const result = allocate(lots, 8, TODAY, "skip");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cost).toBe(5 * 4 + 3 * 6);
      expect(result.uncostedUnits).toBe(0);
    }
  });

  it('"first" policy consumes the expired lot before any unexpired one', () => {
    const lots: LotState[] = [
      { id: "fresh", remaining: 10, unitCost: 1, lotDate: d("2026-09-01"), expiresAt: d("2026-09-20") },
      { id: "expired", remaining: 4, unitCost: 1, lotDate: d("2026-08-01"), expiresAt: d("2026-09-01") },
    ];
    const result = allocate(lots, 6, TODAY, "first");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.allocations).toEqual([
        { lotId: "expired", quantity: 4, unitCost: 1 },
        { lotId: "fresh", quantity: 2, unitCost: 1 },
      ]);
    }
  });

  it("skips a lot with zero or negative remaining", () => {
    const lots: LotState[] = [
      { id: "closed", remaining: 0, unitCost: 1, lotDate: d("2026-09-01"), expiresAt: null },
      { id: "open", remaining: 5, unitCost: 1, lotDate: d("2026-09-02"), expiresAt: null },
    ];
    const result = allocate(lots, 5, TODAY, "skip");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.allocations).toEqual([{ lotId: "open", quantity: 5, unitCost: 1 }]);
  });
});

describe("lotRemaining", () => {
  it("is quantity minus allocated", () => {
    expect(lotRemaining(60, 20)).toBe(40);
  });
  it("can reach zero exactly", () => {
    expect(lotRemaining(60, 60)).toBe(0);
  });
});

describe("onHand", () => {
  it("sums units, costed/uncosted units and value across open lots, ignoring closed ones", () => {
    const lots: LotState[] = [
      { id: "a", remaining: 40, unitCost: 2, lotDate: d("2026-09-01"), expiresAt: null },
      { id: "b", remaining: 10, unitCost: null, lotDate: d("2026-09-02"), expiresAt: null },
      { id: "closed", remaining: 0, unitCost: 5, lotDate: d("2026-09-03"), expiresAt: null },
    ];
    expect(onHand(lots)).toEqual({ units: 50, costedUnits: 40, uncostedUnits: 10, value: 80 });
  });

  it("is all zero for an empty lot list", () => {
    expect(onHand([])).toEqual({ units: 0, costedUnits: 0, uncostedUnits: 0, value: 0 });
  });
});

describe("expiryLabel", () => {
  it("expired N days ago", () => {
    expect(expiryLabel(d("2026-09-14"), TODAY)).toBe("expired 2 days ago");
  });
  it("expires today", () => {
    expect(expiryLabel(d("2026-09-16"), TODAY)).toBe("expires today");
  });
  it("expires in N days", () => {
    expect(expiryLabel(d("2026-09-19"), TODAY)).toBe("expires in 3 days");
  });
});

describe("EXPIRY_WINDOWS / DEFAULT_EXPIRY_WINDOW", () => {
  it("windows are 7, 30, 90 with a default of 30", () => {
    expect(EXPIRY_WINDOWS).toEqual([7, 30, 90]);
    expect(DEFAULT_EXPIRY_WINDOW).toBe(30);
  });
});
