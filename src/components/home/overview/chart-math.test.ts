import { describe, expect, it } from "vitest";
import { declutter, deltaWords, fmtTick, fmtValue, labelIndexes, niceTicks, sparkGeometry, sparkPoints } from "./chart-math";

describe("deltaWords", () => {
  it("none has no words of its own", () => expect(deltaWords({ kind: "none" })).toBeNull());
  it("normalises −0 to no change", () => expect(deltaWords({ kind: "pct", value: -0 })).toEqual({ dir: "flat", text: "no change" }));
  it("formats a large count with separators", () =>
    expect(deltaWords({ kind: "count", value: -1250 })).toEqual({ dir: "down", text: "1,250 vs last week" }));
});

describe("fmtValue / fmtTick", () => {
  it("counts and whole pesos", () => {
    expect(fmtValue(1204)).toBe("1,204");
    expect(fmtValue(1204.4, true)).toBe("₱1,204");
  });
  it("compact ticks", () => {
    expect(fmtTick(1_200_000, true)).toBe("₱1.2M");
    expect(fmtTick(20)).toBe("20");
  });
});

describe("sparkGeometry", () => {
  it("needs 2 collected points", () => {
    expect(sparkPoints([null, 3, null])).toBe(1);
    expect(sparkGeometry([null, 3, null])).toBeNull();
    expect(sparkGeometry([])).toBeNull();
  });
  it("breaks at nulls and ends on the last collected point", () => {
    const g = sparkGeometry([1, 2, null, 4])!;
    expect(g.lines).toHaveLength(2);
    expect(g.areas).toHaveLength(2);
    expect(g.end.x).toBeCloseTo(81);
    expect(g.end.y).toBeCloseTo(3); // the max sits at the top padding
  });
  it("a flat run sits mid-height", () => {
    expect(sparkGeometry([5, 5, 5])!.end.y).toBe(14);
  });
});

describe("niceTicks", () => {
  it("about four round steps from 0", () => {
    expect(niceTicks(9, true)).toEqual([0, 5, 10]);
    expect(niceTicks(37, true)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(1_234_567, false)).toEqual([0, 500_000, 1_000_000, 1_500_000]);
  });
  it("whole counts never step below 1; an all-zero chart still has an axis", () => {
    expect(niceTicks(2, true)).toEqual([0, 1, 2]);
    expect(niceTicks(0, true)).toEqual([0, 1]);
  });
});

describe("declutter", () => {
  it("keeps labels apart in their input order", () => {
    expect(declutter([100, 105, 50], 14, 0, 200)).toEqual([100, 114, 50]);
  });
  it("pushes the stack back up from the bottom edge", () => {
    expect(declutter([200, 200, 200], 14, 0, 200)).toEqual([172, 186, 200]);
  });
});

describe("labelIndexes", () => {
  it("about six labels, always the last, none crowding it", () => {
    expect(labelIndexes(12)).toEqual([0, 2, 4, 6, 8, 11]);
    expect(labelIndexes(14)).toEqual([0, 3, 6, 9, 13]);
    expect(labelIndexes(4)).toEqual([0, 1, 2, 3]);
    expect(labelIndexes(1)).toEqual([0]);
  });
});
