import type { Prisma } from "@prisma/client";
import { prisma } from "../server/db/client";
import { executionPlan } from "../lib/approval-execution";
import { APPROVAL_TYPE_LABEL } from "../lib/labels";
import { emitWebhook } from "../server/webhooks/emit";
import { commitLifecycle, prepareLifecycle, type LifecycleChange } from "../server/modules/lifecycle/apply";

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

    // The asset first: the plan needs its class, and an approval with no
    // asset has nothing to be planned against anyway.
    if (!approval.assetId || !approval.asset) {
      return fail("Execution guard: approval has no asset attached — nothing to execute against");
    }
    const asset = approval.asset;
    const plan = executionPlan(approval.type, approval.payload, asset.cls);
    if (!plan.ok) return fail(plan.error);

    // The payload-shape checks stay here (they are about the approval, not the
    // asset); the live asset guards and the write live in prepare/commitLifecycle,
    // shared with Phase 15's direct actions so the two paths cannot drift.
    if (approval.type === "lifecycle_return") {
      const payload = approval.payload as { from?: { assigneeId?: unknown } } | null;
      const expected = typeof payload?.from?.assigneeId === "string" ? payload.from.assigneeId : null;
      if (asset.assigneeId !== expected) {
        return fail(`Execution guard: ${asset.tag} is no longer held by the expected employee — return refused`);
      }
    }
    if (approval.type === "lifecycle_change_status") {
      const payload = approval.payload as { from?: { status?: unknown } } | null;
      const expectedFrom = typeof payload?.from?.status === "string" ? payload.from.status : null;
      if (expectedFrom && asset.status !== expectedFrom) {
        return fail(`Execution guard: ${asset.tag} reads ${asset.status}, payload expected ${expectedFrom} — refused`);
      }
    }
    const rawDue = (approval.payload as { to?: { loanDueAt?: unknown } } | null)?.to?.loanDueAt;
    const loanDueAt = typeof rawDue === "string" && !Number.isNaN(Date.parse(rawDue)) ? new Date(rawDue) : null;
    const change: LifecycleChange =
      approval.type === "lifecycle_assign"
        ? { kind: "assign", employeeId: plan.updates.assigneeId as string, status: plan.updates.status, loanDueAt }
        : approval.type === "lifecycle_return"
          ? { kind: "return", status: plan.updates.status }
          : { kind: "change-status", status: plan.updates.status };
    const prepared = await prepareLifecycle(tx, asset, change);
    if (!prepared.ok) return fail(prepared.error);

    // Claim the approval row FIRST (state-guarded): if a concurrent transition
    // got there, no asset write happens at all.
    const claimed = await tx.approval.updateMany({
      where: { id: approval.id, state: "APPROVED" },
      data: { state: "EXECUTED", resolvedAt: new Date(), workerError: null },
    });
    if (claimed.count === 0) return;

    await commitLifecycle(tx, asset.id, prepared.prepared);
    const diff = prepared.prepared.diff;
    await tx.auditEntry.create({
      data: {
        actorLabel: "worker",
        entityType: "asset",
        entityId: asset.id,
        action: `${APPROVAL_TYPE_LABEL[approval.type]} executed`,
        diff: Object.keys(diff).length ? (diff as unknown as Prisma.InputJsonObject) : undefined,
      },
    });

    await tx.auditEntry.create({
      data: {
        actorLabel: "worker",
        entityType: "approval",
        entityId: approval.id,
        action: "executed",
        diff: { state: { from: "APPROVED", to: "EXECUTED" } },
      },
    });

    // Last thing in the transaction, and only reachable on genuine success:
    // every guard above leaves through `return fail(...)`, so nothing that
    // ended as EXECUTION_FAILED gets here. Scope decision #14 — ids and
    // refNos, never whole rows. `asset` is non-null by the guard at the top
    // of this function, so assetTag is the real tag rather than a hedge.
    await emitWebhook(tx, "approval.executed", {
      approvalId: approval.id,
      refNo: approval.refNo,
      type: approval.type,
      assetId: asset.id,
      assetTag: asset.tag,
    });
  });
}
