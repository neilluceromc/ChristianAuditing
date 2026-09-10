import type { StockMovementKind } from "@prisma/client";

// Spec §2.4: quantity is SIGNED in base units. OPENING and RECEIPT add stock,
// ISSUE removes it, ADJUSTMENT carries whatever sign the caller already gave
// it (a correction can go either way).
export function signedQuantity(kind: StockMovementKind, entered: number): number {
  if (kind === "ISSUE") return -Math.abs(entered);
  if (kind === "ADJUSTMENT") return entered;
  return Math.abs(entered);
}

export function canIssue(balance: number, qty: number): { ok: true } | { ok: false; left: number } {
  return qty <= balance ? { ok: true } : { ok: false, left: Math.max(0, balance) };
}

export const MOVEMENT_KIND_LABEL: Record<StockMovementKind, string> = {
  OPENING: "Opening",
  RECEIPT: "Receipt",
  ISSUE: "Issue",
  ADJUSTMENT: "Adjustment",
};
