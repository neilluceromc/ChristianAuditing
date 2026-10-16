import { LOG_PAGE_SIZE, pageOf, type Page } from "@/lib/paging";
import { parseListState, type ListConfig } from "@/lib/url-state";

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

export interface PostedReviewRow {
  itemId: string;
  bookQty: number;
  countedQty: number | null;
  adjustment: number | null;
}

/**
 * Spec §7.5, I-4: a POSTED (or CANCELLED) stocktake's review is a frozen
 * RECORD of what was posted, not today's live ledger — unlike `varianceRows`,
 * this never looks at a current balance. `adjustments` is keyed by item id
 * to the signed quantity of the ADJUSTMENT movement this stocktake itself
 * wrote (`stocktakeReviewSheet` reads it from `stocktake.movements`); a line with no
 * entry either was never counted or was counted exactly on balance
 * (`planStocktakePost` writes no movement for a zero delta) — both render as
 * `adjustment: null`, and the caller tells them apart via `countedQty`.
 */
export function postedReviewRows(lines: StocktakeLineInput[], adjustments: Map<string, number>): PostedReviewRow[] {
  return lines.map((l) => ({
    itemId: l.itemId,
    bookQty: l.bookQty,
    countedQty: l.countedQty,
    adjustment: adjustments.get(l.itemId) ?? null,
  }));
}

/**
 * Phase 39 (spec §4.1): the count and review sheets page 50 lines at a time, with the state in the URL — `q` (item
 * code or name), `cat` (comma-joined category ids), the mode's toggle (`uncounted=1` on the count, `diff=1` on the
 * review) and `page`. The review also carries `view=review`, which this state leaves to `sheetHref`.
 */
export type SheetMode = "count" | "review";

export interface SheetState {
  q: string;
  cats: string[];
  /** Only uncounted (count) or Only differences (review). */
  only: boolean;
  page: number;
}

const SHEET_CONFIG: ListConfig = { facets: ["cat", "uncounted", "diff"], sortable: [], defaultSort: [] };
const TOGGLE: Record<SheetMode, string> = { count: "uncounted", review: "diff" };

export function parseSheetState(params: URLSearchParams, mode: SheetMode): SheetState {
  const ls = parseListState(params, SHEET_CONFIG);
  return { q: ls.q, cats: ls.filters.cat ?? [], only: ls.filters[TOGGLE[mode]]?.includes("1") ?? false, page: ls.page };
}

/** Stable order: view, q, cat, the toggle, page. Defaults are left out; commas stay readable. */
export function sheetHref(stocktakeId: string, mode: SheetMode, s: SheetState): string {
  const params = new URLSearchParams();
  if (mode === "review") params.set("view", "review");
  if (s.q) params.set("q", s.q);
  if (s.cats.length) params.set("cat", s.cats.join(","));
  if (s.only) params.set(TOGGLE[mode], "1");
  if (s.page > 1) params.set("page", String(s.page));
  const qs = params.toString().replaceAll("%2C", ",");
  return `/stock/stocktakes/${stocktakeId}${qs ? `?${qs}` : ""}`;
}

/** The search (item code or name, case-insensitive) and the category filter; the toggle is the caller's. */
export function sheetLineMatches(line: { code: string; name: string; categoryId: string }, s: Pick<SheetState, "q" | "cats">): boolean {
  if (s.cats.length && !s.cats.includes(line.categoryId)) return false;
  const n = s.q.trim().toLowerCase();
  return !n || line.code.toLowerCase().includes(n) || line.name.toLowerCase().includes(n);
}

/** "Only differences": an OPEN line counted off today's balance, or a line the posted stocktake adjusted. */
export function isDifference(r: { kind: "open"; variance: number | null } | { kind: "posted"; adjustment: number | null }): boolean {
  return r.kind === "open" ? r.variance !== null && r.variance !== 0 : r.adjustment !== null;
}

/** The rows `keep` lets through, paged (`pageOf` clamps an out-of-range page to the last); `matching` = how many it kept. */
export function pageSheet<T>(rows: T[], keep: (r: T) => boolean, requested: number, size: number = LOG_PAGE_SIZE): { rows: T[]; matching: number } & Page {
  const kept = rows.filter(keep);
  const pg = pageOf(kept.length, requested, size);
  return { ...pg, rows: kept.slice(pg.skip, pg.skip + pg.take), matching: kept.length };
}

/** A count box's content: a whole number of zero or more, "blank" (nothing to save), or "invalid" (blocks leaving the page). */
export function parseCount(raw: string | undefined): number | "blank" | "invalid" {
  const t = (raw ?? "").trim();
  if (t === "") return "blank";
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : "invalid";
}
