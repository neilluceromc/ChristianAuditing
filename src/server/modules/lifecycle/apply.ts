import type { AssetClass, AssetStatus, Prisma } from "@prisma/client";
import type { AuditDiff } from "@/lib/audit-diff";
import {
  DEFAULT_STATUS, DIRECT_LIFECYCLE_CLASSES, HOLDER_STATUSES, ASSIGNABLE_FROM, isAssignable,
} from "@/lib/asset-class";

export type LifecycleAsset = {
  id: string; tag: string; cls: AssetClass; status: AssetStatus;
  assigneeId: string | null; defectiveSince: Date | null; returnedAt: Date | null; loanDueAt: Date | null;
};

export type LifecycleChange =
  | { kind: "assign"; employeeId: string; status: AssetStatus; loanDueAt: Date | null }
  | { kind: "return"; status: AssetStatus }
  | { kind: "change-status"; status: AssetStatus };

export interface Prepared {
  updates: Prisma.AssetUpdateInput;
  diff: AuditDiff;
  /** the recipient whose ACTIVE reservation on this asset gets FULFILLED, if any */
  settleReservationFor: string | null;
}

export type PrepareResult = { ok: true; prepared: Prepared } | { ok: false; error: string };

/**
 * Phase 15 (spec §2.2). THE lifecycle executor's guards and planned write, shared
 * by the worker (executing an approval) and the direct actions (IT confirming a
 * change). Guard messages are the worker's, verbatim: the retry UI shows them.
 * Writes nothing — commitLifecycle does — so the worker can claim its approval
 * row between the two and a failed claim never leaves a written asset behind.
 */
export async function prepareLifecycle(
  tx: Prisma.TransactionClient,
  asset: LifecycleAsset,
  change: LifecycleChange,
  now: Date = new Date(),
): Promise<PrepareResult> {
  const updates: Prisma.AssetUpdateInput = { status: change.status };
  const diff: AuditDiff = {};
  let settleReservationFor: string | null = null;
  let assigneeLabelFrom: string | null = null;
  let assigneeLabelTo: string | null = null;

  if (change.kind === "assign") {
    const employee = await tx.employee.findUnique({ where: { id: change.employeeId } });
    if (!employee) return { ok: false, error: "Execution guard: target employee no longer exists — assignment refused" };
    if (employee.employment !== "ACTIVE") {
      return { ok: false, error: `Execution guard: target employee ${employee.employeeNo} is ${employee.employment} — assignment refused` };
    }
    if (!isAssignable(asset)) {
      return {
        ok: false,
        error: asset.returnedAt
          ? `Execution guard: ${asset.tag} is back but not yet triaged — assignment refused`
          : `Execution guard: ${asset.tag} reads ${asset.status}, not ${ASSIGNABLE_FROM[asset.cls]} — assignment refused`,
      };
    }
    const hold = await tx.reservation.findFirst({
      where: { assetId: asset.id, state: "ACTIVE" },
      include: { employee: { select: { id: true, employeeNo: true } } },
    });
    if (hold && hold.employeeId !== change.employeeId) {
      return { ok: false, error: `Execution guard: ${asset.tag} is reserved for ${hold.employee.employeeNo} — release the hold first` };
    }
    updates.assignee = { connect: { id: change.employeeId } };
    assigneeLabelTo = employee.employeeNo;
    settleReservationFor = change.employeeId;
  }

  if (change.kind === "return") {
    if (!asset.assigneeId) return { ok: false, error: `Execution guard: ${asset.tag} is not held by anyone — return refused` };
    const holder = await tx.employee.findUnique({ where: { id: asset.assigneeId }, select: { employeeNo: true } });
    assigneeLabelFrom = holder?.employeeNo ?? asset.assigneeId;
    updates.assignee = { disconnect: true };
  }

  if (change.kind === "change-status") {
    // A held asset can't be status-changed out from under its holder — that
    // would strand the assignment invisibly. Returns go through "return".
    const keepsHolder = (HOLDER_STATUSES[asset.cls] as readonly string[]).includes(change.status);
    if (asset.assigneeId && !keepsHolder) {
      return { ok: false, error: `Execution guard: ${asset.tag} is still assigned — request a lifecycle.return first, then change its status` };
    }
  }

  // Phase 16 (spec §4.1): only a loan carries a due date; every other status
  // write clears it. No guard here — a legacy queued assign without a date
  // still executes (worker messages are frozen).
  const nextDue = change.kind === "assign" && change.status === "TEMPORARY" ? change.loanDueAt : null;
  if ((nextDue?.getTime() ?? null) !== (asset.loanDueAt?.getTime() ?? null)) {
    updates.loanDueAt = nextDue;
    diff.loanDueAt = { from: asset.loanDueAt, to: nextDue };
  }

  // The repairs view's Down clock starts when a device ENTERS defective, and
  // is never cleared ("has a defectiveSince but no longer reads DEFECTIVE" is
  // the RETURNED OK stage).
  if (change.status === "DEFECTIVE" && asset.status !== "DEFECTIVE") {
    updates.defectiveSince = now;
    diff.defectiveSince = { from: asset.defectiveSince, to: now };
  }

  // Spec §4.1: a return landing an IT device on its default status is "back,
  // not checked"; any other status write is itself a triage decision.
  const landsForTriage =
    change.kind === "return"
    && change.status === DEFAULT_STATUS[asset.cls]
    && (DIRECT_LIFECYCLE_CLASSES as readonly AssetClass[]).includes(asset.cls);
  if (landsForTriage) {
    updates.returnedAt = now;
    diff.returnedAt = { from: asset.returnedAt, to: now };
  } else if (asset.returnedAt !== null) {
    updates.returnedAt = null;
    diff.returnedAt = { from: asset.returnedAt, to: null };
  }

  if (change.status !== asset.status) diff.status = { from: asset.status, to: change.status };
  if (change.kind === "assign" && change.employeeId !== asset.assigneeId) {
    diff.assignee = { from: assigneeLabelFrom ?? asset.assigneeId, to: assigneeLabelTo ?? change.employeeId };
  }
  if (change.kind === "return") diff.assignee = { from: assigneeLabelFrom, to: null };

  return { ok: true, prepared: { updates, diff, settleReservationFor } };
}

export async function commitLifecycle(
  tx: Prisma.TransactionClient,
  assetId: string,
  prepared: Prepared,
  now: Date = new Date(),
): Promise<void> {
  await tx.asset.update({ where: { id: assetId }, data: prepared.updates });
  if (prepared.settleReservationFor) {
    await tx.reservation.updateMany({
      where: { assetId, employeeId: prepared.settleReservationFor, state: "ACTIVE" },
      data: { state: "FULFILLED", resolvedAt: now },
    });
  }
}
