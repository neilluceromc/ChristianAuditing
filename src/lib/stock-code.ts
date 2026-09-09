// Spec §2.1. Ruling R1 (SDD progress.md): the four digits in a formatted
// code are PADDING, not a cap — parsing accepts four OR MORE digits so the
// series never stops once a category passes 9999 items.
export const PREFIX_SHAPE = /^[A-Z]{2,3}$/;
export const STOCK_CODE_SHAPE = /^[A-Z]{2,3}-\d{4,}$/;

export function formatStockCode(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

export function parseStockCode(code: string): { prefix: string; n: number } | null {
  const m = /^([A-Z]{2,3})-(\d{4,})$/.exec(code);
  return m ? { prefix: m[1], n: Number(m[2]) } : null;
}
