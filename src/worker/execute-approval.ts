import type { Prisma } from "@prisma/client";
import { prisma } from "../server/db/client";
import { executionPlan } from "../lib/approval-execution";
import { APPROVAL_TYPE_LABEL } from "../lib/labels";

type Diff = Record<string, { from: unknown; to: unknown }>;

/**
 * Entry criterion #1: a 48h-old approval trusts NOTHING from request time.
 * Everything is re-read and re-validated inside this transaction; failures
 * store the error VERBATIM (the retry UI shows exactly this text) and the
 * approval becomes EXECUTION_FAILED. The Job itself still completes — job
 * failure is reserved for infrastructure errors.
 *
 * Every terminal write is a state-guarded updateMany: a second worker (or an
 * operator rejecting mid-flight) makes this execution a no-op, never a
 * double-apply. And there is NO silent third outcome — an unexpected throw
 * (tx timeout, driver error) is caught and terminalized as EXECUTION_FAILED
 * so an approval can never sit "queued for execution" forever.
 */
export async function executeApproval(approvalId: string): Promise<void> {
  try {
    await runExecution(approvalId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // If even this write fails, let it throw — the job layer backs off/retries.
    await prisma.approval.updateMany({
      where: { id: approvalId, state: "APPROVED" },
      data: { state: "EXECUTION_FAILED", workerError: `Execution error: ${message}` },
    });
  }
}

async function runExecution(approvalId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const approval = await tx.approval.findUnique({
      where: { id: approvalId },
      include: { asset: true },
    });
    if (!approval) return; // gone — nothing to do
    if (approval.state !== "APPROVED") return; // rejected/executed meanwhile — stale job

    const fail = async (error: string) => {
      const marked = await tx.approval.updateMany({
        where: { id: approval.id, state: "APPROVED" },
        data: { state: "EXECUTION_FAILED", workerError: error },
      });
      if (marked.count === 0) return; // raced by a concurrent transition — theirs wins
      await tx.auditEntry.create({
        data: {
          actorLabel: "worker",
          entityType: "approval",
          entityId: approval.id,
          action: "execution.failed",
          diff: { state: { from: "APPROVED", to: "EXECUTION_FAILED" } },
        },
      });
    };

    const plan = executionPlan(approval.type, approval.payload);
    if (!plan.ok) return fail(plan.error);
    if (!approval.assetId || !approval.asset) {
      return fail("Execution guard: approval has no asset attached — nothing to execute against");
    }
    const asset = approval.asset;

    // Per-type live re-validation.
    let assigneeLabelFrom: string | null = null;
    let assigneeLabelTo: string | null = null;
    if (approval.type === "lifecycle_assign") {
      const employee = plan.updates.assigneeId
        ? await tx.employee.findUnique({ where: { id: plan.updates.assigneeId } })
        : null;
      if (!employee) return fail("Execution guard: target employee no longer exists — assignment refused");
      if (employee.employment !== "ACTIVE") {
        return fail(`Execution guard: target employee ${employee.employeeNo} is ${employee.employment} — assignment refused`);
      }
      if (asset.status !== "SPARE") {
        return fail(`Execution guard: ${asset.tag} reads ${asset.status}, not SPARE — assignment refused`);
      }
      assigneeLabelTo = employee.employeeNo;
    }
    if (approval.type === "lifecycle_return") {
      const payload = approval.payload as { from?: { assigneeId?: unknown } } | null;
      const expected = typeof payload?.from?.assigneeId === "string" ? payload.from.assigneeId : null;
      if (asset.assigneeId !== expected) {
        return fail(`Execution guard: ${asset.tag} is no longer held by the expected employee — return refused`);
      }
      if (asset.assigneeId) {
        const holder = await tx.employee.findUnique({ where: { id: asset.assigneeId } });
        assigneeLabelFrom = holder?.employeeNo ?? asset.assigneeId;
      }
    }
    if (approval.type === "lifecycle_change_status") {
      const payload = approval.payload as { from?: { status?: unknown } } | null;
      const expectedFrom = typeof payload?.from?.status === "string" ? payload.from.status : null;
      if (expectedFrom && asset.status !== expectedFrom) {
        return fail(`Execution guard: ${asset.tag} reads ${asset.status}, payload expected ${expectedFrom} — refused`);
      }
      // A held asset can't be status-changed out from under its holder — that
      // would strand the assignment invisibly. Returns go through
      // lifecycle.return; only holder-compatible statuses may apply here.
      const keepsHolder = plan.updates.status === "DEPLOYED" || plan.updates.status === "TEMPORARY";
      if (asset.assigneeId && !keepsHolder) {
        return fail(`Execution guard: ${asset.tag} is still assigned — request a lifecycle.return first, then change its status`);
      }
    }

    // Claim the approval row FIRST (state-guarded): if a concurrent transition
    // got there, no asset write happens at all.
    const claimed = await tx.approval.updateMany({
      where: { id: approval.id, state: "APPROVED" },
      data: { state: "EXECUTED", resolvedAt: new Date(), workerError: null },
    });
    if (claimed.count === 0) return;

    // Apply + audit the ASSET diff in the same transaction (entry criterion #2).
    // The repairs view derives its Down clock and its stage chips from
    // defectiveSince, so an item ENTERING defective has to start that clock —
    // the offboarding wizard's Defective outcome arrives right here. It is
    // never cleared: "has a defectiveSince but no longer reads DEFECTIVE" is
    // precisely what the RETURNED OK stage means.
    const updates: Prisma.AssetUpdateInput = { ...plan.updates };
    if (plan.updates.status === "DEFECTIVE" && asset.status !== "DEFECTIVE") {
      updates.defectiveSince = new Date();
    }
    await tx.asset.update({ where: { id: asset.id }, data: updates });
    const diff: Diff = {};
    if (plan.updates.status !== asset.status) diff.status = { from: asset.status, to: plan.updates.status };
    if (plan.updates.assigneeId !== undefined && plan.updates.assigneeId !== asset.assigneeId) {
      diff.assignee = {
        from: assigneeLabelFrom ?? asset.assigneeId,
        to: plan.updates.assigneeId ? (assigneeLabelTo ?? plan.updates.assigneeId) : null,
      };
    }
    await tx.auditEntry.create({
      data: {
        actorLabel: "worker",
        entityType: "asset",
        entityId: asset.id,
        action: `${APPROVAL_TYPE_LABEL[approval.type]} executed`,
        diff: Object.keys(diff).length ? (diff as Prisma.InputJsonObject) : undefined,
      },
    });

    // Deploying a reserved asset settles the hold (recorded decision #5).
    if (approval.type === "lifecycle_assign" && plan.updates.assigneeId) {
      await tx.reservation.updateMany({
        where: { assetId: asset.id, employeeId: plan.updates.assigneeId, state: "ACTIVE" },
        data: { state: "FULFILLED", resolvedAt: new Date() },
      });
    }

    await tx.auditEntry.create({
      data: {
        actorLabel: "worker",
        entityType: "approval",
        entityId: approval.id,
        action: "executed",
        diff: { state: { from: "APPROVED", to: "EXECUTED" } },
      },
    });
  });
}
