import type { Prisma, PurchaseRequestState } from "@prisma/client";

/**
 * `?state=` is the tab contract (HANDOVER §6.4): the sidebar's "By status"
 * links target it and navIsActive already highlights them, so the tab is
 * parsed on its own rather than as a url-state facet (facets are comma-joined
 * multi-selects; this is a single value that names a nav destination).
 */
export const PURCHASE_STATES = [
  "DRAFT", "SUBMITTED", "IT_REVIEWED", "COMPLETED", "CANCELLED",
] as const satisfies readonly PurchaseRequestState[];

export const PURCHASE_TABS = [
  { id: "ALL", label: "All", href: "/purchases" },
  { id: "DRAFT", label: "Drafts", href: "/purchases?state=DRAFT" },
  { id: "SUBMITTED", label: "Awaiting IT", href: "/purchases?state=SUBMITTED" },
  { id: "IT_REVIEWED", label: "Awaiting finance", href: "/purchases?state=IT_REVIEWED" },
  { id: "COMPLETED", label: "Completed", href: "/purchases?state=COMPLETED" },
  { id: "CANCELLED", label: "Cancelled", href: "/purchases?state=CANCELLED" },
] as const;

export type PurchaseTabId = (typeof PURCHASE_TABS)[number]["id"];

export const PURCHASE_PAGE_SIZE = 50;

export function parsePurchaseState(raw: string | null | undefined): PurchaseRequestState | null {
  return (PURCHASE_STATES as readonly string[]).includes(raw ?? "")
    ? (raw as PurchaseRequestState)
    : null;
}

export function purchaseWhere(
  state: PurchaseRequestState | null,
  q: string,
): Prisma.PurchaseRequestWhereInput {
  const where: Prisma.PurchaseRequestWhereInput = {};
  if (state) where.state = state;
  if (q) {
    // contains-search with insensitive mode is the sanctioned use; the
    // ILIKE-wildcard hazard applies to identity/equals lookups only.
    where.OR = [
      { refNo: { contains: q, mode: "insensitive" } },
      { units: { some: { description: { contains: q, mode: "insensitive" } } } },
    ];
  }
  return where;
}

const DAY_MS = 86_400_000;

/** "today" under a day, "N d" after — the waiting-on form. */
function since(from: Date | null, fallback: Date, now: Date): string {
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
  state: PurchaseRequestState;
  updatedAt: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  /** derived from the thread (bounceBack !== null) — not a column */
  bounced: boolean;
}

/**
 * README 4d: the second line under State. "back from finance" is the fact the
 * enum can't carry — SUBMITTED reached forwards and SUBMITTED reached
 * backwards are the same value and a completely different situation.
 */
export function dwellLine(row: DwellRow, now: Date = new Date()): string {
  const waiting = (d: Date | null) => since(d, row.updatedAt, now);
  switch (row.state) {
    case "DRAFT":
      return row.bounced
        ? `sent back by IT · ${waiting(row.updatedAt)}`
        : `draft · edited ${ago(row.updatedAt, row.updatedAt, now)}`;
    case "SUBMITTED":
      return row.bounced
        ? `back from finance · ${waiting(row.updatedAt)}`
        : `awaiting IT · ${waiting(row.submittedAt)}`;
    case "IT_REVIEWED":
      return `awaiting finance · ${waiting(row.reviewedAt)}`;
    case "COMPLETED":
      return `completed ${ago(row.completedAt, row.updatedAt, now)}`;
    case "CANCELLED":
      return `cancelled ${ago(row.cancelledAt, row.updatedAt, now)}`;
  }
}
