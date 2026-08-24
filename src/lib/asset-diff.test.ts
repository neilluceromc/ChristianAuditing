import { describe, expect, it } from "vitest";
import { assetDiff } from "./asset-diff";

/** Prisma.Decimal shape, as diffOf's own normalize() expects it. */
const decimal = (n: number) => ({ toNumber: () => n });

describe("assetDiff", () => {
  it("a clean round trip of a time-of-day row yields no diff and nothing to write (A-3 + A-4)", () => {
    const before = {
      model: "ThinkPad X1",
      cost: decimal(11000),
      purchasedAt: new Date("2024-09-01T07:59:47.133Z"),
      warrantyUntil: null,
    };
    const patch = {
      model: "ThinkPad X1",
      cost: "11000.00",
      purchasedAt: new Date("2024-09-01T00:00:00Z"),
      warrantyUntil: null,
    };
    const { diff, changed } = assetDiff(before, patch);
    expect(diff).toEqual({});
    expect(changed).toEqual({});
  });

  it("a genuine day change is the ONLY key in diff and changed — sibling fields are not dragged along (C-1)", () => {
    const before = {
      model: "ThinkPad X1",
      cost: decimal(11000),
      purchasedAt: new Date("2024-09-01T07:59:47.133Z"),
      warrantyUntil: new Date("2026-09-01T07:59:47.133Z"),
    };
    const patch = {
      model: "ThinkPad X1",
      cost: "11000.00",
      purchasedAt: new Date("2024-09-02T00:00:00Z"), // a real day change
      warrantyUntil: new Date("2026-09-01T00:00:00Z"), // same day as before, time-of-day round trip
    };
    const { diff, changed } = assetDiff(before, patch);
    expect(diff).toEqual({
      purchasedAt: { from: "2024-09-01T00:00:00.000Z", to: "2024-09-02T00:00:00.000Z" },
    });
    // C-1: `changed` must carry ONLY purchasedAt. Writing the whole patch
    // (the pre-fix behaviour) would also write warrantyUntil, truncating its
    // real time-of-day to midnight with no audit entry for it.
    expect(changed).toEqual({ purchasedAt: patch.purchasedAt });
    expect(changed).not.toHaveProperty("warrantyUntil");
    expect(changed).not.toHaveProperty("model");
  });

  it("a present-null cost is a real, recorded change", () => {
    const before = { model: "ThinkPad X1", cost: decimal(11000) };
    const patch = { model: "ThinkPad X1", cost: null };
    const { diff, changed } = assetDiff(before, patch);
    expect(diff).toEqual({ cost: { from: 11000, to: null } });
    expect(changed).toEqual({ cost: null });
  });

  it("a key ABSENT from patch never appears in diff nor in the write set, however different `before` is", () => {
    const before = { model: "ThinkPad X1", serial: "OLD-SERIAL-1" };
    const patch = { model: "ThinkPad X1" }; // no `serial` key at all — the sheet had no such column
    const { diff, changed } = assetDiff(before, patch);
    expect(diff).toEqual({});
    expect(changed).toEqual({});
    expect("serial" in diff).toBe(false);
    expect("serial" in changed).toBe(false);
  });
});
