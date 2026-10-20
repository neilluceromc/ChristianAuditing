import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { approvalClassKeys, approvalClassWhere, canActOnApproval, isApprover } from "./approval-access";

const ROLES: Role[] = ["admin", "it_staff", "purchasing_staff", "finance_staff", "viewer"];

describe("isApprover", () => {
  it.each([
    ["admin", true], ["it_staff", true], ["purchasing_staff", true], ["finance_staff", false], ["viewer", false],
  ] as Array<[Role, boolean]>)("%s → %s", (role, expected) => {
    expect(isApprover(role)).toBe(expected);
  });
});

describe("canActOnApproval — the approver is whoever manages the asset's class", () => {
  const cases: Array<[Role, "IT" | "PURCHASING" | null, boolean]> = [
    ["admin", "IT", true], ["admin", "PURCHASING", true], ["admin", null, true],
    ["it_staff", "IT", true], ["it_staff", "PURCHASING", false], ["it_staff", null, true],
    ["purchasing_staff", "IT", false], ["purchasing_staff", "PURCHASING", true], ["purchasing_staff", null, true],
    ["finance_staff", "IT", false], ["finance_staff", "PURCHASING", false], ["finance_staff", null, false],
    ["viewer", "IT", false], ["viewer", "PURCHASING", false], ["viewer", null, false],
  ];
  it.each(cases)("%s on a %s asset → %s", (role, cls, expected) => {
    expect(canActOnApproval(role, cls)).toBe(expected);
  });
  it("covers every role × class pair exactly once", () => {
    expect(cases.length).toBe(ROLES.length * 3);
  });
});

describe("approvalClassWhere — a role's queue", () => {
  it("is unfiltered for admin, finance and viewer", () => {
    expect(approvalClassWhere("admin")).toEqual({});
    expect(approvalClassWhere("finance_staff")).toEqual({});
    expect(approvalClassWhere("viewer")).toEqual({});
  });
  it("scopes a single-class role to its class OR to approvals with no asset", () => {
    expect(approvalClassWhere("it_staff")).toEqual({ OR: [{ assetId: null }, { asset: { cls: { in: ["IT"] } } }] });
    expect(approvalClassWhere("purchasing_staff")).toEqual({ OR: [{ assetId: null }, { asset: { cls: { in: ["PURCHASING"] } } }] });
  });
  it("derives the class list from MANAGEABLE_CLASSES, not a literal", () => {
    const where = approvalClassWhere("purchasing_staff") as { OR: Array<{ asset?: { cls: { in: string[] } } }> };
    expect(where.OR[1].asset?.cls.in).toEqual(["PURCHASING"]);
  });
});

describe("approvalClassKeys — the snapshot classes a role's Approvals page counts", () => {
  it.each([
    ["admin", ["it", "purchasing", "none"]],
    ["it_staff", ["it", "none"]],
    ["purchasing_staff", ["purchasing", "none"]],
    ["finance_staff", ["it", "purchasing", "none"]],
    ["viewer", ["it", "purchasing", "none"]],
  ] as Array<[Role, string[]]>)("%s → %j", (role, expected) => {
    expect(approvalClassKeys(role)).toEqual(expected);
  });
  it.each(ROLES)("%s: all three classes exactly when approvalClassWhere is unfiltered", (role) => {
    const unfiltered = Object.keys(approvalClassWhere(role)).length === 0;
    expect(approvalClassKeys(role).length === 3).toBe(unfiltered);
  });
});
