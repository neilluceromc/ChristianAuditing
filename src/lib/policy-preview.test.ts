import { describe, expect, it } from "vitest";
import { previewPolicyFor } from "./policy-preview";

const policies = [
  { id: "p-dept", name: "Finance standard", appliesToTitle: null, appliesToDepartmentId: "dept-fin", slots: [{ id: "s1" }, { id: "s2" }] },
  { id: "p-title", name: "Team lead kit", appliesToTitle: "Team Lead", appliesToDepartmentId: null, slots: [{ id: "s3" }] },
];

describe("previewPolicyFor — what the typed title will resolve to (spec §5.3)", () => {
  it("title beats department", () => {
    expect(previewPolicyFor("team lead", "dept-fin", policies)).toEqual({ name: "Team lead kit", slots: 1, via: "title" });
  });
  it("falls back to the department policy", () => {
    expect(previewPolicyFor("Accountant", "dept-fin", policies)).toEqual({ name: "Finance standard", slots: 2, via: "department" });
  });
  it("nothing typed, or nothing matching → null", () => {
    expect(previewPolicyFor("", "dept-fin", policies)).toBeNull();
    expect(previewPolicyFor("Contractor", "dept-ops", policies)).toBeNull();
  });
});
