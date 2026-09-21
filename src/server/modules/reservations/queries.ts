import { fmtDate } from "@/lib/format";
// Phase 26: the tabs moved to @/lib/holds so they have a unit test; re-exported
// here so every existing caller of this module still compiles unchanged.
import { buildHoldOrderBy, buildHoldWhere, RESERVATION_TABS, type ReservationTab } from "@/lib/holds";
import { ENTITY_PAGE_SIZE } from "@/lib/paging";
import type { ListState } from "@/lib/url-state";
import { prisma } from "@/server/db/client";
import { pagedSnapshot } from "@/server/paged";
import type { FacetOption } from "@/server/modules/inventory/queries";

export { RESERVATION_TABS, parseReservationTab, type ReservationTab } from "@/lib/holds";

export interface ReservationRow {
  id: string;
  state: string;
  assetId: string;
  tag: string;
  model: string;
  /** the asset's OWN status — a hold never changes it, or spares turn into phantoms */
  assetStatus: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  reason: string | null;
  expiresAt: Date | null;
  expires: string;
  created: string;
  resolved: string;
  /** how it closed: the clock, or a person */
  closedBy: "clock" | "person" | null;
}

export interface HoldFacets { employee: FacetOption[]; department: FacetOption[] }

export async function listReservations(tab: ReservationTab, state: ListState): Promise<{
  rows: ReservationRow[]; counts: Record<ReservationTab, number>; total: number; page: number; pageCount: number; facets: HoldFacets;
}> {
  const where = buildHoldWhere(tab, state);
  const orderBy = buildHoldOrderBy(state.sort);
  let counts!: Record<ReservationTab, number>;
  const { rows: reservations, total, page, pageCount } = await pagedSnapshot(
    ENTITY_PAGE_SIZE, state.page,
    async (tx) => {
      // Phase 26 fix wave (I-2): the badges count what the tab links carry — the
      // same search and facets — so a badge never promises rows its list lacks.
      const entries = await Promise.all(
        RESERVATION_TABS.map(async (t) => [t.id, await tx.reservation.count({ where: buildHoldWhere(t.id, state) })] as const),
      );
      counts = Object.fromEntries(entries) as Record<ReservationTab, number>;
      return counts[tab];
    },
    (tx, pg) => tx.reservation.findMany({ where, include: { asset: true, employee: { include: { department: true } } }, orderBy, skip: pg.skip, take: pg.take }),
  );
  const facets = await holdFacets(tab, state);
  return {
    rows: reservations.map((r): ReservationRow => ({
      id: r.id, state: r.state, assetId: r.assetId, tag: r.asset.tag, model: r.asset.model, assetStatus: r.asset.status,
      employeeId: r.employeeId, employeeName: r.employee.name, employeeNo: r.employee.employeeNo, reason: r.reason,
      expiresAt: r.expiresAt, expires: fmtDate(r.expiresAt),
      created: fmtDate(r.createdAt),
      // Phase 26: the sweep now stamps resolvedAt on expiry; the seeded EXPIRED row predates it and keeps reading expiresAt.
      resolved: fmtDate(r.resolvedAt ?? (r.state === "EXPIRED" ? r.expiresAt : null)),
      closedBy: r.state === "EXPIRED" ? "clock" : r.state === "RELEASED" ? "person" : null,
    })),
    counts, total, page, pageCount, facets,
  };
}

/** Facet counts over the current tab, each narrowed by the OTHER facet and the search (the Phase 25 rule). */
async function holdFacets(tab: ReservationTab, state: ListState): Promise<HoldFacets> {
  const without = (facet: string): ListState => ({ ...state, filters: { ...state.filters, [facet]: [] } });
  const [byEmployee, byDept, employees, departments] = await Promise.all([
    prisma.reservation.groupBy({ by: ["employeeId"], where: buildHoldWhere(tab, without("employee")), _count: true }),
    prisma.reservation.findMany({ where: buildHoldWhere(tab, without("department")), select: { employee: { select: { departmentId: true } } } }),
    prisma.employee.findMany({ where: { reservations: { some: { state: { in: [...RESERVATION_TABS.find((t) => t.id === tab)!.states] } } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const deptCount = new Map<string, number>();
  for (const r of byDept) deptCount.set(r.employee.departmentId, (deptCount.get(r.employee.departmentId) ?? 0) + 1);
  return {
    employee: employees.map((e) => ({ value: e.id, label: e.name, count: byEmployee.find((g) => g.employeeId === e.id)?._count ?? 0 })),
    department: departments.map((d) => ({ value: d.id, label: d.name, count: deptCount.get(d.id) ?? 0 })),
  };
}

/** Phase 26 (spec §4.2): the one live hold on an asset, for the record's banner and the Assign dialog. */
export async function activeHoldFor(assetId: string) {
  return prisma.reservation.findFirst({
    where: { assetId, state: "ACTIVE" },
    select: { id: true, expiresAt: true, reason: true, employee: { select: { id: true, name: true, employeeNo: true } } },
  });
}
