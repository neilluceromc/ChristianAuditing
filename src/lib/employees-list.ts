import type { EmploymentStatus, Prisma } from "@prisma/client";
import type { ListConfig, ListState, SortKey } from "./url-state";

export const EMPLOYMENT_STATUSES = ["ACTIVE", "OFFBOARDING", "OFFBOARDED"] as const satisfies readonly EmploymentStatus[];

export const EMPLOYEES_LIST_CONFIG: ListConfig = {
  facets: ["department", "employment", "leavers"],
  sortable: ["name", "employeeNo", "joinedAt"],
  defaultSort: [{ key: "name", dir: "asc" }],
};

export function buildEmployeeWhere(state: ListState): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = {};
  if (state.q) {
    where.OR = [
      { name: { contains: state.q, mode: "insensitive" } },
      { employeeNo: { contains: state.q, mode: "insensitive" } },
      { title: { contains: state.q, mode: "insensitive" } },
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
  const order = sort.length ? sort : EMPLOYEES_LIST_CONFIG.defaultSort;
  return [...order.map(({ key, dir }) => ({ [key]: dir })), { id: "asc" }];
}
