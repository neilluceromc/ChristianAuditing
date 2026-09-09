import { describe, expect, it } from "vitest";
import type { StockMovementKind } from "@prisma/client";
import { canIssue, MOVEMENT_KIND_LABEL, signedQuantity } from "./stock-movement-rules";

describe("signedQuantity (spec §2.4 — quantity is SIGNED in base units)", () => {
  it("OPENING and RECEIPT are positive, ISSUE negative, ADJUSTMENT as given", () => {
    expect(signedQuantity("OPENING", 5)).toBe(5);
    expect(signedQuantity("RECEIPT", 5)).toBe(5);
    expect(signedQuantity("ISSUE", 5)).toBe(-5);
    expect(signedQuantity("ADJUSTMENT", -3)).toBe(-3);
    expect(signedQuantity("ADJUSTMENT", 3)).toBe(3);
  });
});

describe("canIssue", () => {
  it("allows issuing up to the balance and refuses beyond it", () => {
    expect(canIssue(10, 10)).toEqual({ ok: true });
    expect(canIssue(10, 11)).toEqual({ ok: false, left: 10 });
  });
});

describe("MOVEMENT_KIND_LABEL", () => {
  it("labels every movement kind", () => {
    const kinds: StockMovementKind[] = ["OPENING", "RECEIPT", "ISSUE", "ADJUSTMENT"];
    for (const k of kinds) expect(typeof MOVEMENT_KIND_LABEL[k]).toBe("string");
    expect(Object.keys(MOVEMENT_KIND_LABEL)).toHaveLength(4);
  });
});
