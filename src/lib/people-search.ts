import { z } from "zod";
import type { AssetClass, Prisma } from "@prisma/client";

/** Phase 36 (spec §4.1): the holder pickers search the server as you type. */
export const PEOPLE_LIMIT = 10;
export const PEOPLE_DEBOUNCE_MS = 250;
export const RECENT_PEOPLE = 5;
export const PEOPLE_NONE = "No match — check the spelling or the employee no.";

export const peopleQuerySchema = z.object({
  q: z.string().trim().min(1).max(60),
  scope: z.enum(["active", "assignees"]),
  cls: z.enum(["IT", "PURCHASING"]).optional(),
});

/** "active": ACTIVE employees. "assignees": anyone holding an asset of the class (leavers included). */
export function peopleWhere(q: string, scope: "active" | "assignees", cls?: AssetClass): Prisma.EmployeeWhereInput {
  const match: Prisma.EmployeeWhereInput["OR"] = [
    { name: { contains: q, mode: "insensitive" } },
    { employeeNo: { contains: q, mode: "insensitive" } },
  ];
  return scope === "active"
    ? { employment: "ACTIVE", OR: match }
    : { assets: { some: cls ? { cls } : {} }, OR: match };
}

/** Phase 36 (spec sec. 4.3): the inventory Assigned filter's search - the typed text plus the list state that scopes the counts. */
export const assigneeQuerySchema = z.object({
  q: z.string().trim().min(1).max(60),
  cls: z.enum(["IT", "PURCHASING"]),
  listQS: z.string().max(2000),
});
