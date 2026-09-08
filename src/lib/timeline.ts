/**
 * Phase 17 (spec §5.2). The two merged timelines read two or three tables
 * newest-first; no single SQL page exists across them, so paging is a cursor:
 * `before` is the instant of the last item shown and `skip` how many items AT
 * that instant were already shown. A direct action writes its approval row and
 * audit entry with one `now`, so ties across the boundary are the normal case
 * -- and a tie can be longer than a page: `createMany` gives every row in the
 * batch one `createdAt`, so a bulk assign of 200 devices to one person writes
 * 200 approval rows in a single transaction, all stamped identically. `skip`
 * therefore counts every row already shown at `before`, accumulated across as
 * many pages as that instant spans, not just the ones shown on one page --
 * and each source is fetched with `timelineTake(limit, cursor)` rows so a
 * source made entirely of the tied instant still has all of it in view.
 */
export const TIMELINE_PAGE_SIZE = 50;
export interface TimelinePoint { id: string; when: Date }
export interface TimelineCursor { before: Date; skip: number }

const byWhenDesc = <T extends TimelinePoint>(a: T, b: T) => b.when.getTime() - a.when.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** How many rows to `take` from a source query: a page, plus the rows at the boundary instant already shown on earlier pages. */
export function timelineTake(limit: number, cursor: TimelineCursor | null): number {
  return limit + 1 + (cursor?.skip ?? 0);
}

/**
 * `sources` are each already `where when <= cursor.before` (when a cursor is
 * given), ordered when desc, id desc, and cut to `timelineTake(limit, cursor)` rows.
 */
export function mergeTimeline<T extends TimelinePoint>(sources: T[][], limit: number, cursor: TimelineCursor | null): { items: T[]; next: TimelineCursor | null } {
  const union = sources.flat().sort(byWhenDesc);
  let start = 0;
  if (cursor) {
    let seen = 0;
    while (start < union.length && seen < cursor.skip && union[start].when.getTime() === cursor.before.getTime()) { start++; seen++; }
  }
  const items = union.slice(start, start + limit);
  const anySourceOverflowed = sources.some((s) => s.length > limit + (cursor?.skip ?? 0));
  const more = anySourceOverflowed || union.length - start > limit;
  if (!more || items.length === 0) return { items, next: null };
  const last = items[items.length - 1];
  const atLast = items.filter((i) => i.when.getTime() === last.when.getTime()).length;
  const skip = cursor && last.when.getTime() === cursor.before.getTime() ? cursor.skip + atLast : atLast;
  return { items, next: { before: last.when, skip } };
}

export function parseTimelineCursor(params: URLSearchParams): TimelineCursor | null {
  const raw = params.get("before");
  if (!raw) return null;
  const before = new Date(raw);
  if (Number.isNaN(before.getTime())) return null;
  const skip = Math.max(0, Number.parseInt(params.get("skip") ?? "0", 10) || 0);
  return { before, skip };
}

export function timelineCursorQS(c: TimelineCursor): string {
  return `before=${encodeURIComponent(c.before.toISOString())}&skip=${c.skip}`;
}
