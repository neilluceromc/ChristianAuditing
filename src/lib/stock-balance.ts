// Spec §2.2/§2.4. Balances are DERIVED (SUM of signed StockMovement.quantity)
// — never a stored column — so every reader recomputes from the ledger.
export function balanceOf(movements: ReadonlyArray<{ quantity: number }>): number {
  return movements.reduce((s, m) => s + m.quantity, 0);
}

export function isLow(balance: number, reorderLevel: number): boolean {
  return reorderLevel > 0 && balance <= reorderLevel;
}

export function packToUnits(packs: number, packSize: number): number {
  return packs * packSize;
}

const NO_PLURAL = new Set(["kg", "g", "l", "ml", "litre", "liter"]);

export function unitsLabel(qty: number, unit: string): string {
  const u = unit.trim();
  if (qty === 1 || NO_PLURAL.has(u.toLowerCase()) || /s$/i.test(u)) return `${qty} ${u}`;
  if (/(x|ch|sh)$/i.test(u)) return `${qty} ${u}es`;
  return `${qty} ${u}s`;
}
