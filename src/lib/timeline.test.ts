import { describe, expect, it } from "vitest";
import { mergeTimeline, parseTimelineCursor, timelineCursorQS, timelineTake, TIMELINE_MAX_SKIP, type TimelineCursor, type TimelinePoint } from "./timeline";

const at = (id: string, iso: string): TimelinePoint => ({ id, when: new Date(iso) });
const byIdDesc = (a: TimelinePoint, b: TimelinePoint) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

describe("mergeTimeline", () => {
  it("interleaves sources newest-first and reports no next when exhausted", () => {
    const a = [at("a2", "2026-09-03T00:00:00Z"), at("a1", "2026-09-01T00:00:00Z")];
    const b = [at("b1", "2026-09-02T00:00:00Z")];
    const r = mergeTimeline([a, b], 50, null);
    expect(r.items.map((i) => i.id)).toEqual(["a2", "b1", "a1"]);
    expect(r.next).toBeNull();
  });
  it("cuts to the limit and hands back a cursor at the last shown instant", () => {
    const rows = Array.from({ length: 5 }, (_, i) => at(`r${i}`, `2026-09-0${5 - i}T00:00:00Z`));
    const r = mergeTimeline([rows.slice(0, 3)], 2, null); // source cut to limit+1
    expect(r.items.map((i) => i.id)).toEqual(["r0", "r1"]);
    expect(r.next).toEqual({ before: new Date("2026-09-04T00:00:00Z"), skip: 1 });
  });
  it("a tie at the boundary is neither skipped nor repeated across two pages", () => {
    const T = "2026-09-07T10:00:00.000Z";
    const audit = [at("x3", "2026-09-08T00:00:00Z"), at("x2", T), at("x1", "2026-09-01T00:00:00Z")];
    const approvals = [at("y2", T), at("y1", "2026-09-02T00:00:00Z")];
    const page1 = mergeTimeline([audit.slice(0, 3), approvals.slice(0, 3)], 2, null);
    expect(page1.items.map((i) => i.id)).toEqual(["x3", "y2"]); // y2 > x2 by id desc within the tie
    expect(page1.next).toEqual({ before: new Date(T), skip: 1 });
    // the page-2 fetch is `when <= before` per source, cut to limit + 1
    const auditP2 = audit.filter((r) => r.when <= page1.next!.before).slice(0, 3);
    const approvalsP2 = approvals.filter((r) => r.when <= page1.next!.before).slice(0, 3);
    const page2 = mergeTimeline([auditP2, approvalsP2], 2, page1.next);
    expect(page2.items.map((i) => i.id)).toEqual(["x2", "y1"]);
    expect(page2.next).toEqual({ before: new Date("2026-09-02T00:00:00Z"), skip: 1 });
    const page3 = mergeTimeline([audit.filter((r) => r.when <= page2.next!.before), approvals.filter((r) => r.when <= page2.next!.before)], 2, page2.next);
    expect(page3.items.map((i) => i.id)).toEqual(["x1"]);
    expect(page3.next).toBeNull();
  });
  it("a single-source tie longer than a page (120 rows, one instant) is exhausted without drops or repeats", () => {
    const T = "2026-09-07T10:00:00.000Z";
    // mirrors a `createMany` bulk write: 120 rows, one `createdAt`, DB-ordered id desc.
    const all = Array.from({ length: 120 }, (_, i) => at(`r${String(i).padStart(3, "0")}`, T)).sort(byIdDesc);
    let cursor: TimelineCursor | null = null;
    const seenIds: string[] = [];
    for (let page = 0; page < 10; page++) {
      const take = timelineTake(50, cursor);
      const source = all.slice(0, take); // every row satisfies `when <= cursor.before` here; `take` is the only cap
      const result: { items: TimelinePoint[]; next: TimelineCursor | null } = mergeTimeline([source], 50, cursor);
      seenIds.push(...result.items.map((i) => i.id));
      cursor = result.next;
      if (!result.next) break;
    }
    expect(cursor).toBeNull();
    expect(seenIds).toHaveLength(120);
    expect(new Set(seenIds).size).toBe(120);
    expect(new Set(seenIds)).toEqual(new Set(all.map((r) => r.id)));
  });
  it("two sources -- a 60-row tie at T plus 3 older rows elsewhere -- page to exhaustion, and take grows with skip", () => {
    const T = "2026-09-07T10:00:00.000Z";
    const a = Array.from({ length: 60 }, (_, i) => at(`a${String(i).padStart(2, "0")}`, T)).sort(byIdDesc);
    const b = [at("b1", "2026-09-05T00:00:00Z"), at("b2", "2026-09-04T00:00:00Z"), at("b3", "2026-09-03T00:00:00Z")];
    let cursor: TimelineCursor | null = null;
    const takes: number[] = [];
    const seenIds: string[] = [];
    for (let page = 0; page < 10; page++) {
      const take = timelineTake(50, cursor);
      takes.push(take);
      const before = cursor ? cursor.before : null;
      const sourceA: TimelinePoint[] = (before ? a.filter((r) => r.when <= before) : a).slice(0, take);
      const sourceB: TimelinePoint[] = (before ? b.filter((r) => r.when <= before) : b).slice(0, take);
      const result: { items: TimelinePoint[]; next: TimelineCursor | null } = mergeTimeline([sourceA, sourceB], 50, cursor);
      seenIds.push(...result.items.map((i) => i.id));
      cursor = result.next;
      if (!result.next) break;
    }
    expect(takes[0]).toBe(51);
    expect(takes[1]).toBe(101);
    expect(cursor).toBeNull();
    expect(seenIds).toHaveLength(63);
    expect(new Set(seenIds).size).toBe(63);
    expect(new Set(seenIds)).toEqual(new Set([...a, ...b].map((r) => r.id)));
  });
});

describe("cursor round-trip", () => {
  it("parses and serialises", () => {
    const c = { before: new Date("2026-09-07T10:00:00.000Z"), skip: 2 };
    expect(parseTimelineCursor(new URLSearchParams(timelineCursorQS(c)))).toEqual(c);
    expect(parseTimelineCursor(new URLSearchParams(""))).toBeNull();
    expect(parseTimelineCursor(new URLSearchParams("before=garbage&skip=1"))).toBeNull();
  });
  it("clamps skip to TIMELINE_MAX_SKIP on the way in, so a hand-edited URL can't inflate the fetch", () => {
    const before = "2026-09-07T10:00:00.000Z";
    expect(parseTimelineCursor(new URLSearchParams(`before=${before}&skip=${1e12}`))?.skip).toBe(TIMELINE_MAX_SKIP);
    expect(parseTimelineCursor(new URLSearchParams(`before=${before}&skip=-5`))?.skip).toBe(0);
    expect(parseTimelineCursor(new URLSearchParams(`before=${before}&skip=7`))?.skip).toBe(7);
  });
});
