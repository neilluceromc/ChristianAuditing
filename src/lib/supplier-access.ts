import type { Role } from "@prisma/client";

/** Spec §3. Kept as data so the tests and the nav can name the same set. */
export const SUPPLIER_MANAGER_ROLES: readonly Role[] = ["admin", "purchasing_staff"];
const BANK_REVEAL_ROLES: readonly Role[] = ["admin", "purchasing_staff", "finance_staff"];

export function canManageSuppliers(role: Role): boolean { return SUPPLIER_MANAGER_ROLES.includes(role); }
export function canRevealBank(role: Role): boolean { return BANK_REVEAL_ROLES.includes(role); }
/** Purchase orders (spec §2): Purchasing, IT and Finance can all upload or re-upload a PO's documents; a viewer cannot. */
const PO_DOCUMENT_ROLES: readonly Role[] = ["admin", "purchasing_staff", "it_staff", "finance_staff"];
export function canAttachToRequest(role: Role): boolean { return PO_DOCUMENT_ROLES.includes(role); }
