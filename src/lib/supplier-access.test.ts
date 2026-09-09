import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { canAttachToRequest, canManageSuppliers, canRevealBank, canSetRequestSupplier } from "./supplier-access";

const ROLES: Role[] = ["admin", "it_staff", "purchasing_staff", "finance_staff", "viewer"];
const truthy = (fn: (r: Role) => boolean) => ROLES.filter(fn);

describe("supplier access (spec §3)", () => {
  it("Purchasing and the sysadmin role maintain suppliers", () => {
    expect(truthy(canManageSuppliers)).toEqual(["admin", "purchasing_staff"]);
    expect(truthy(canSetRequestSupplier)).toEqual(["admin", "purchasing_staff"]);
  });
  it("bank numbers reveal to Purchasing, Finance and the sysadmin role only", () => {
    expect(truthy(canRevealBank)).toEqual(["admin", "purchasing_staff", "finance_staff"]);
  });
  it("every working role attaches to a request; the viewer never does", () => {
    expect(truthy(canAttachToRequest)).toEqual(["admin", "it_staff", "purchasing_staff", "finance_staff"]);
  });
});
