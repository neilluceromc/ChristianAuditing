export interface StocktakeLineInput {
  itemId: string;
  bookQty: number;
  countedQty: number | null;
}

export interface StocktakePostPlan {
  adjustments: Array<{ itemId: string; quantity: number }>;
  skipped: string[];
  drifted: string[];
}

/**
 * Spec §2.6-style post plan. The book quantity is a snapshot taken when the
 * stocktake was opened; if other movements land on the item WHILE the count
 * is open, the live balance drifts away from that snapshot. The adjustment
 * posted must reconcile the counted quantity against the CURRENT balance
 * (never the stale book value), or the drifted movements would be double
 * counted. `drifted` flags every line where that happened, for review;
 * `skipped` lists lines nobody counted (countedQty === null) — those post no
 * adjustment at all.
 */
export function planStocktakePost(lines: StocktakeLineInput[], current: Map<string, number>): StocktakePostPlan {
  const adjustments: Array<{ itemId: string; quantity: number }> = [];
  const skipped: string[] = [];
  const drifted: string[] = [];
  for (const l of lines) {
    const now = current.get(l.itemId) ?? 0;
    if (now !== l.bookQty) drifted.push(l.itemId);
    if (l.countedQty === null) {
      skipped.push(l.itemId);
      continue;
    }
    const q = l.countedQty - now;
    if (q !== 0) adjustments.push({ itemId: l.itemId, quantity: q });
  }
  return { adjustments, skipped, drifted };
}

export interface VarianceRow {
  itemId: string;
  bookQty: number;
  currentQty: number;
  countedQty: number | null;
  variance: number | null;
  drift: number;
}

export function varianceRows(lines: StocktakeLineInput[], current: Map<string, number>): VarianceRow[] {
  return lines.map((l) => {
    const now = current.get(l.itemId) ?? 0;
    return {
      itemId: l.itemId,
      bookQty: l.bookQty,
      currentQty: now,
      countedQty: l.countedQty,
      variance: l.countedQty === null ? null : l.countedQty - now,
      drift: now - l.bookQty,
    };
  });
}
