import type { Role } from "@prisma/client";

/** Spec §3: stock write surfaces are Purchasing's (and the sysadmin role's). */
export const STOCK_MANAGER_ROLES: readonly Role[] = ["admin", "purchasing_staff"];

export function canManageStock(role: Role): boolean {
  return STOCK_MANAGER_ROLES.includes(role);
}
