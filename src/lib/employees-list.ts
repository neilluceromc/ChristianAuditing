import type { EmploymentStatus, Prisma } from "@prisma/client";
import type { ListConfig, ListState, SortKey } from "./url-state";

export const EMPLOYMENT_STATUSES = ["ACTIVE", "OFFBOARDING", "OFFBOARDED"] as const satisfies readonly EmploymentStatus[];

export const EMPLOYEES_LIST_CONFIG: ListConfig = {
  facets: ["department", "employment", "leavers"],
  sortable: ["name", "employeeNo", "joinedAt", "loadout"],
  defaultSort: [{ key: "name", dir: "asc" }],
};

export function buildEmployeeWhere(state: ListState): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = {};
  if (state.q) {
    where.OR = [
      { name: { contains: state.q, mode: "insensitive" } },
      { employeeNo: { contains: state.q, mode: "insensitive" } },
      { title: { contains: state.q, mode: "insensitive" } },
      { department: { name: { contains: state.q, mode: "insensitive" } } },
    ];
  }
  if (state.filters.department?.length) where.departmentId = { in: state.filters.department };
  const employment = (state.filters.employment ?? []).filter((v): v is EmploymentStatus =>
    (EMPLOYMENT_STATUSES as readonly string[]).includes(v));
  if (employment.length) {
    where.employment = { in: employment };
  } else if (!(state.filters.leavers ?? []).includes("1")) {
    // Phase 20 (spec §5): leavers hidden by default — an explicit employment
    // facet always wins over this, and the "Show leavers" toggle
    // (`leavers=1`) is the only other way past it. The `employment` facet
    // itself still offers OFFBOARDED (spec §5's own note) — this default
    // only applies when NOTHING was picked from it.
    where.employment = { not: "OFFBOARDED" };
  }
  return where;
}

/** Phase 17 (spec §4): both sort keys, then the id tiebreaker every list orders by. */
export function buildEmployeeOrderBy(sort: SortKey[]): Prisma.EmployeeOrderByWithRelationInput[] {
  const kept = sort.filter((s) => s.key !== "loadout"); // "loadout" is derived, not a column — pageEmployees orders it in memory (plan P-4)
  const order = kept.length ? kept : EMPLOYEES_LIST_CONFIG.defaultSort;
  return [...order.map(({ key, dir }) => ({ [key]: dir })), { id: "asc" }];
}

/**
 * Phase 29 (spec decision 8): completeness ascending = the least complete first (most required gaps),
 * descending the reverse; people with no policy sort last either way; ties by name then id.
 */
export function orderByLoadout<T extends { missingRequired: number | null; name: string; id: string }>(rows: T[], dir: "asc" | "desc"): T[] {
  const sign = dir === "asc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (a.missingRequired === null || b.missingRequired === null) {
      if (a.missingRequired === b.missingRequired) return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
      return a.missingRequired === null ? 1 : -1;
    }
    return sign * (a.missingRequired - b.missingRequired) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}
