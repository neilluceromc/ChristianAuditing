import { cache } from "react";
import { prisma } from "@/server/db/client";
import { RETURN_STATUSES, summarizeApproval } from "@/lib/approval-execution";
import { slaLabel, tabWhere, QUEUE_TABS, type QueueTab } from "@/lib/approvals-list";

export const QUEUE_PAGE_SIZE = 50;

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
}

export async function listApprovals(tab: QueueTab, userId: string): Promise<ApprovalRow[]> {
  const approvals = await prisma.approval.findMany({
    where: tabWhere(tab, userId),
    include: { asset: true, employee: true, claimedBy: true },
    // Open work orders by what breaks first; closed history reads newest-first.
    orderBy: tab === "closed" ? { updatedAt: "desc" } : { slaAt: "asc" },
    take: QUEUE_PAGE_SIZE,
  });
  return approvals.map((a) => {
    const s = summarizeApproval(a.type, a.payload, {
      assetTag: a.asset?.tag,
      employeeName: a.employee?.name,
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
    };
  });
}

export async function tabCounts(userId: string): Promise<Record<QueueTab, number>> {
  const counts = await Promise.all(
    QUEUE_TABS.map((t) => prisma.approval.count({ where: tabWhere(t.id, userId) })),
  );
  return Object.fromEntries(QUEUE_TABS.map((t, i) => [t.id, counts[i]])) as Record<QueueTab, number>;
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
          ? { label: "Asset is assignable", pass: asset.status === "SPARE", detail: `reads ${asset.status} right now` }
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
          pass: target !== null && (RETURN_STATUSES as readonly string[]).includes(target),
          detail: target ? `returns as ${target}` : "no target status in the payload",
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
