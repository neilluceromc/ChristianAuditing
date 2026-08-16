"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";
import { approvalTransition, escalatePriority, type QueueAction } from "@/lib/approval-flow";

const idSchema = z.object({ id: z.string().min(1) });
const rejectSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500),
});

interface Acted {
  refNo: string;
  state: string;
}

/**
 * Shared skeleton: read → pure transition check → state-guarded write.
 * `guardWhere` narrows the updateMany so a concurrent transition makes this
 * one a no-op (count 0 → conflict) instead of a lost update.
 */
async function transition(
  action: QueueAction,
  id: string,
  build: (a: { id: string; refNo: string; state: string; priority: string; claimedById: string | null }, userId: string) => {
    guardWhere: Prisma.ApprovalWhereInput;
    data: Prisma.ApprovalUpdateManyMutationInput & { claimedById?: string | null };
    auditAction: string;
    diff: Record<string, { from: unknown; to: unknown }>;
    enqueue?: boolean;
  },
): Promise<ActionResult<Acted>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  let acted: Acted | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const approval = await tx.approval.findUnique({
      where: { id },
      select: { id: true, refNo: true, state: true, priority: true, claimedById: true },
    });
    if (!approval) return conflict("That approval no longer exists.");
    const ctx = { isOwner: approval.claimedById === user.id, isAdmin: user.role === "admin" };
    const t = approvalTransition(approval.state, action, ctx);
    if (!t.ok) return conflict(t.error);

    const { guardWhere, data, auditAction, diff, enqueue } = build(approval, user.id);
    const updated = await tx.approval.updateMany({ where: { id, ...guardWhere }, data });
    if (updated.count === 0) return conflict("Someone else changed this item first — refresh and retry.");

    if (enqueue) {
      await tx.job.create({ data: { type: "EXECUTE_APPROVAL", payload: { approvalId: id } } });
    }
    await writeAudit(tx, {
      actorId: user.id,
      actorLabel: user.name,
      entityType: "approval",
      entityId: id,
      action: auditAction,
      diff,
    });
    acted = { refNo: approval.refNo, state: String(data.state ?? approval.state) };
    return null;
  });
  if (failure) return failure;

  revalidatePath("/approvals");
  revalidatePath(`/approvals/${id}`);
  return ok(acted!);
}

export async function claimApproval(input: unknown): Promise<ActionResult<Acted>> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  return transition("claim", parsed.data.id, (a, userId) => ({
    guardWhere: { state: "PENDING" },
    data: { state: "CLAIMED", claimedById: userId, claimedAt: new Date() },
    auditAction: "claim",
    diff: { state: { from: a.state, to: "CLAIMED" } },
  }));
}

export async function releaseApproval(input: unknown): Promise<ActionResult<Acted>> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  return transition("release", parsed.data.id, (a) => ({
    guardWhere: { state: "CLAIMED", claimedById: a.claimedById },
    data: { state: "PENDING", claimedById: null, claimedAt: null },
    auditAction: "release",
    diff: { state: { from: a.state, to: "PENDING" } },
  }));
}

export async function approveApproval(input: unknown): Promise<ActionResult<Acted>> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  return transition("approve", parsed.data.id, (a, userId) => ({
    guardWhere: { state: "CLAIMED", claimedById: userId },
    data: { state: "APPROVED" },
    auditAction: "approve",
    diff: { state: { from: a.state, to: "APPROVED" } },
    enqueue: true,
  }));
}

export async function rejectApproval(input: unknown): Promise<ActionResult<Acted>> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id, reason } = parsed.data;
  return transition("reject", id, (a) => ({
    guardWhere: { state: a.state as never },
    data: { state: "REJECTED", resolvedAt: new Date(), resolutionReason: reason },
    auditAction: "reject",
    diff: { state: { from: a.state, to: "REJECTED" }, reason: { from: null, to: reason } },
  }));
}

export async function escalateApproval(input: unknown): Promise<ActionResult<Acted>> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  return transition("escalate", parsed.data.id, (a) => {
    const next = escalatePriority(a.priority as never);
    return {
      guardWhere: { state: a.state as never },
      data: { priority: next },
      auditAction: "escalate",
      diff: { priority: { from: a.priority, to: next } },
    };
  });
}

export async function retryApproval(input: unknown): Promise<ActionResult<Acted>> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  return transition("retry", parsed.data.id, (a) => ({
    guardWhere: { state: "EXECUTION_FAILED" },
    data: { state: "APPROVED", workerError: null },
    auditAction: "retry",
    diff: { state: { from: a.state, to: "APPROVED" } },
    enqueue: true,
  }));
}
