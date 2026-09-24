import type { Prisma } from "@prisma/client";
import { isPastDue } from "./deadlines";
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
  facets: ["department", "progress", "due"],
  sortable: ["name", "started", "undecided", "due", "attention"],
  defaultSort: [{ key: "attention", dir: "desc" }],
};

export type Progress = "open" | "complete";

/** Derived, never stored: any undecided item at all keeps the row "open". */
export function progressOf(undecided: number): Progress {
  return undecided > 0 ? "open" : "complete";
}

export type Due = "overdue" | "on-track";
/** Derived: a row with no date is on track (spec §4.6). */
export function dueOf(dueAt: Date | null, todayISO: string): Due {
  return dueAt !== null && isPastDue(dueAt, todayISO) ? "overdue" : "on-track";
}

/** Always scoped to the queue itself; `progress` narrows in memory (plan P-5), not here. */
export function buildOffboardingWhere(state: ListState): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = { employment: "OFFBOARDING" };
  if (state.filters.department?.length) where.departmentId = { in: state.filters.department };
  return where;
}

/**
 * `null` = order in memory: Attention as the PRIMARY key (the default, spec §4.1) or any
 * `undecided` key (plan P-5 of Phase 20). A secondary Attention left behind by a header click is
 * dropped, so the clicked column really orders the rows (the Phase 31 rule).
 */
export function buildOffboardingOrderBy(sort: SortKey[]): Prisma.EmployeeOrderByWithRelationInput[] | null {
  const order = sort.length ? sort : OFFBOARDING_LIST_CONFIG.defaultSort;
  if (order[0]?.key === "attention" || order.some((s) => s.key === "undecided")) return null;
  const kept = order.filter((s) => s.key !== "attention");
  return [
    ...kept.map(({ key, dir }): Prisma.EmployeeOrderByWithRelationInput => {
      if (key === "started") return { offboardingAt: dir };
      if (key === "due") return { offboardingDueAt: { sort: dir, nulls: "last" } };
      return { [key]: dir };
    }),
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

/** Phase 25: the two in-memory facets' active values, parsed once for the list, the facet counts and the export. */
export function derivedFilters(state: ListState): { progressFilter: Progress[]; dueFilter: Due[] } {
  return {
    progressFilter: (state.filters.progress ?? []).filter((p): p is Progress => p === "open" || p === "complete"),
    dueFilter: (state.filters.due ?? []).filter((d): d is Due => d === "overdue" || d === "on-track"),
  };
}

/**
 * Phase 25 (spec §6.4): each derived facet's counts are tallied over the rows
 * that pass the OTHER derived facet's active filter, so `progress` and `due`
 * narrow each other the way SQL facets do. A facet never narrows itself
 * (its own options must stay pickable). `department` is not involved: it is
 * applied in SQL before these rows exist.
 */
export function narrowedFacetCounts<T extends { undecided: number; dueAt: Date | null }>(
  rows: T[], progressFilter: Progress[], dueFilter: Due[], todayISO: string,
): { progress: Record<Progress, number>; due: Record<Due, number> } {
  const progress: Record<Progress, number> = { open: 0, complete: 0 };
  const due: Record<Due, number> = { overdue: 0, "on-track": 0 };
  for (const r of rows) {
    const p = progressOf(r.undecided);
    const d = dueOf(r.dueAt, todayISO);
    if (dueFilter.length === 0 || dueFilter.includes(d)) progress[p] += 1;
    if (progressFilter.length === 0 || progressFilter.includes(p)) due[d] += 1;
  }
  return { progress, due };
}
