import type { Prisma } from "@prisma/client";
import { addDays, dayFromISO, isPastDue } from "./deadlines";
import { localDateISO } from "./format";
import { pruneDue } from "./retention";
import type { ListConfig, ListState, SortKey } from "./url-state";

/** Phase 26 (spec §0 decision 1): a hold lasts seven calendar days unless IT picks another date; today is the floor. */
export const HOLD_DEFAULT_DAYS = 7;
export const defaultHoldExpiry = (todayISO: string) => addDays(todayISO, HOLD_DEFAULT_DAYS);
export const minHoldExpiry = (todayISO: string) => todayISO;

export interface HoldStatus { days: number; text: string; tone: "neutral" | "accent"; expired: boolean }

/** A hold is live through the whole of its last day (Asia/Manila) — the same rule as isPastDue. */
export function isHoldExpired(expiresAt: Date, todayISO: string): boolean { return isPastDue(expiresAt, todayISO); }

/** The pill's words — deliberately "expires…", never "due…", so a hold and a deadline never read alike on one screen. */
export function holdStatus(expiresAt: Date, todayISO: string): HoldStatus {
  const days = Math.round((dayFromISO(localDateISO(expiresAt)).getTime() - dayFromISO(todayISO).getTime()) / 86_400_000);
  const text = days < 0 ? `expired ${-days} d ago` : days === 0 ? "expires today" : days === 1 ? "expires tomorrow" : `expires in ${days} d`;
  return { days, text, tone: days <= 0 ? "accent" : "neutral", expired: isHoldExpired(expiresAt, todayISO) };
}

/** The worker sweeps hourly, on the same gate retention uses. */
export const expireDue = pruneDue;

/**
 * Tabs write `?state=`. EXPIRED (the clock ran out) and RELEASED (a person let
 * it go) share the Closed tab but must stay distinguishable — README 5c.
 * (Moved here from the server module in Phase 26 so it has a unit test.)
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

/** Phase 26 (spec §5.4): search, two facets, four sort keys; expiring first. */
export const HOLDS_LIST_CONFIG: ListConfig = {
  facets: ["employee", "department"],
  sortable: ["expiresAt", "createdAt", "employee", "tag"],
  defaultSort: [{ key: "expiresAt", dir: "asc" }],
};

export function buildHoldWhere(tab: ReservationTab, state: ListState): Prisma.ReservationWhereInput {
  const states = RESERVATION_TABS.find((t) => t.id === tab)!.states;
  const where: Prisma.ReservationWhereInput = { state: { in: [...states] } };
  if (state.q) {
    const q = { contains: state.q, mode: "insensitive" as const };
    where.OR = [
      { asset: { tag: q } }, { asset: { model: q } },
      { employee: { name: q } }, { employee: { employeeNo: q } },
    ];
  }
  if (state.filters.employee?.length) where.employeeId = { in: state.filters.employee };
  if (state.filters.department?.length) where.employee = { departmentId: { in: state.filters.department } };
  return where;
}

export function buildHoldOrderBy(sort: SortKey[]): Prisma.ReservationOrderByWithRelationInput[] {
  const order = sort.length ? sort : HOLDS_LIST_CONFIG.defaultSort;
  return [
    ...order.map(({ key, dir }): Prisma.ReservationOrderByWithRelationInput => {
      if (key === "expiresAt") return { expiresAt: { sort: dir, nulls: "last" } };
      if (key === "employee") return { employee: { name: dir } };
      if (key === "tag") return { asset: { tag: dir } };
      return { createdAt: dir };
    }),
    { id: "asc" },
  ];
}
