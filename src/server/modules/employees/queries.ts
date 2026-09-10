import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { buildEmployeeOrderBy, buildEmployeeWhere } from "@/lib/employees-list";
import { computeLoadout, effectiveSlots, groupExceptionsByEmployee, resolvePolicy } from "@/lib/loadout";
import { fmtDate } from "@/lib/format";
import { ENTITY_PAGE_SIZE, pageOf } from "@/lib/paging";
import { EXPORT_CAP, type HoldingsExportRow } from "@/lib/export-columns";
import { sameNameKey } from "@/lib/same-name";
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

/**
 * "Policy gaps only" can't be expressed in SQL (it needs per-employee policy
 * resolution + slot fill): cut a NARROW candidate pass, resolve loadouts, and
 * keep the ids with a gap. Shared by the list's gaps branch and the export's
 * gaps branch so both agree on which rows that means.
 */
async function gapKeptIds(where: Prisma.EmployeeWhereInput, orderBy: Prisma.EmployeeOrderByWithRelationInput[]): Promise<string[]> {
  const candidates = await prisma.employee.findMany({
    where, orderBy,
    select: { id: true, title: true, departmentId: true, assets: { select: { id: true, tag: true, model: true, typeId: true, status: true } } },
  });
  const missingAll = await resolveMissing(candidates);
  return candidates.filter((c) => (missingAll.get(c.id) ?? 0) > 0).map((c) => c.id);
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
  const keptIds = await gapKeptIds(where, orderBy);
  const pg = pageOf(keptIds.length, state.page, ENTITY_PAGE_SIZE);
  const pageIds = keptIds.slice(pg.skip, pg.skip + pg.take);
  const rows = await prisma.employee.findMany({ where: { id: { in: pageIds } }, include: rowInclude });
  const byId = new Map(rows.map((r) => [r.id, r]));
  // a page id can vanish between the candidate pass and this fetch (e.g. offboarded mid-request) -- drop it rather than throw
  const employees = pageIds.flatMap((id) => { const r = byId.get(id); return r ? [r] : []; });
  const missing = await resolveMissing(employees);
  return { pg, employees, missing };
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
  const keptIds = await gapKeptIds(where, orderBy);
  if (keptIds.length > EXPORT_CAP) return { over: keptIds.length };
  const rows = await prisma.employee.findMany({ where: { id: { in: keptIds } }, include: rowInclude });
  const byId = new Map(rows.map((r) => [r.id, r]));
  // a kept id can vanish between the candidate pass and this fetch -- drop it rather than throw
  return { rows: keptIds.flatMap((id) => { const r = byId.get(id); return r ? [toExportRow(r)] : []; }) };
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
  // Phase 20 (spec §5): "Facet counts for `employment` keep counting all
  // three values" — the employment groupBy must see OFFBOARDED regardless of
  // the leavers-hidden-by-default rule, so its own where forces the toggle on
  // (leavers=1) on top of clearing the employment facet itself. Department
  // counts keep the default (they should agree with what the list shows).
  const employmentState = without("employment");
  const employmentWhere = buildEmployeeWhere({ ...employmentState, filters: { ...employmentState.filters, leavers: ["1"] } });
  const [deptGroups, empGroups, departments] = await Promise.all([
    prisma.employee.groupBy({ by: ["departmentId"], where: buildEmployeeWhere(without("department")), _count: true }),
    prisma.employee.groupBy({ by: ["employment"], where: employmentWhere, _count: true }),
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

/**
 * Phase 20 (spec §3, plan P-2): the Transfers card and the employee-page
 * "Transferred from X on Y" line's own read — every transfer this person has
 * ever had, newest first. Unpaged by design (spec §7): a person moves
 * departments a handful of times in a career, never enough to need it.
 */
export async function getTransfers(employeeId: string): Promise<Array<{
  id: string;
  from: string;
  to: string;
  fromTitle: string;
  toTitle: string;
  effectiveAt: Date;
  reason: string | null;
  actor: string;
}>> {
  const rows = await prisma.employeeTransfer.findMany({
    where: { employeeId },
    include: { fromDepartment: true, toDepartment: true, actor: { select: { name: true } } },
    orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    from: r.fromDepartment.name,
    to: r.toDepartment.name,
    fromTitle: r.fromTitle,
    toTitle: r.toTitle,
    effectiveAt: r.effectiveAt,
    reason: r.reason,
    actor: r.actor.name,
  }));
}

/**
 * Phase 20 (spec §5): the same-name directory guard's own lookup — the first
 * OTHER employee in the SAME department whose name matches via `sameNameKey`
 * (trimmed/lower-cased/whitespace-collapsed, the same `refKey` every other
 * NAME-keyed lookup in this app goes through). Bounded by department size —
 * a department is a handful to a few dozen people, never the whole roster —
 * so filtering in memory after one `findMany` is cheap and keeps the match
 * rule in one place instead of hand-translating it into SQL. `excludeId`
 * (optional) is the record being edited, so a self-match at the same name it
 * already had never reads back as a collision with itself.
 */
export async function findSameName(
  name: string,
  departmentId: string,
  excludeId?: string,
): Promise<{ id: string; employeeNo: string; department: string } | null> {
  const key = sameNameKey(name);
  const rows = await prisma.employee.findMany({
    where: { departmentId, id: { not: excludeId } },
    select: { id: true, name: true, employeeNo: true, department: { select: { name: true } } },
  });
  const match = rows.find((r) => sameNameKey(r.name) === key);
  return match ? { id: match.id, employeeNo: match.employeeNo, department: match.department.name } : null;
}

/**
 * Phase 20 (spec §5, plan P-3): the `/employees/[id]/holdings` export's row
 * source — one sheet, two blocks. `HoldingsRow` IS `HoldingsExportRow`
 * (`export-columns.ts`): this function builds the FULL sheet, spacer and
 * header rows included, so the route only has to cap and write it — the
 * same division of labour `employeeExportRows` already has with its own
 * route (row-shaping lives beside the query, not the route).
 *
 * "Held since" is the newest `lifecycle.assign` audit entry for that asset,
 * read with ONE `findMany` over every held id (grouped in memory rather than
 * one query per row — the N+1 this app avoids everywhere else), falling back
 * to `asset.updatedAt` for a held asset with no such entry on record (a
 * legacy/seeded holding predating this audit action).
 */
export type HoldingsRow = HoldingsExportRow;

export async function holdingsRows(employeeId: string): Promise<HoldingsRow[]> {
  const [heldAssets, reservations] = await Promise.all([
    prisma.asset.findMany({
      where: { assigneeId: employeeId },
      select: {
        id: true, tag: true, model: true, status: true, updatedAt: true, loanDueAt: true,
        type: { select: { name: true } },
      },
      orderBy: [{ tag: "asc" }],
    }),
    prisma.reservation.findMany({
      where: { employeeId, state: "ACTIVE" },
      select: { createdAt: true, asset: { select: { tag: true, model: true } } },
      orderBy: [{ createdAt: "asc" }],
    }),
  ]);

  const heldIds = heldAssets.map((a) => a.id);
  const assignEntries = heldIds.length
    ? await prisma.auditEntry.findMany({
        where: { entityType: "asset", entityId: { in: heldIds }, action: "lifecycle.assign" },
        select: { entityId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      })
    : [];
  // Newest first (orderBy above), so the first entry seen per asset id is its
  // newest lifecycle.assign — grouped in memory, one query for every held id.
  const sinceByAsset = new Map<string, Date>();
  for (const entry of assignEntries) {
    if (!sinceByAsset.has(entry.entityId)) sinceByAsset.set(entry.entityId, entry.createdAt);
  }

  const assetRows: HoldingsRow[] = heldAssets.map((a) => ({
    section: "asset",
    tag: a.tag,
    model: a.model,
    type: a.type?.name ?? "",
    status: a.status,
    since: sinceByAsset.get(a.id) ?? a.updatedAt,
    loanDue: a.loanDueAt,
  }));

  const blankRow: HoldingsRow = { section: "blank", tag: "", model: "", type: "", status: "", since: null, loanDue: null };
  const headerRow: HoldingsRow = { section: "header", tag: "", model: "", type: "", status: "", since: null, loanDue: null };
  const reservationRows: HoldingsRow[] = reservations.map((r) => ({
    section: "reservation",
    tag: r.asset.tag,
    model: r.asset.model,
    type: "",
    status: "",
    since: r.createdAt,
    loanDue: null,
  }));

  return [...assetRows, blankRow, headerRow, ...reservationRows];
}
