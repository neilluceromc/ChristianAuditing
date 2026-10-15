import { describe, expect, it } from "vitest";
import { groupLabelQueue, whenLabel } from "./label-queue";

const at = (iso: string) => new Date(iso);

describe("groupLabelQueue", () => {
  it("groups by purchase record, newest first, tags in order, title and range", () => {
    const groups = groupLabelQueue([
      { id: "a1", tag: "BR-LT-0202", model: "ThinkPad T14", purchaseRecordId: "r1", createdAt: at("2026-10-14T02:00:00Z") },
      { id: "a2", tag: "BR-LT-0201", model: "ThinkPad T14", purchaseRecordId: "r1", createdAt: at("2026-10-14T02:00:00Z") },
      { id: "b1", tag: "BR-MN-0039", model: "Dell P2422H", purchaseRecordId: "r0", createdAt: at("2026-10-13T02:00:00Z") },
    ]);
    expect(groups.map((g) => [g.recordId, g.title, g.range, g.tags])).toEqual([
      ["r1", "2 × ThinkPad T14", "BR-LT-0201 → BR-LT-0202", ["BR-LT-0201", "BR-LT-0202"]],
      ["r0", "1 × Dell P2422H", "BR-MN-0039", ["BR-MN-0039"]],
    ]);
  });
  it("assets without a record group by model and minute", () => {
    const g = groupLabelQueue([
      { id: "x", tag: "BR-HS-0001", model: "Jabra", purchaseRecordId: null, createdAt: at("2026-10-14T02:00:10Z") },
      { id: "y", tag: "BR-HS-0002", model: "Jabra", purchaseRecordId: null, createdAt: at("2026-10-14T02:00:50Z") },
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].recordId).toBeNull();
  });
});

describe("whenLabel", () => {
  const now = at("2026-10-14T10:00:00+08:00");
  it("Just now / Today / Yesterday / date", () => {
    expect(whenLabel(at("2026-10-14T09:55:00+08:00"), now)).toBe("Just now");
    expect(whenLabel(at("2026-10-14T08:00:00+08:00"), now)).toBe("Today");
    expect(whenLabel(at("2026-10-13T08:00:00+08:00"), now)).toBe("Yesterday");
    expect(whenLabel(at("2026-10-01T08:00:00+08:00"), now)).toMatch(/1 Oct 2026|Oct/);
  });
});
