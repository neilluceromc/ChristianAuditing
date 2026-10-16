import { describe, expect, it } from "vitest";
import { editedSlotId, matchCopiedLines, planSlotChanges, policyNameFor } from "./policy-lines";

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

describe("matchCopiedLines", () => {
  const line = (assetTypeId: string, required = true, loaner = false) => ({ assetTypeId, required, loaner });
  it("keeps every slot id when the copied lines match the target's slots", () => {
    const m = matchCopiedLines(ex, [line("mon"), line("mon", false), line("hs")]);
    expect(m.map((l) => l.slotId)).toEqual(["s1", "s2", "s3"]);
    expect(planSlotChanges(ex, m).remove).toEqual([]);
    expect(planSlotChanges(ex, m).create).toEqual([]);
  });
  it("creates a line whose type the target has no unused slot for, and leaves the unmatched slot to be removed", () => {
    const m = matchCopiedLines(ex, [line("mon"), line("kb"), line("hs")]);
    expect(m.map((l) => l.slotId)).toEqual(["s1", undefined, "s3"]);
    const p = planSlotChanges(ex, m);
    expect(p.create).toEqual([line("kb")]);
    expect(p.remove).toEqual(["s2"]);
  });
  it("maps two same-type lines to two distinct slots in order, and a third to a create", () => {
    const m = matchCopiedLines(ex, [line("mon", false, true), line("mon"), line("mon")]);
    expect(m.map((l) => l.slotId)).toEqual(["s1", "s2", undefined]);
    expect(m[0]).toEqual({ slotId: "s1", assetTypeId: "mon", required: false, loaner: true });
  });
  it("ignores a slot id the source line carried", () => {
    const m = matchCopiedLines([], [{ slotId: "src1", ...line("mon") }]);
    expect(m).toEqual([line("mon")]);
  });
});

describe("editedSlotId", () => {
  const loaded = { slotId: "s1", assetTypeId: "mon-27", categoryId: "cat-mon" };
  it("keeps the slot when only the type changes within the same category", () => {
    expect(editedSlotId(loaded, { assetTypeId: "mon-24", categoryId: "cat-mon" })).toBe("s1");
  });
  it("clears the slot when the category changes, and restores it when the category is changed back", () => {
    expect(editedSlotId(loaded, { assetTypeId: "hs", categoryId: "cat-hs" })).toBeUndefined();
    expect(editedSlotId(loaded, { assetTypeId: "mon-27", categoryId: "cat-mon" })).toBe("s1");
  });
  it("keeps the slot for an unchanged type even when its category is unknown", () => {
    expect(editedSlotId({ slotId: "s1", assetTypeId: "x" }, { assetTypeId: "x" })).toBe("s1");
    expect(editedSlotId({ slotId: "s1", assetTypeId: "x" }, { assetTypeId: "y" })).toBeUndefined();
  });
  it("gives a new line no slot", () => {
    expect(editedSlotId({ assetTypeId: "hs", categoryId: "cat-hs" }, { assetTypeId: "hs", categoryId: "cat-hs" })).toBeUndefined();
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
