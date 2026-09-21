import { fmtDate } from "@/lib/format";
// Phase 26: the tabs moved to @/lib/holds so they have a unit test; re-exported
// here so every existing caller of this module still compiles unchanged.
import { RESERVATION_TABS, type ReservationTab } from "@/lib/holds";
import { ENTITY_PAGE_SIZE } from "@/lib/paging";
import { pagedSnapshot } from "@/server/paged";

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
  expires: string;
  resolved: string;
  /** how it closed: the clock, or a person */
  closedBy: "clock" | "person" | null;
}

export async function listReservations(tab: ReservationTab, requestedPage: number): Promise<{
  rows: ReservationRow[];
  counts: Record<ReservationTab, number>;
  total: number;
  page: number;
  pageCount: number;
}> {
  const states = RESERVATION_TABS.find((t) => t.id === tab)!.states;
  // The tab groupBy runs as pagedSnapshot's `count` function — it returns
  // `counts[tab]`, and `counts` itself is captured via this closure variable
  // so the caller can still return it alongside the page (P-3/spec §5: the
  // groupBy and the page read one RepeatableRead snapshot together).
  let counts!: Record<ReservationTab, number>;
  const { rows: reservations, total, page, pageCount } = await pagedSnapshot(
    ENTITY_PAGE_SIZE,
    requestedPage,
    async (tx) => {
      const grouped = await tx.reservation.groupBy({ by: ["state"], _count: true });
      const countOf = (s: string) => grouped.find((g) => g.state === s)?._count ?? 0;
      counts = {
        ACTIVE: countOf("ACTIVE"),
        FULFILLED: countOf("FULFILLED"),
        CLOSED: countOf("RELEASED") + countOf("EXPIRED"),
      };
      return counts[tab];
    },
    (tx, pg) =>
      tx.reservation.findMany({
        where: { state: { in: [...states] } },
        include: { asset: true, employee: true },
        // rows seeded in one transaction share a createdAt millisecond — the id
        // tiebreaker is what stops two reads returning a different order
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: pg.skip, take: pg.take,
      }),
  );

  return {
    rows: reservations.map((r): ReservationRow => ({
      id: r.id,
      state: r.state,
      assetId: r.assetId,
      tag: r.asset.tag,
      model: r.asset.model,
      assetStatus: r.asset.status,
      employeeId: r.employeeId,
      employeeName: r.employee.name,
      employeeNo: r.employee.employeeNo,
      reason: r.reason,
      expires: fmtDate(r.expiresAt),
      // An EXPIRED hold has no resolvedAt and never will: nothing in the system
      // sweeps ACTIVE → EXPIRED, so no code path records a resolution moment.
      // The date that answers "when did this expire" is expiresAt, which the
      // row already carries. Reading it from resolvedAt left every expired row
      // rendering "expired —" forever. Backfilling resolvedAt in the seed
      // instead would have invented a resolution event that never occurred.
      resolved: r.state === "EXPIRED" ? fmtDate(r.expiresAt) : fmtDate(r.resolvedAt),
      closedBy: r.state === "EXPIRED" ? "clock" : r.state === "RELEASED" ? "person" : null,
    })),
    counts,
    total,
    page,
    pageCount,
  };
}
