import type { ApprovalType, Prisma } from "@prisma/client";
import { APPROVAL_KIND_LABEL } from "./labels";

/** README 1k tab order. `?tab=` is the URL contract; open is the default. */
export const QUEUE_TABS = [
  { id: "open", label: "Open" },
  { id: "mine", label: "Mine" },
  { id: "unclaimed", label: "Unclaimed" },
  { id: "failed", label: "Failed" },
  { id: "closed", label: "Closed" },
] as const;

export type QueueTab = (typeof QUEUE_TABS)[number]["id"];

export function parseTab(raw: string | null | undefined): QueueTab {
  return (QUEUE_TABS.some((t) => t.id === raw) ? raw : "open") as QueueTab;
}

/**
 * The five tabs' counts overlap by design (Open ⊇ Mine ∪ Unclaimed — a
 * CLAIMED row you claimed is on both Open and Mine; a PENDING row is on both
 * Open and Unclaimed). Closed is REJECTED ∪ EXECUTED regardless of how the
 * row got there (queued and resolved, or applied directly, Phase 21); `via`
 * (viaWhere below) narrows Closed only — it is not one of these five tabs.
 */
export function tabWhere(tab: QueueTab, userId: string): Prisma.ApprovalWhereInput {
  switch (tab) {
    case "open": return { state: { in: ["PENDING", "CLAIMED"] } };
    case "mine": return { state: "CLAIMED", claimedById: userId };
    case "unclaimed": return { state: "PENDING" };
    case "failed": return { state: "EXECUTION_FAILED" };
    case "closed": return { state: { in: ["REJECTED", "EXECUTED"] } };
  }
}

/** Closed tab's `?via=` narrowing (Phase 21: appliedDirectly). */
export const CLOSED_VIA = ["all", "direct", "queue"] as const;
export type ClosedVia = (typeof CLOSED_VIA)[number];

export function parseVia(raw: string | null | undefined): ClosedVia {
  return (CLOSED_VIA as readonly string[]).includes(raw ?? "") ? (raw as ClosedVia) : "all";
}

export function viaWhere(via: ClosedVia): Prisma.ApprovalWhereInput {
  switch (via) {
    case "all": return {};
    case "direct": return { appliedDirectly: true };
    case "queue": return { appliedDirectly: false };
  }
}

export const CLOSED_VIA_LABEL: Record<ClosedVia, string> = {
  all: "All",
  direct: "Applied directly",
  queue: "Through the queue",
};

/** Home's "Applied directly · last 7 days" section window. */
export const DIRECT_WINDOW_DAYS = 7;

export const DIRECT_KIND_LABEL: Record<ApprovalType, string> = {
  lifecycle_assign: "Assigned",
  lifecycle_return: "Returned",
  lifecycle_change_status: "Status changed",
  lifecycle_replace: "Replaced",
  lifecycle_transfer: "Transferred",
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Overdue renders 600-weight in the fault text colour (README 1k). */
export function slaLabel(slaAt: Date, now: Date = new Date()): { text: string; overdue: boolean } {
  const delta = slaAt.getTime() - now.getTime();
  const overdue = delta < 0;
  const abs = Math.abs(delta);
  const amount = abs >= DAY_MS ? `${Math.round(abs / DAY_MS)} d` : `${Math.max(1, Math.round(abs / HOUR_MS))} h`;
  return { text: overdue ? `${amount} overdue` : `in ${amount}`, overdue };
}

const APPROVAL_TYPES = Object.keys(APPROVAL_KIND_LABEL) as ApprovalType[];

/** `?type=` is comma-separated (plan P-5); anything not a real type is dropped. */
export function parseTypes(raw: string | null | undefined): ApprovalType[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter((s): s is ApprovalType => (APPROVAL_TYPES as string[]).includes(s));
}

/** Plan P-5: q over ref no, tag and person; types in. {} when neither is set. */
export function approvalsSearchWhere(q: string, types: ApprovalType[]): Prisma.ApprovalWhereInput {
  const and: Prisma.ApprovalWhereInput[] = [];
  const t = q.trim();
  if (t) {
    const c = { contains: t, mode: "insensitive" as const };
    and.push({ OR: [{ refNo: c }, { asset: { tag: c } }, { employee: { name: c } }, { employee: { employeeNo: c } }] });
  }
  if (types.length) and.push({ type: { in: types } });
  return and.length ? { AND: and } : {};
}

/** Today's exact URLs when q/type are empty (pins such as /approvals?tab=closed&via=direct stay byte-identical). */
export function approvalsHref(p: { tab: QueueTab; page?: number; via?: ClosedVia; q?: string; types?: ApprovalType[] }): string {
  const qs = new URLSearchParams();
  if (p.tab !== "open") qs.set("tab", p.tab);
  if (p.page && p.page > 1) qs.set("page", String(p.page));
  if (p.tab === "closed" && p.via && p.via !== "all") qs.set("via", p.via);
  if (p.q?.trim()) qs.set("q", p.q.trim());
  if (p.types?.length) qs.set("type", p.types.join(","));
  const s = qs.toString().replaceAll("%2C", ",");
  return s ? `/approvals?${s}` : "/approvals";
}
