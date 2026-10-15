import { describe, expect, it } from "vitest";
import { planSlotChanges, policyNameFor } from "./policy-lines";

const ex = [
  { id: "s1", assetTypeId: "mon", required: true, loaner: false, name: "Monitor" },
  { id: "s2", assetTypeId: "mon", required: false, loaner: false, name: "Monitor" },
  { id: "s3", assetTypeId: "hs", required: true, loaner: false, name: "Headset" },
];

describe("planSlotChanges", () => {
  it("keeps referenced slots as updates, creates new lines, removes the rest", () => {
    const p = planSlotChanges(ex, [
      { slotId: "s1", assetTypeId: "mon", required: true, loaner: false },
      { assetTypeId: "kb", required: true, loaner: false },
      { slotId: "s3", assetTypeId: "hs", required: false, loaner: true },
    ]);
    expect(p.update.map((u) => u.id)).toEqual(["s1", "s3"]);
    expect(p.update[1]).toMatchObject({ required: false, loaner: true });
    expect(p.create).toEqual([{ assetTypeId: "kb", required: true, loaner: false }]);
    expect(p.remove).toEqual(["s2"]);
  });
  it("treats an unknown or repeated slotId as a create", () => {
    const p = planSlotChanges(ex, [
      { slotId: "s1", assetTypeId: "mon", required: true, loaner: false },
      { slotId: "s1", assetTypeId: "mon", required: true, loaner: false },
      { slotId: "zz", assetTypeId: "hs", required: true, loaner: false },
    ]);
    expect(p.update.map((u) => u.id)).toEqual(["s1"]);
    expect(p.create).toHaveLength(2);
    expect(p.remove.sort()).toEqual(["s2", "s3"]);
  });
  it("removes every slot when no line references one (a dropped line takes its waivers with it)", () => {
    const p = planSlotChanges(ex, [{ assetTypeId: "kb", required: true, loaner: false }]);
    expect(p.update).toEqual([]);
    expect(p.remove.sort()).toEqual(["s1", "s2", "s3"]);
  });
});

describe("policyNameFor", () => {
  it("names a base policy after the group and a rule with the title", () => {
    expect(policyNameFor("Bluepeak Telecom", null, () => false)).toBe("Bluepeak Telecom");
    expect(policyNameFor("Bluepeak Telecom", "Team Lead", () => false)).toBe("Bluepeak Telecom · Team Lead");
  });
  it("adds (2), (3) on a clash", () => {
    const taken = new Set(["finance", "finance (2)"]);
    expect(policyNameFor("Finance", null, (n) => taken.has(n.toLowerCase()))).toBe("Finance (3)");
  });
});
