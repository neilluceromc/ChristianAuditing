import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { canManageStock } from "./stock-access";

describe("canManageStock (spec §3 — stock write surfaces are Purchasing's and the sysadmin role's)", () => {
  const cases: Array<[Role, boolean]> = [
    ["admin", true],
    ["purchasing_staff", true],
    ["it_staff", false],
    ["finance_staff", false],
    ["viewer", false],
  ];
  it.each(cases)("%s -> %s", (role, expected) => {
    expect(canManageStock(role)).toBe(expected);
  });
});
