import type { EmploymentStatus, GroupKind, Prisma } from "@prisma/client";
import type { ListConfig, ListState, SortKey } from "./url-state";
import { withSort } from "./url-state";
import { monthStartManila } from "./cris-limits";

export const EMPLOYMENT_STATUSES = ["ACTIVE", "OFFBOARDING", "OFFBOARDED"] as const satisfies readonly EmploymentStatus[];

const GROUP_KINDS = ["INTERNAL", "CLIENT"] as const satisfies readonly GroupKind[];

export const EMPLOYEES_LIST_CONFIG: ListConfig = {
  // Phase 45 (spec §3.1): `joined=month` is the "New this month" tab - a closed set, so any other value parses as absent
  facets: ["department", "kind", "employment", "leavers", "joined"],
  facetValues: { joined: ["month"] },
  sortable: ["name", "employeeNo", "joinedAt", "loadout"],
  defaultSort: [{ key: "name", dir: "asc" }],
};

/**
 * Spec §7.3: the toolbar's Sort select. Each value is the list's own URL `sort` value (`-` = descending), over the
 * sort keys EMPLOYEES_LIST_CONFIG already accepts; Name A–Z is the default and adds no param.
 */
export const EMPLOYEE_SORT_OPTIONS = [
  { value: "name", label: "Name A–Z" },
  { value: "-name", label: "Name Z–A" },
  { value: "-joinedAt", label: "Recently joined" },
  { value: "joinedAt", label: "Earliest joined" },
  { value: "employeeNo", label: "Employee no." },
] as const;

const sortValueOf = (s: SortKey) => (s.dir === "desc" ? `-${s.key}` : s.key);

/** The option the URL's sort is exactly, or "" (a column-header sort, or two keys: the select claims nothing). */
export function employeeSortValue(sort: SortKey[]): string {
  if (sort.length !== 1) return "";
  const v = sortValueOf(sort[0]);
  return EMPLOYEE_SORT_OPTIONS.some((o) => o.value === v) ? v : "";
}

/** The state a Sort pick leads to: that sort (an unknown value is the default), page 1; search, filters and tab stay. */
export function withEmployeeSort(state: ListState, value: string): ListState {
  const opt = EMPLOYEE_SORT_OPTIONS.find((o) => o.value === value);
  if (!opt) return withSort(state, EMPLOYEES_LIST_CONFIG.defaultSort);
  const desc = opt.value.startsWith("-");
  return withSort(state, [{ key: desc ? opt.value.slice(1) : opt.value, dir: desc ? "desc" : "asc" }]);
}

/** The join date shows under the name when Joined is the primary sort (Recently / Earliest joined, or the Joined header). */
export function showsJoinedLine(sort: SortKey[]): boolean {
  return sort[0]?.key === "joinedAt";
}

export function buildEmployeeWhere(state: ListState, now: Date = new Date()): Prisma.EmployeeWhereInput {
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
  // Phase 37 (spec §2.3): the Staff facet — Internal | Client staff — filters on the group's kind.
  const kind = (state.filters.kind ?? []).filter((v): v is GroupKind => (GROUP_KINDS as readonly string[]).includes(v));
  if (kind.length) where.department = { kind: { in: kind } };
  // Phase 45 (spec §3.1): joined on or after the 1st of this month, Manila time.
  if ((state.filters.joined ?? []).includes("month")) where.joinedAt = { gte: monthStartManila(now) };
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
