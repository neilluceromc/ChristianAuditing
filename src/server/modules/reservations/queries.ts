import { prisma } from "@/server/db/client";
import { fmtDate } from "@/lib/format";

/**
 * Tabs write `?state=`. EXPIRED (the clock ran out) and RELEASED (a person let
 * it go) share the Closed tab but must stay distinguishable — README 5c.
 */
export const RESERVATION_TABS = [
  { id: "ACTIVE", label: "Active", states: ["ACTIVE"] },
  { id: "FULFILLED", label: "Fulfilled", states: ["FULFILLED"] },
  { id: "CLOSED", label: "Closed", states: ["RELEASED", "EXPIRED"] },
] as const;

export type ReservationTab = (typeof RESERVATION_TABS)[number]["id"];

export function parseReservationTab(raw: string | null | undefined): ReservationTab {
  return (RESERVATION_TABS.some((t) => t.id === raw) ? raw : "ACTIVE") as ReservationTab;
}

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

export async function listReservations(tab: ReservationTab): Promise<{
  rows: ReservationRow[];
  counts: Record<ReservationTab, number>;
}> {
  const states = RESERVATION_TABS.find((t) => t.id === tab)!.states;
  const [reservations, grouped] = await Promise.all([
    prisma.reservation.findMany({
      where: { state: { in: [...states] } },
      include: { asset: true, employee: true },
      // rows seeded in one transaction share a createdAt millisecond — the id
      // tiebreaker is what stops two reads returning a different order
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    prisma.reservation.groupBy({ by: ["state"], _count: true }),
  ]);
  const countOf = (s: string) => grouped.find((g) => g.state === s)?._count ?? 0;

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
    counts: {
      ACTIVE: countOf("ACTIVE"),
      FULFILLED: countOf("FULFILLED"),
      CLOSED: countOf("RELEASED") + countOf("EXPIRED"),
    },
  };
}
