import { prisma } from "@/server/db/client";
import { buildEmployeeWhere } from "@/lib/employees-list";
import { computeLoadout, resolvePolicy } from "@/lib/loadout";
import { fmtDate } from "@/lib/format";
import type { ListState } from "@/lib/url-state";

export const PAGE_SIZE = 25;

export interface EmployeeListRow {
  id: string;
  name: string;
  title: string;
  employeeNo: string;
  department: string;
  employment: string;
  m365: string | null;
  items: number;
  /** null = no policy applies */
  missingRequired: number | null;
  joined: string;
}

/**
 * One employee, with its loadout resolved. `missingRequired` is `null` when
 * no policy applies (never "0 missing" — those read differently on screen).
 */
interface ResolvedEmployee {
  employee: Awaited<ReturnType<typeof fetchCandidates>>[number];
  missingRequired: number | null;
}

async function fetchCandidates(state: ListState) {
  const orderKey = state.sort[0]?.key ?? "name";
  const orderDir = state.sort[0]?.dir ?? "asc";
  return prisma.employee.findMany({
    where: buildEmployeeWhere(state),
    include: {
      department: true,
      assets: { select: { id: true, tag: true, model: true, typeId: true, status: true } },
    },
    orderBy: { [orderKey]: orderDir },
  });
}

/**
 * The gaps cut, in ONE place. `buildEmployeeWhere(state)` is a SQL candidate
 * set only — the loadout it's cut against (policy resolution + slot fill)
 * cannot be expressed in SQL, so "policy gaps only" is necessarily an
 * in-memory filter (HANDOVER §8's pattern: a SQL candidate set is not safe to
 * act on, every consumer of it needs the same final cut). `listEmployees` and
 * the employees export both call this instead of each computing their own
 * `missingRequired > 0` — see this file's history for why that must stay one
 * expression, not two that can drift.
 */
async function filteredEmployees(state: ListState, gapsOnly: boolean): Promise<ResolvedEmployee[]> {
  const [employees, policies] = await Promise.all([
    fetchCandidates(state),
    prisma.equipmentPolicy.findMany({ include: { slots: true }, orderBy: [{ name: "asc" }] }),
  ]);

  const all = employees.map((employee): ResolvedEmployee => {
    const policy = resolvePolicy(employee, policies);
    const loadout = policy ? computeLoadout(policy.slots, employee.assets) : null;
    return { employee, missingRequired: loadout ? loadout.missingRequired : null };
  });

  return gapsOnly ? all.filter((r) => (r.missingRequired ?? 0) > 0) : all;
}

/**
 * The two columns a normal HR list wouldn't have — Items and Loadout — are
 * why IT opens this page. Loadout needs policy resolution per employee, so
 * we fetch the (team-scale) matching set, compute in memory, and paginate
 * after the optional policy-gaps filter.
 */
export async function listEmployees(state: ListState, gapsOnly: boolean): Promise<{
  rows: EmployeeListRow[];
  total: number;
  pageCount: number;
}> {
  const filtered = await filteredEmployees(state, gapsOnly);
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = filtered.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
  return {
    rows: page.map(({ employee: e, missingRequired }): EmployeeListRow => ({
      id: e.id,
      name: e.name,
      title: e.title,
      employeeNo: e.employeeNo,
      department: e.department.name,
      employment: e.employment,
      m365: e.m365Status,
      items: e.assets.length,
      missingRequired,
      joined: fmtDate(e.joinedAt),
    })),
    total,
    pageCount,
  };
}

export interface EmployeeExportRow {
  employeeNo: string; name: string; department: string; title: string;
  employment: string; m365Status: string | null; joinedAt: Date; itemsHeld: number;
}

/**
 * The export's row source. Same `filteredEmployees` cut `listEmployees`
 * uses — so "Policy gaps only" on screen and the export agree on which rows
 * that means — but UNPAGINATED (the export writes every matching row, not
 * one page of them) and with a real `Date` for `joinedAt` rather than the
 * list's display-formatted string, because the xlsx column needs a Date
 * cell to format as one.
 */
export async function employeeExportRows(state: ListState, gapsOnly: boolean): Promise<EmployeeExportRow[]> {
  const filtered = await filteredEmployees(state, gapsOnly);
  return filtered.map(({ employee: e }) => ({
    employeeNo: e.employeeNo,
    name: e.name,
    department: e.department.name,
    title: e.title,
    employment: e.employment,
    m365Status: e.m365Status,
    joinedAt: e.joinedAt,
    itemsHeld: e.assets.length,
  }));
}

export interface EmployeeFacets {
  department: Array<{ value: string; label: string; count: number }>;
  employment: Array<{ value: string; label: string; count: number }>;
}

export async function employeeFacetOptions(state: ListState): Promise<EmployeeFacets> {
  const without = (facet: string): ListState => ({ ...state, filters: { ...state.filters, [facet]: [] } });
  const [deptGroups, empGroups, departments] = await Promise.all([
    prisma.employee.groupBy({ by: ["departmentId"], where: buildEmployeeWhere(without("department")), _count: true }),
    prisma.employee.groupBy({ by: ["employment"], where: buildEmployeeWhere(without("employment")), _count: true }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ]);
  return {
    department: departments.map((d) => ({
      value: d.id, label: d.name, count: deptGroups.find((g) => g.departmentId === d.id)?._count ?? 0,
    })),
    employment: (["ACTIVE", "OFFBOARDING", "OFFBOARDED"] as const).map((s) => ({
      value: s, label: s, count: empGroups.find((g) => g.employment === s)?._count ?? 0,
    })),
  };
}
