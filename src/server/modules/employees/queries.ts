import { prisma } from "@/server/db/client";
import { buildEmployeeOrderBy, buildEmployeeWhere } from "@/lib/employees-list";
import { computeLoadout, effectiveSlots, groupExceptionsByEmployee, resolvePolicy } from "@/lib/loadout";
import { fmtDate } from "@/lib/format";
import { ENTITY_PAGE_SIZE, pageOf } from "@/lib/paging";
import { EXPORT_CAP } from "@/lib/export-columns";
import type { ListState } from "@/lib/url-state";
import type { ComboOption } from "@/components/patterns/entity-combobox";

export interface EmployeeListRow {
  id: string;
  name: string;
  title: string;
  employeeNo: string;
  department: string;
  employment: string;
  m365: string | null;
  items: number;
  /** null only when neither a resolved policy nor an ADD exception applies */
  missingRequired: number | null;
  joined: string;
}

const rowInclude = {
  department: true,
  assets: { select: { id: true, tag: true, model: true, typeId: true, status: true } },
} as const;

/** Loadout resolution for exactly these employees — one exceptions read, bounded by the page. */
async function resolveMissing(employees: Array<{
  id: string; title: string; departmentId: string;
  assets: Array<{ typeId: string | null; status: string; id: string; tag: string; model: string }>;
}>) {
  const [policies, exceptions] = await Promise.all([
    prisma.equipmentPolicy.findMany({ include: { slots: true }, orderBy: [{ name: "asc" }] }),
    employees.length
      ? prisma.employeeSlotException.findMany({ where: { employeeId: { in: employees.map((e) => e.id) } }, orderBy: [{ employeeId: "asc" }, { id: "asc" }] })
      : Promise.resolve([]),
  ]);
  const byEmployee = groupExceptionsByEmployee(exceptions);
  return new Map(employees.map((e) => {
    const policy = resolvePolicy(e, policies);
    const ex = byEmployee.get(e.id) ?? [];
    if (!policy && !ex.some((x) => x.kind === "ADD")) return [e.id, null] as const;
    return [e.id, computeLoadout(effectiveSlots(policy?.slots ?? [], ex), e.assets).missingRequired] as const;
  }));
}

/** Spec §4: the plain list pages in SQL; the gaps filter cuts a NARROW candidate pass, then fetches the page's rows. */
async function pageEmployees(state: ListState, gapsOnly: boolean) {
  const where = buildEmployeeWhere(state);
  const orderBy = buildEmployeeOrderBy(state.sort);
  if (!gapsOnly) {
    const total = await prisma.employee.count({ where });
    const pg = pageOf(total, state.page, ENTITY_PAGE_SIZE);
    const employees = await prisma.employee.findMany({ where, orderBy, skip: pg.skip, take: pg.take, include: rowInclude });
    const missing = await resolveMissing(employees);
    return { pg, employees, missing };
  }
  const candidates = await prisma.employee.findMany({
    where, orderBy,
    select: { id: true, title: true, departmentId: true, assets: { select: { id: true, tag: true, model: true, typeId: true, status: true } } },
  });
  const missingAll = await resolveMissing(candidates);
  const kept = candidates.filter((c) => (missingAll.get(c.id) ?? 0) > 0);
  const pg = pageOf(kept.length, state.page, ENTITY_PAGE_SIZE);
  const pageIds = kept.slice(pg.skip, pg.skip + pg.take).map((c) => c.id);
  const rows = await prisma.employee.findMany({ where: { id: { in: pageIds } }, include: rowInclude });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { pg, employees: pageIds.map((id) => byId.get(id)!), missing: missingAll };
}

/**
 * The two columns a normal HR list wouldn't have — Items and Loadout — are
 * why IT opens this page. Loadout needs policy resolution per employee, so
 * the plain path pages in SQL and resolves loadouts for exactly the page's
 * rows (`resolveMissing`); "Policy gaps only" can't be expressed in SQL (it
 * needs policy resolution + slot fill per employee), so that path cuts a
 * narrow candidate pass first and pages the kept ids.
 */
