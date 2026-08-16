import type { ApprovalState, Priority } from "@prisma/client";

/**
 * Brief §6.2 verbatim: claim only from PENDING · release only from CLAIMED ·
 * approve only from CLAIMED by the owner · reject from PENDING/CLAIMED/
 * EXECUTION_FAILED (reason required, enforced by the action's schema) ·
 * escalate changes priority, not state · retry re-queues a failed execution ·
 * REJECTED and EXECUTED are terminal. Where the brief is silent on WHO:
 * release/reject on someone else's claim need owner-or-admin (recorded
 * scope decision #2). Server actions and the worker are the only callers.
 */
export type QueueAction = "claim" | "release" | "approve" | "reject" | "escalate" | "retry";

export interface TransitionCtx {
  isOwner: boolean;
  isAdmin: boolean;
}

export type TransitionResult =
  | { ok: true; next: ApprovalState | null } // null = state unchanged (escalate)
  | { ok: false; error: string };

const fail = (error: string): TransitionResult => ({ ok: false, error });

export function approvalTransition(
  state: ApprovalState,
  action: QueueAction,
  ctx: TransitionCtx,
): TransitionResult {
  switch (action) {
    case "claim":
      return state === "PENDING"
        ? { ok: true, next: "CLAIMED" }
        : fail(`Only PENDING items can be claimed (this one is ${state}).`);
    case "release":
      if (state !== "CLAIMED") return fail("Only a claimed item can be released.");
      if (!ctx.isOwner && !ctx.isAdmin) return fail("Only the owner (or an admin) can release this claim.");
      return { ok: true, next: "PENDING" };
    case "approve":
      if (state !== "CLAIMED") return fail("Claim it first — approval requires ownership.");
      if (!ctx.isOwner) return fail("You don't own this claim — you can't approve what you don't own.");
      return { ok: true, next: "APPROVED" };
    case "reject":
      if (state === "PENDING" || state === "EXECUTION_FAILED") return { ok: true, next: "REJECTED" };
      if (state === "CLAIMED") {
        return ctx.isOwner || ctx.isAdmin
          ? { ok: true, next: "REJECTED" }
          : fail("Someone else owns this claim — only they (or an admin) can reject it.");
      }
      return fail(`A ${state} item can't be rejected.`);
    case "escalate":
      return state === "PENDING" || state === "CLAIMED"
        ? { ok: true, next: null }
        : fail(`A ${state} item can't be escalated.`);
    case "retry":
      return state === "EXECUTION_FAILED"
        ? { ok: true, next: "APPROVED" }
        : fail("Only a failed execution can be retried.");
  }
}

export function escalatePriority(priority: Priority): Priority {
  return priority === "NORMAL" ? "HIGH" : "URGENT";
}
