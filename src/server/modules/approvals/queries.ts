import { cache } from "react";
import type { ApprovalType, Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { summarizeApproval } from "@/lib/approval-execution";
import { RETURN_TARGETS, isAssignable } from "@/lib/asset-class";
import { approvalClassWhere, isApprover } from "@/lib/approval-access";
import {
  approvalsSearchWhere, slaLabel, tabWhere, viaWhere, CLOSED_VIA, QUEUE_TABS, type QueueTab, type ClosedVia,
} from "@/lib/approvals-list";
import { APPROVAL_KIND_LABEL } from "@/lib/labels";
import { LOG_PAGE_SIZE } from "@/lib/paging";
import { pagedSnapshot } from "@/server/paged";

/** Serializable queue row — the island gets strings, no Dates/Decimals. */
export interface ApprovalRow {
  id: string;
  refNo: string;
  state: string;
  priority: string;
  line1: string;
  line2: string;
  sla: { text: string; overdue: boolean };
  owner: string | null;
  mine: boolean;
  direct: boolean;
}

/** Plan P-5: the queue's `q` and `?type=`; the default narrows nothing (today's callers). */
export interface ApprovalsSearch {
  q: string;
  types: ApprovalType[];
}

const NO_SEARCH: ApprovalsSearch = { q: "", types: [] };

export async function listApprovals(
  tab: QueueTab, via: ClosedVia, userId: string, role: Role, requestedPage: number,
  search: ApprovalsSearch = NO_SEARCH,
): Promise<{
  rows: ApprovalRow[]; total: number; page: number; pageCount: number;
}> {
  const where = {
    AND: [
      tabWhere(tab, userId), tab === "closed" ? viaWhere(via) : {}, approvalClassWhere(role),
      approvalsSearchWhere(search.q, search.types),
    ],
  };
  const { rows: approvals, total, page, pageCount } = await pagedSnapshot(
    LOG_PAGE_SIZE,
    requestedPage,
    (tx) => tx.approval.count({ where }),
    (tx, pg) =>
      tx.approval.findMany({
        where,
        include: { asset: true, employee: true, claimedBy: true },
        // Open work orders by what breaks first; closed history reads newest-first.
        // The id tiebreaker keeps two rows with one slaAt in one order across pages.
        orderBy: tab === "closed" ? [{ updatedAt: "desc" }, { id: "desc" }] : [{ slaAt: "asc" }, { id: "asc" }],
        skip: pg.skip, take: pg.take,
      }),
  );
  const rows = approvals.map((a) => {
    const s = summarizeApproval(a.type, a.payload, {
      assetTag: a.asset?.tag,
      employeeName: a.employee?.name,
      cls: a.asset?.cls,
    });
    return {
      id: a.id,
      refNo: a.refNo,
      state: a.state,
      priority: a.priority,
      line1: s.line1,
      line2: s.line2,
      sla: slaLabel(a.slaAt),
      owner: a.claimedBy?.name ?? null,
      mine: a.claimedById === userId,
      direct: a.appliedDirectly,
    };
  });
  return { rows, total, page, pageCount };
}

export async function tabCounts(
  userId: string, role: Role, search: ApprovalsSearch = NO_SEARCH,
): Promise<Record<QueueTab, number>> {
  const searchWhere = approvalsSearchWhere(search.q, search.types);
  const counts = await Promise.all(
    QUEUE_TABS.map((t) =>
      prisma.approval.count({ where: { AND: [tabWhere(t.id, userId), approvalClassWhere(role), searchWhere] } }),
    ),
  );
  return Object.fromEntries(QUEUE_TABS.map((t, i) => [t.id, counts[i]])) as Record<QueueTab, number>;
}

/** Closed tab's `?via=` chip counts (Phase 21) — same closed rule, class scope and search as `listApprovals`. */
export async function closedViaCounts(
  userId: string, role: Role, search: ApprovalsSearch = NO_SEARCH,
): Promise<Record<ClosedVia, number>> {
  const searchWhere = approvalsSearchWhere(search.q, search.types);
  const counts = await Promise.all(
    CLOSED_VIA.map((v) =>
      prisma.approval.count({
        where: { AND: [tabWhere("closed", userId), viaWhere(v), approvalClassWhere(role), searchWhere] },
      }),
    ),
  );
  return Object.fromEntries(CLOSED_VIA.map((v, i) => [v, counts[i]])) as Record<ClosedVia, number>;
}

/** Type facet options for the current tab + q (the facet's own selection cleared), friendly labels. */
export async function typeCounts(
  tab: QueueTab, via: ClosedVia, userId: string, role: Role, q: string,
): Promise<{ value: ApprovalType; label: string; count: number }[]> {
  const where = {
    AND: [tabWhere(tab, userId), tab === "closed" ? viaWhere(via) : {}, approvalClassWhere(role), approvalsSearchWhere(q, [])],
  };
  const groups = await prisma.approval.groupBy({ by: ["type"], where, _count: { _all: true } });
  const by = new Map(groups.map((g) => [g.type, g._count._all]));
  return (Object.keys(APPROVAL_KIND_LABEL) as ApprovalType[]).map((value) => ({
    value, label: APPROVAL_KIND_LABEL[value], count: by.get(value) ?? 0,
  }));
}

/** Spec §4.1 (plan P-4): the next request this user can act on, in the Open tab's SLA order. */
export async function nextInQueue(
  userId: string, role: Role, afterId: string,
): Promise<{ id: string; refNo: string } | null> {
  if (!isApprover(role)) return null;
  return prisma.approval.findFirst({
    where: {
      AND: [
        approvalClassWhere(role),
        { OR: [{ state: "PENDING" }, { state: "CLAIMED", claimedById: userId }] },
        { id: { not: afterId } },
      ],
    },
    orderBy: [{ slaAt: "asc" }, { id: "asc" }],
    select: { id: true, refNo: true },
  });
}

export const getApproval = cache((id: string) =>
  prisma.approval.findUnique({
    where: { id },
    include: { asset: { include: { assignee: true } }, employee: true, requestedBy: true, claimedBy: true },
  }),
);

export interface SystemCheck {
  label: string;
  pass: boolean;
  detail: string;
}

type Payload = Record<string, unknown> | null;
const obj = (v: unknown): Payload =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * "What the system checked" (README 1k) — three machine findings evaluated
 * against LIVE rows at render time. Advisory: the worker re-runs the real
 * guards inside its execution transaction.
 */
export async function systemChecks(
  approval: NonNullable<Awaited<ReturnType<typeof getApproval>>>,
): Promise<SystemCheck[]> {
  const payload = obj(approval.payload) ?? {};
  const to = obj(payload.to);
  const from = obj(payload.from);
  const asset = approval.asset; // already loaded (with assignee) by getApproval

  const assetCheck: SystemCheck = approval.assetId
    ? asset
      ? { label: "Asset exists", pass: true, detail: `${asset.tag} · ${asset.status}` }
      : { label: "Asset exists", pass: false, detail: "the referenced asset is gone" }
    : { label: "Asset attached", pass: false, detail: "no asset on this approval — execution will refuse" };

  switch (approval.type) {
    case "lifecycle_assign": {
      const employee = to?.assigneeId
        ? await prisma.employee.findUnique({ where: { id: String(to.assigneeId) } })
        : approval.employeeId
          ? await prisma.employee.findUnique({ where: { id: approval.employeeId } })
          : null;
      return [
        assetCheck,
        asset
          ? { label: "Asset is assignable", pass: isAssignable(asset), detail: `reads ${asset.status} right now` }
          : { label: "Asset is assignable", pass: false, detail: "—" },
        employee
          ? { label: "Recipient is active", pass: employee.employment === "ACTIVE", detail: `${employee.employeeNo} · ${employee.employment}` }
          : { label: "Recipient is active", pass: false, detail: "the referenced employee is gone" },
      ];
    }
    case "lifecycle_return": {
      const expected = from?.assigneeId ? String(from.assigneeId) : null;
      // Four outcomes (README 3e), so this can't be pinned to SPARE either.
      const target = to && typeof to.status === "string" ? to.status : null;
      return [
        assetCheck,
        asset
          ? {
              label: "Still held by the returner",
              pass: asset.assigneeId === expected,
              detail: asset.assignee ? `held by ${asset.assignee.name}` : "held by nobody",
            }
          : { label: "Still held by the returner", pass: false, detail: "—" },
        {
          label: "Return target",
          pass: target !== null && asset !== null && (RETURN_TARGETS[asset.cls] as readonly string[]).includes(target),
          detail: !approval.assetId
            ? "—"
            : asset
              ? (target ? `returns as ${target}` : "no target status in the payload")
              : "asset is gone — target not checked",
        },
      ];
    }
    case "lifecycle_change_status": {
      const expectedFrom = from?.status ? String(from.status) : null;
      return [
        assetCheck,
        asset && expectedFrom
          ? { label: "Status unchanged since request", pass: asset.status === expectedFrom, detail: `payload expected ${expectedFrom}, reads ${asset.status}` }
          : { label: "Status unchanged since request", pass: true, detail: "no from-status recorded" },
        { label: "Target status", pass: typeof to?.status === "string", detail: String(to?.status ?? "missing") },
      ];
    }
    default:
      return [
        assetCheck,
        { label: "Executor available", pass: false, detail: "this type has no executor yet — execution will fail honestly" },
        { label: "Payload well-formed", pass: false, detail: "unsupported type" },
      ];
  }
}
