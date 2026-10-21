import type { Prisma, PurchaseOrderState } from "@prisma/client";

/**
 * `?state=` is the tab contract (HANDOVER §6.4): the sidebar's Purchase orders
 * views target it and currentNav highlights them by it, so the tab is
 * parsed on its own rather than as a url-state facet (facets are comma-joined
 * multi-selects; this is a single value that names a nav destination).
 */
export const PURCHASE_STATES = [
  "WITH_IT", "SENT_BACK", "READY", "CANCELLED",
] as const satisfies readonly PurchaseOrderState[];

export const PURCHASE_TABS = [
  { id: "ALL", label: "All", href: "/purchases" },
  { id: "WITH_IT", label: "With IT", href: "/purchases?state=WITH_IT" },
  { id: "SENT_BACK", label: "Sent back", href: "/purchases?state=SENT_BACK" },
  { id: "READY", label: "Ready to register", href: "/purchases?state=READY" },
  { id: "CANCELLED", label: "Cancelled", href: "/purchases?state=CANCELLED" },
] as const;

export type PurchaseTabId = (typeof PURCHASE_TABS)[number]["id"];

export function parsePurchaseState(raw: string | null | undefined): PurchaseOrderState | null {
  return (PURCHASE_STATES as readonly string[]).includes(raw ?? "")
    ? (raw as PurchaseOrderState)
    : null;
}

export function purchaseWhere(
  state: PurchaseOrderState | null,
  q: string,
  department: string | null = null,
  supplier: string | null = null,
): Prisma.PurchaseOrderWhereInput {
  const where: Prisma.PurchaseOrderWhereInput = {};
  if (state) where.state = state;
  if (q) {
    // contains-search with insensitive mode is the sanctioned use; the
    // ILIKE-wildcard hazard applies to identity/equals lookups only.
    where.OR = [
      { refNo: { contains: q, mode: "insensitive" } },
      { lines: { some: { description: { contains: q, mode: "insensitive" } } } },
    ];
  }
  // Spec §5.1: "none" is the pre-phase rows that carry no department at all.
  if (department === "none") where.departmentId = null;
  else if (department) where.departmentId = department;
  if (supplier) where.vendorId = supplier;
  return where;
}

const DAY_MS = 86_400_000;

/** "today" under a day, "N d" after — the waiting-on form. Shared with the worklist's Purchase reviews rows (Phase 40). */
export function since(from: Date | null, fallback: Date, now: Date): string {
  const d = from ?? fallback;
  const days = Math.floor((now.getTime() - d.getTime()) / DAY_MS);
  return days < 1 ? "today" : `${days} d`;
}

/** Past-tense form: "today" must not become "today ago". */
function ago(from: Date | null, fallback: Date, now: Date): string {
  const label = since(from, fallback, now);
  return label === "today" ? "today" : `${label} ago`;
}

export interface DwellRow {
  state: PurchaseOrderState;
  updatedAt: Date;
  submittedAt: Date | null;
  sentBackAt?: Date | null;
  cancelledAt: Date | null;
  /** derived from the thread (bounceBack !== null) — not a column */
  bounced: boolean;
}

/**
 * README 4d: the second line under State. "back from finance" is the fact the
 * enum can't carry — a legacy request Finance bounced and one that simply
 * waits on IT are both WITH_IT, and a completely different situation.
 */
export function dwellLine(row: DwellRow, now: Date = new Date()): string {
  const waiting = (d: Date | null | undefined) => since(d ?? null, row.updatedAt, now);
  switch (row.state) {
    case "SENT_BACK":
      return row.bounced || row.sentBackAt
        ? `sent back · ${waiting(row.sentBackAt)}`
        : `with Purchasing · edited ${ago(row.updatedAt, row.updatedAt, now)}`;
    case "WITH_IT":
      return row.bounced
        ? `back from finance · ${waiting(row.updatedAt)}`
        : `with IT · ${waiting(row.submittedAt)}`;
    case "READY":
      return `ready to register · ${waiting(row.updatedAt)}`;
    case "CANCELLED":
      return `cancelled ${ago(row.cancelledAt, row.updatedAt, now)}`;
  }
}
