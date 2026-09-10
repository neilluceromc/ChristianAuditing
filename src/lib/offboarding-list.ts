import type { Prisma } from "@prisma/client";
import type { ListConfig, ListState, SortKey } from "./url-state";

/**
 * Phase 20 (spec §4.2): the offboarding queue's own saved-view config.
 * `progress` and the `undecided` sort are both DERIVED — `progress` from a
 * count, not a column, and `undecided` needs the same count — so both are
 * computed over the OFFBOARDING candidate set in memory (plan P-5) rather
 * than in SQL. That set is bounded by how many people are mid-offboarding at
 * once, a handful, never the whole roster the way a stage facet or an
 * inventory sort would be.
 */
export const OFFBOARDING_LIST_CONFIG: ListConfig = {
  facets: ["department", "progress"],
  sortable: ["name", "started", "undecided"],
  defaultSort: [{ key: "name", dir: "asc" }],
};

export type Progress = "open" | "complete";

/** Derived, never stored: any undecided item at all keeps the row "open". */
export function progressOf(undecided: number): Progress {
  return undecided > 0 ? "open" : "complete";
}

/** Always scoped to the queue itself; `progress` narrows in memory (plan P-5), not here. */
export function buildOffboardingWhere(state: ListState): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = { employment: "OFFBOARDING" };
  if (state.filters.department?.length) where.departmentId = { in: state.filters.department };
  return where;
}

/**
 * `null` when the sort key is `undecided` — that ordering is DERIVED (plan
 * P-5) and applied in memory over the candidate set with `sortByUndecided`,
 * never a SQL `ORDER BY`. Every real ordering ends `{ employeeNo: "asc" },
 * { id: "asc" }` — the same "id tiebreaker" discipline every list in this
 * app follows, with `employeeNo` added first because it is the human-legible
 * tiebreak an operator would actually recognise on a list this short.
 */
export function buildOffboardingOrderBy(sort: SortKey[]): Prisma.EmployeeOrderByWithRelationInput[] | null {
  const order = sort.length ? sort : OFFBOARDING_LIST_CONFIG.defaultSort;
  if (order.some((s) => s.key === "undecided")) return null;
  return [
    ...order.map(({ key, dir }): Prisma.EmployeeOrderByWithRelationInput =>
      (key === "started" ? { offboardingAt: dir } : { [key]: dir })),
    { employeeNo: "asc" },
    { id: "asc" },
  ];
}

/**
 * The in-memory counterpart of `buildOffboardingOrderBy`'s `null` case (plan
 * P-5): sorted by the derived undecided count, then name, then employeeNo —
 * stable so two reads of the same candidate set always agree. The tiebreak
 * stays ascending regardless of `dir`, the same convention the id tiebreaker
 * on every SQL order in this app follows.
 */
export function sortByUndecided<T extends { undecided: number; name: string; employeeNo: string }>(
  rows: T[], dir: "asc" | "desc",
): T[] {
  const mult = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) =>
    (a.undecided - b.undecided) * mult || a.name.localeCompare(b.name) || a.employeeNo.localeCompare(b.employeeNo));
}
