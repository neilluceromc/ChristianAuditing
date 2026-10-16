import { describe, expect, it } from "vitest";
import { previewPolicyFor } from "./policy-preview";

const typed = (category: string, type: string, required = true, loaner = false) => ({
  name: category.toLowerCase(), required, loaner, assetTypeId: `t-${type}`, assetType: { name: type, category: { name: category } },
});

const policies = [
  {
    id: "p-dept", name: "Finance standard", appliesToTitle: null, appliesToDepartmentId: "dept-fin",
    slots: [typed("Laptop", "Business"), typed("Monitor", "24-inch"), typed("Other", "Dock"), typed("Monitor", "27-inch", false)],
  },
  { id: "p-title", name: "Team lead kit", appliesToTitle: "Team Lead", appliesToDepartmentId: null, slots: [typed("Laptop", "Business")] },
];

describe("previewPolicyFor — what the typed title will resolve to (spec §5.3)", () => {
  it("title beats department", () => {
    expect(previewPolicyFor("team lead", "dept-fin", policies)).toMatchObject({ name: "Team lead kit", slots: 1, via: "title" });
  });
  it("falls back to the department policy", () => {
    expect(previewPolicyFor("Accountant", "dept-fin", policies)).toMatchObject({ name: "Finance standard", slots: 4, via: "department" });
  });
  it("nothing matching → null; no title yet → the group's own base policy (Phase 37 panel)", () => {
    expect(previewPolicyFor("Contractor", "dept-ops", policies)).toBeNull();
    expect(previewPolicyFor("", "dept-ops", policies)).toBeNull();
    expect(previewPolicyFor("", "", policies)).toBeNull();
    expect(previewPolicyFor("  ", "dept-fin", policies)).toMatchObject({ name: "Finance standard", via: "department" });
  });
});

describe("previewPolicyFor — the numbered lines (Phase 37, spec §5.1)", () => {
  it("Finance carries Monitor and Monitor 2, in slot order, with each line's flags and type", () => {
    const preview = previewPolicyFor("Accountant", "dept-fin", policies);
    expect(preview?.lines).toEqual([
      { label: "Laptop", required: true, loaner: false, assetTypeId: "t-Business" },
      { label: "Monitor", required: true, loaner: false, assetTypeId: "t-24-inch" },
      { label: "Dock", required: true, loaner: false, assetTypeId: "t-Dock" },
      { label: "Monitor 2", required: false, loaner: false, assetTypeId: "t-27-inch" },
    ]);
  });
  it("an untyped legacy slot keeps its own name", () => {
    const legacy = [{
      id: "p", name: "Old", appliesToTitle: null, appliesToDepartmentId: "d",
      slots: [{ name: "phone", required: true, loaner: true, assetTypeId: null, assetType: null }],
    }];
    expect(previewPolicyFor("X", "d", legacy)?.lines).toEqual([{ label: "phone", required: true, loaner: true, assetTypeId: null }]);
  });
});
