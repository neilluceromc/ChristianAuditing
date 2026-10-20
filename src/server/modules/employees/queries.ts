import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { buildEmployeeOrderBy, buildEmployeeWhere, orderByLoadout } from "@/lib/employees-list";
import { EMPLOYEE_TABS, employeeTabBase, employeeTabState } from "@/lib/employee-tabs";
import { computeLoadout, effectiveSlots, groupExceptionsByEmployee, resolvePolicy } from "@/lib/loadout";
import { fmtDate } from "@/lib/format";
import { pageOf } from "@/lib/paging";
import { pagedSnapshot } from "@/server/paged";
import { EXPORT_CAP, type HoldingsExportRow } from "@/lib/export-columns";
import { sameNameKey } from "@/lib/same-name";
import { RECENT_PEOPLE } from "@/lib/people-search";
import { recentPicks } from "@/server/recent-picks";
import { primarySortOf, type ListState, type SortKey } from "@/lib/url-state";
import type { ComboOption } from "@/components/patterns/entity-combobox";

export interface EmployeeListRow {
  id: string;
  name: string;
  title: string;
  employeeNo: string;
  department: string;
  /** Phase 37 (spec §2.3): INTERNAL department or CLIENT — the list shows a "Client" tag. */
  departmentKind: "INTERNAL" | "CLIENT";
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

/**
 * Loadout resolution for exactly these employees — one exceptions read, bounded by the page.
 * Phase 37: also the Equipment policies page's gap count for one group's active people.
 */
export async function resolveMissing(employees: Array<{
  id: string; title: string; departmentId: string;
  assets: Array<{ typeId: string | null; status: string; id: string; tag: string; model: string }>;
}>) {
  const [policies, exceptions] = await Promise.all([
    prisma.equipmentPolicy.findMany({ include: { slots: { orderBy: { id: "asc" } } }, orderBy: [{ name: "asc" }] }),
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
 * The derived cut and order, in one place so the list and the export agree row for row:
 * "Policy gaps only" keeps the candidates with a required gap, and the Loadout sort (only as the
 * primary key) orders them by completeness — neither can be expressed in SQL, since both need
 * per-employee policy resolution + slot fill. `orderByLoadout` breaks its own ties by name then
 * id, so the SQL order only matters when Loadout is not the primary key.
 */
function derivedCut<T extends { id: string; name: string }>(
  candidates: T[], missingAll: Map<string, number | null>, gapsOnly: boolean, loadoutSort: SortKey | undefined,
): T[] {
  const kept = gapsOnly ? candidates.filter((c) => (missingAll.get(c.id) ?? 0) > 0) : candidates;
  if (!loadoutSort) return kept;
  return orderByLoadout(kept.map((c) => ({ c, id: c.id, name: c.name, missingRequired: missingAll.get(c.id) ?? null })), loadoutSort.dir).map((x) => x.c);
}

/** The export's candidate pass: NARROW (no department row), resolved once, cut and ordered by `derivedCut`. */
async function derivedIds(
  where: Prisma.EmployeeWhereInput, orderBy: Prisma.EmployeeOrderByWithRelationInput[], gapsOnly: boolean, loadoutSort: SortKey | undefined,
): Promise<string[]> {
  const candidates = await prisma.employee.findMany({
    where, orderBy,
    select: { id: true, name: true, title: true, departmentId: true, assets: { select: { id: true, tag: true, model: true, typeId: true, status: true } } },
  });
  const missingAll = await resolveMissing(candidates);
  return derivedCut(candidates, missingAll, gapsOnly, loadoutSort).map((c) => c.id);
}

/** Spec §4: the plain list pages in SQL; the gaps filter and the Loadout sort (Phase 29, plan P-4) cut a NARROW candidate pass first, then page in memory. */
async function pageEmployees(state: ListState, gapsOnly: boolean) {
  const where = buildEmployeeWhere(state);
  const orderBy = buildEmployeeOrderBy(state.sort);
  // Only as the PRIMARY key (Phase 31): a secondary `loadout` left behind by a header click is dropped,
  // as buildEmployeeOrderBy already drops it in SQL, so the clicked column really orders the rows.
  const loadoutSort = primarySortOf(state.sort, "loadout");
  if (!gapsOnly && !loadoutSort) {
    const { rows: employees, ...pg } = await pagedSnapshot(
      state.per,
      state.page,
      (tx) => tx.employee.count({ where }),
      (tx, pg) => tx.employee.findMany({ where, orderBy, skip: pg.skip, take: pg.take, include: rowInclude }),
    );
    const missing = await resolveMissing(employees);
    return { pg, employees, missing };
  }
  // Candidate pass: everything the where admits, resolved once; then the gaps cut and/or the derived order.
  const candidates = await prisma.employee.findMany({ where, orderBy, include: rowInclude });
  const missingAll = await resolveMissing(candidates);
  const kept = derivedCut(candidates, missingAll, gapsOnly, loadoutSort);
  const pg = pageOf(kept.length, state.page, state.per);
  const employees = kept.slice(pg.skip, pg.skip + pg.take);
  return { pg, employees, missing: missingAll };
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
  hiddenLeavers: number;
}> {
  const { pg, employees, missing } = await pageEmployees(state, gapsOnly);
  const hiddenLeavers = state.filters.employment?.length || (state.filters.leavers ?? []).includes("1")
    ? 0
    : await prisma.employee.count({
        where: { ...buildEmployeeWhere({ ...state, filters: { ...state.filters, leavers: ["1"] } }), employment: "OFFBOARDED" },
      });
  return {
    rows: employees.map((e): EmployeeListRow => ({
      id: e.id,
      name: e.name,
      title: e.title,
      employeeNo: e.employeeNo,
      department: e.department.name,
      departmentKind: e.department.kind,
      employment: e.employment,
      m365: e.m365Status,
      items: e.assets.length,
      missingRequired: missing.get(e.id) ?? null,
      joined: fmtDate(e.joinedAt),
    })),
    total: pg.total,
    page: pg.page,
    pageCount: pg.pageCount,
    hiddenLeavers,
  };
}

export interface EmployeeExportRow {
  employeeNo: string; name: string; department: string; kind: "INTERNAL" | "CLIENT"; title: string;
  employment: string; m365Status: string | null; joinedAt: Date; itemsHeld: number;
}

function toExportRow(e: {
  employeeNo: string; name: string; department: { name: string; kind: "INTERNAL" | "CLIENT" }; title: string;
  employment: string; m365Status: string | null; joinedAt: Date; assets: unknown[];
}): EmployeeExportRow {
  return {
    employeeNo: e.employeeNo,
    name: e.name,
    department: e.department.name,
    kind: e.department.kind,
    title: e.title,
    employment: e.employment,
    m365Status: e.m365Status,
    joinedAt: e.joinedAt,
    itemsHeld: e.assets.length,
  };
}

/**
 * The export's row source. Same cut and order `listEmployees` applies for
 * "Policy gaps only" and the Loadout sort (`derivedCut`), so the sheet and the
 * screen agree on which rows and in what order (Phase 31: the Loadout order
 * used to be ignored here). Refuses BEFORE loading rows, same as the assets
 * export: without the gaps cut the refusal reads the count directly off
 * `where`; with it, off the kept id set, since that filter only resolves after
 * the candidate pass.
 */
export async function employeeExportRows(
  state: ListState, gapsOnlyIn: boolean, ids?: string[],
): Promise<{ rows: EmployeeExportRow[] } | { over: number }> {
  // Phase 45 (spec §3.4): a selection (`ids`) overrides every list filter - search, facets, leavers and gaps -
  // and exports exactly those people, in the list's sort. The route has already capped it at BULK_MAX.
  const gapsOnly = ids ? false : gapsOnlyIn;
  const where: Prisma.EmployeeWhereInput = ids ? { id: { in: ids } } : buildEmployeeWhere(state);
  const orderBy = buildEmployeeOrderBy(state.sort);
  const loadoutSort = primarySortOf(state.sort, "loadout");
  if (!gapsOnly) {
    const total = await prisma.employee.count({ where });
    if (total > EXPORT_CAP) return { over: total };
    if (!loadoutSort) {
      const employees = await prisma.employee.findMany({ where, orderBy, include: rowInclude });
      return { rows: employees.map(toExportRow) };
    }
  }
  const keptIds = await derivedIds(where, orderBy, gapsOnly, loadoutSort);
  if (keptIds.length > EXPORT_CAP) return { over: keptIds.length };
  const rows = await prisma.employee.findMany({ where: { id: { in: keptIds } }, include: rowInclude });
  const byId = new Map(rows.map((r) => [r.id, r]));
  // a kept id can vanish between the candidate pass and this fetch -- drop it rather than throw
  return { rows: keptIds.flatMap((id) => { const r = byId.get(id); return r ? [toExportRow(r)] : []; }) };
}

export interface EmployeeFacets {
  department: Array<{ value: string; label: string; count: number }>;
  /** Phase 37 (spec §2.3): the Staff facet — Internal | Client staff. */
  kind: Array<{ value: string; label: string; count: number }>;
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
  // Phase 37 (spec §2.3): the Works for facet lists internal rows first, then clients ("{name} (client)").
  // The Staff counts are per-department counts under every other facet (its own is excluded, as
  // `department`'s is for its counts), summed by the department's kind.
  const kindGroups = await prisma.employee.groupBy({ by: ["departmentId"], where: buildEmployeeWhere(without("kind")), _count: true });
  const kindCount = (kind: "INTERNAL" | "CLIENT") =>
    kindGroups.reduce((n, g) => n + (departments.find((d) => d.id === g.departmentId)?.kind === kind ? g._count : 0), 0);
  const sorted = [...departments.filter((d) => d.kind === "INTERNAL"), ...departments.filter((d) => d.kind === "CLIENT")];
  return {
    department: sorted.map((d) => ({
      value: d.id,
      label: d.kind === "CLIENT" ? `${d.name} (client)` : d.name,
      count: deptGroups.find((g) => g.departmentId === d.id)?._count ?? 0,
    })),
    kind: [
      { value: "INTERNAL", label: "Internal", count: kindCount("INTERNAL") },
      { value: "CLIENT", label: "Client staff", count: kindCount("CLIENT") },
    ],
    employment: (["ACTIVE", "OFFBOARDING", "OFFBOARDED"] as const).map((s) => ({
      value: s, label: s, count: empGroups.find((g) => g.employment === s)?._count ?? 0,
    })),
  };
}

/**
 * Phase 45 (spec §3.1): each tab's count - what that tab shows within the current search, Works for and leavers
 * scope. The base is the state with the tab filters removed; each count adds just that tab's filter, so the number
 * is exactly what clicking the tab lists. Missing kit needs per-person policy resolution, so it is the list's own
 * gaps cut (`listEmployees(base, true).total`), not a SQL count.
 */
export async function employeeTabCounts(state: ListState): Promise<Record<string, number>> {
  const base = employeeTabBase(state);
  const now = new Date(); // one clock for every count, so "New this month" cannot straddle midnight against the rest
  const entries = await Promise.all(EMPLOYEE_TABS.map(async (t): Promise<[string, number]> => {
    const tab = employeeTabState(base, false, t.key);
    if (tab.gapsOnly) return [t.key, (await listEmployees(tab.state, true)).total];
    return [t.key, await prisma.employee.count({ where: buildEmployeeWhere(tab.state, now) })];
  }));
  return Object.fromEntries(entries);
}

/** Phase 36 (spec §4.1): the holder picker's "Recent" list — the user's last picks, still ACTIVE, at most RECENT_PEOPLE. */
export async function recentPeopleOptions(userId: string): Promise<ComboOption[]> {
  const ids = (await recentPicks(userId, "employee")).slice(0, RECENT_PEOPLE);
  if (ids.length === 0) return [];
  const rows = await prisma.employee.findMany({
    where: { id: { in: ids }, employment: "ACTIVE" },
    select: { id: true, name: true, employeeNo: true },
  });
  const byId = new Map(rows.map((e) => [e.id, e]));
  return ids.flatMap((id) => {
    const e = byId.get(id);
    return e ? [{ value: e.id, label: e.name, sub: e.employeeNo }] : [];
  });
}

/**
 * Phase 20 (spec §3, plan P-2): the Transfers card and the employee-page
 * "Transferred from X on Y" line's own read — every transfer this person has
 * ever had, newest first. Unpaged by design (spec §7): a person moves
 * departments a handful of times in a career, never enough to need it.
 * Phase 39 (spec §2.5): the profile asks for only the latest `take` (3); the
 * Timeline keeps the full history.
 */
export async function getTransfers(employeeId: string, take?: number): Promise<Array<{
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
    take,
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
