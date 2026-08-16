import { describe, expect, it } from "vitest";
import { diffOf } from "./audit-diff";

describe("diffOf", () => {
  it("captures only changed fields, from → to", () => {
    expect(diffOf({ model: "A", serial: "S1" }, { model: "B", serial: "S1" }))
      .toEqual({ model: { from: "A", to: "B" } });
  });
  it("normalizes Dates to ISO strings and undefined to null", () => {
    const d = diffOf(
      { warrantyUntil: new Date("2026-01-01T00:00:00Z"), notes: undefined },
      { warrantyUntil: new Date("2027-01-01T00:00:00Z"), notes: "hello" },
    );
    expect(d.warrantyUntil).toEqual({ from: "2026-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" });
    expect(d.notes).toEqual({ from: null, to: "hello" });
  });
  it("treats equal Dates and equal decimals as unchanged", () => {
    const dec = { toNumber: () => 55000 }; // Prisma.Decimal shape
    expect(diffOf({ at: new Date(1000), cost: dec }, { at: new Date(1000), cost: 55000 })).toEqual({});
  });
  it("only inspects keys present in `after` (partial updates)", () => {
    expect(diffOf({ a: 1, b: 2 }, { b: 3 })).toEqual({ b: { from: 2, to: 3 } });
  });

  it("ignores a non-callable toNumber property (not a Decimal)", () => {
    const odd = { toNumber: "8GB" };
    expect(diffOf({ specs: odd }, { specs: { toNumber: "8GB" } })).toEqual({});
  });

  it("compares JSON values structurally, not by reference", () => {
    expect(diffOf({ specs: { ram: 16 } }, { specs: { ram: 16 } })).toEqual({});
    expect(diffOf({ specs: { ram: 16 } }, { specs: { ram: 32 } }))
      .toEqual({ specs: { from: { ram: 16 }, to: { ram: 32 } } });
  });
});