export async function listEmployees(state: ListState, gapsOnly: boolean): Promise<{
  rows: EmployeeListRow[];
  total: number;
  page: number;
  pageCount: number;
}> {
  const { pg, employees, missing } = await pageEmployees(state, gapsOnly);
  return {
    rows: employees.map((e): EmployeeListRow => ({
      id: e.id,
      name: e.name,
      title: e.title,
      employeeNo: e.employeeNo,
      department: e.department.name,
      employment: e.employment,
      m365: e.m365Status,
      items: e.assets.length,
      missingRequired: missing.get(e.id) ?? null,
      joined: fmtDate(e.joinedAt),
    })),
    total: pg.total,
    page: pg.page,
    pageCount: pg.pageCount,
  };
}

export interface EmployeeExportRow {
  employeeNo: string; name: string; department: string; title: string;
  employment: string; m365Status: string | null; joinedAt: Date; itemsHeld: number;
}

function toExportRow(e: {
  employeeNo: string; name: string; department: { name: string }; title: string;
  employment: string; m365Status: string | null; joinedAt: Date; assets: unknown[];
}): EmployeeExportRow {
  return {
    employeeNo: e.employeeNo,
    name: e.name,
    department: e.department.name,
    title: e.title,
    employment: e.employment,
    m365Status: e.m365Status,
    joinedAt: e.joinedAt,
    itemsHeld: e.assets.length,
  };
}

/**
 * The export's row source. Same cut `listEmployees` applies for "Policy gaps
 * only" — a narrow candidate pass, `resolveMissing`, keep `missingRequired >
 * 0` — so the sheet and the screen agree on which rows that means. Refuses
 * BEFORE loading rows, same as the assets export: a plain-path refusal reads
 * the count directly off `where`; a gaps-path refusal reads it off the kept
 * id set, since that filter only resolves after the candidate pass.
 */
export async function employeeExportRows(state: ListState, gapsOnly: boolean): Promise<{ rows: EmployeeExportRow[] } | { over: number }> {
  const where = buildEmployeeWhere(state);
  const orderBy = buildEmployeeOrderBy(state.sort);
  if (!gapsOnly) {
    const total = await prisma.employee.count({ where });
    if (total > EXPORT_CAP) return { over: total };
    const employees = await prisma.employee.findMany({ where, orderBy, include: rowInclude });
    return { rows: employees.map(toExportRow) };
  }
  const candidates = await prisma.employee.findMany({
    where, orderBy,
    select: { id: true, title: true, departmentId: true, assets: { select: { id: true, tag: true, model: true, typeId: true, status: true } } },
  });
  const missingAll = await resolveMissing(candidates);
  const keptIds = candidates.filter((c) => (missingAll.get(c.id) ?? 0) > 0).map((c) => c.id);
  if (keptIds.length > EXPORT_CAP) return { over: keptIds.length };
  const rows = await prisma.employee.findMany({ where: { id: { in: keptIds } }, include: rowInclude });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { rows: keptIds.map((id) => toExportRow(byId.get(id)!)) };
}

export interface EmployeeFacets {
  department: Array<{ value: string; label: string; count: number }>;
  employment: Array<{ value: string; label: string; count: number }>;
}

export async function employeeFacetOptions(state: ListState): Promise<EmployeeFacets> {
  // NOTE on the gaps toggle, and the same note inventory/queries.ts carries
  // about repair mode: this function never receives `gapsOnly`, so when the
  // toggle is on these groupBy queries count the CANDIDATE set (everyone
  // matching the SQL where) while the table and the export show the cut set
  // (the narrow candidate pass + resolveMissing cut). A SQL groupBy cannot
  // apply that cut — it needs resolvePolicy/computeLoadout per employee — so
  // the counts may read high with gaps active (3 of 10 in the seed). They
  // are read-only display counts, not something acted on: `listEmployees`
  // and `employeeExportRows` both resolve the exact cut set themselves.
  // Tracked in HANDOVER §8.
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

/** The holder picker's options — the same shape /inventory/new builds inline. */
export async function activeEmployeeOptions(): Promise<ComboOption[]> {
  const rows = await prisma.employee.findMany({
    where: { employment: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, employeeNo: true },
  });
  return rows.map((e) => ({ value: e.id, label: e.name, sub: e.employeeNo }));
}
