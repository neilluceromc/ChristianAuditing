/**
 * Phase 17 (spec §2): the one paging rule. Every list calls pageOf() after its
 * count, so an out-of-range ?page= lands on the last page instead of an empty
 * one, and no list hand-writes Math.ceil(total / size) any more.
 */
export const ENTITY_PAGE_SIZE = 25;
export const LOG_PAGE_SIZE = 50;

export interface Page { page: number; pageCount: number; skip: number; take: number; total: number }

export function pageOf(total: number, requested: number, size: number): Page {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, requested), pageCount);
  return { page, pageCount, skip: (page - 1) * size, take: size, total };
}

/** For pages without a ListState — the same lower clamp parseListState applies. */
export function parsePage(params: URLSearchParams): number {
  return Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
}
