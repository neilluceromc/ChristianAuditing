/**
 * Phase 17 (spec §5.2). The two merged timelines read two or three tables
 * newest-first; no single SQL page exists across them, so paging is a cursor:
 * `before` is the instant of the last item shown and `skip` how many items AT
 * that instant were already shown. A direct action writes its approval row and
 * audit entry with one `now`, so ties across the boundary are the normal case.
 */
export const TIMELINE_PAGE_SIZE = 50;
export interface TimelinePoint { id: string; when: Date }
export interface TimelineCursor { before: Date; skip: number }

const byWhenDesc = <T extends TimelinePoint>(a: T, b: T) => b.when.getTime() - a.when.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/**
 * `sources` are each already `where when <= cursor.before` (when a cursor is
 * given), ordered when desc, id desc, and cut to `limit + 1` rows.
 */
export function mergeTimeline<T extends TimelinePoint>(sources: T[][], limit: number, cursor: TimelineCursor | null): { items: T[]; next: TimelineCursor | null } {
  const union = sources.flat().sort(byWhenDesc);
  let start = 0;
  if (cursor) {
    let seen = 0;
    while (start < union.length && seen < cursor.skip && union[start].when.getTime() === cursor.before.getTime()) { start++; seen++; }
  }
  const items = union.slice(start, start + limit);
  const anySourceOverflowed = sources.some((s) => s.length > limit);
  const more = anySourceOverflowed || union.length - start > limit;
  if (!more || items.length === 0) return { items, next: null };
  const last = items[items.length - 1];
  const skip = items.filter((i) => i.when.getTime() === last.when.getTime()).length;
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
