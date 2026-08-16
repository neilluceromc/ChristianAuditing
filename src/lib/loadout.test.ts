import { describe, expect, it } from "vitest";
import { computeLoadout, resolvePolicy } from "./loadout";

const policies = [
  { id: "p-dept", name: "Finance standard", appliesToTitle: null, appliesToDepartmentId: "dept-fin", slots: [] },
  { id: "p-title", name: "Team lead kit", appliesToTitle: "Team Lead", appliesToDepartmentId: null, slots: [] },
];

describe("resolvePolicy — role (title) policy beats department policy", () => {
  it("matches title first, case-insensitively", () => {
    expect(resolvePolicy({ title: "team lead", departmentId: "dept-fin" }, policies)?.id).toBe("p-title");
  });
  it("falls back to department", () => {
    expect(resolvePolicy({ title: "Accountant", departmentId: "dept-fin" }, policies)?.id).toBe("p-dept");
  });
  it("null when nothing applies", () => {
    expect(resolvePolicy({ title: "Contractor", departmentId: "dept-ops" }, policies)).toBeNull();
  });
});

const slots = [
  { id: "s1", name: "laptop", assetTypeId: "t-laptop", required: true },
  { id: "s2", name: "monitor", assetTypeId: "t-monitor", required: true },
  { id: "s3", name: "second monitor", assetTypeId: "t-monitor", required: false },
  { id: "s4", name: "headset", assetTypeId: "t-headset", required: true },
];

const asset = (id: string, typeId: string | null) => ({ id, tag: id, model: "m", typeId, status: "DEPLOYED" });

describe("computeLoadout", () => {
  it("fills slots by asset type, one asset per slot, leftovers unslotted", () => {
    const held = [asset("a1", "t-laptop"), asset("a2", "t-monitor"), asset("a3", "t-monitor"), asset("a4", "t-monitor")];
    const l = computeLoadout(slots, held);
    expect(l.slots.map((s) => s.asset?.id ?? null)).toEqual(["a1", "a2", "a3", null]);
    expect(l.unslotted.map((a) => a.id)).toEqual(["a4"]);
    expect(l.filled).toBe(3);
    expect(l.totalSlots).toBe(4);
    expect(l.missingRequired).toBe(1); // headset
  });
  it("day one: everything empty, all required missing", () => {
    const l = computeLoadout(slots, []);
    expect(l.filled).toBe(0);
    expect(l.missingRequired).toBe(3);
  });
  it("assets with no type never fill slots", () => {
    const l = computeLoadout(slots, [asset("a1", null)]);
    expect(l.filled).toBe(0);
    expect(l.unslotted).toHaveLength(1);
  });
  it("no policy → empty grid, nothing missing", () => {
    const l = computeLoadout([], [asset("a1", "t-laptop")]);
    expect(l.totalSlots).toBe(0);
    expect(l.missingRequired).toBe(0);
    expect(l.unslotted).toHaveLength(1);
  });
});
