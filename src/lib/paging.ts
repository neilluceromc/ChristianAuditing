/**
 * Phase 17 (spec §2): the one paging rule. Every list calls pageOf() after its
 * count, so an out-of-range ?page= lands on the last page instead of an empty
 * one, and no list hand-writes Math.ceil(total / size) any more.
 */
export const ENTITY_PAGE_SIZE = 25;
export const LOG_PAGE_SIZE = 50;

/** Phase 45 (spec §4.4): the rows-per-page choices on the Inventory and Employees lists; the first is the default. */
export const PER_PAGE_OPTIONS = [25, 50, 100] as const;

/** The 1-based first and last row shown on `page` ("Rows 1–25 of 900"); 0–0 for an empty list. */
export function rowsRange(page: number, per: number, total: number): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  return { from: (page - 1) * per + 1, to: Math.min(page * per, total) };
}

export interface Page { page: number; pageCount: number; skip: number; take: number; total: number }

export function pageOf(total: number, requested: number, size: number): Page {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, requested), pageCount);
  return { page, pageCount, skip: (page - 1) * size, take: size, total };
}

/** One integer query param: the value, or `fallback` on absence or garbage. Callers clamp. */
export function parseIntParam(params: URLSearchParams, key: string, fallback: number): number {
  return Number.parseInt(params.get(key) ?? "", 10) || fallback;
}

/** For pages without a ListState — the same lower clamp parseListState applies. */
export function parsePage(params: URLSearchParams): number {
  return Math.max(1, parseIntParam(params, "page", 1));
}
