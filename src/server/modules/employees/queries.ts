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
  const orderKey = state.sort[0]?.key ?? "name";
  const orderDir = state.sort[0]?.dir ?? "asc";
  const [employees, policies] = await Promise.all([
    prisma.employee.findMany({
      where: buildEmployeeWhere(state),
      include: {
        department: true,
        assets: { select: { id: true, tag: true, model: true, typeId: true, status: true } },
      },
      orderBy: { [orderKey]: orderDir },
    }),
    prisma.equipmentPolicy.findMany({ include: { slots: true } }),
  ]);

  const all = employees.map((e): EmployeeListRow => {
    const policy = resolvePolicy(e, policies);
    const loadout = policy ? computeLoadout(policy.slots, e.assets) : null;
    return {
      id: e.id,
      name: e.name,
      title: e.title,
      employeeNo: e.employeeNo,
      department: e.department.name,
      employment: e.employment,
      m365: e.m365Status,
      items: e.assets.length,
      missingRequired: loadout ? loadout.missingRequired : null,
      joined: fmtDate(e.joinedAt),
    };
  });

  const filtered = gapsOnly ? all.filter((r) => (r.missingRequired ?? 0) > 0) : all;
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return { rows: filtered.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE), total, pageCount };
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
