import type { ApprovalState } from "@prisma/client";

/** The detail header's and the queue row menu's verbs (spec §4.1, plan P-2). */
export type ApprovalVerb = "approve-now" | "approve" | "claim" | "release" | "escalate" | "retry";

export const VERB_LABEL: Record<ApprovalVerb, string> = {
  "approve-now": "Approve", approve: "Approve", claim: "Claim", release: "Release", escalate: "Escalate", retry: "Retry",
};

export interface HeaderCtx { state: ApprovalState; canAct: boolean; mine: boolean; isAdmin: boolean }

const NONE = { primary: null, reject: false, more: [] as ApprovalVerb[] };

/**
 * One primary, a visible Reject…, the rest in More — by state. Never a verb
 * approvalTransition would refuse (the test proves it row by row). No admin
 * override on someone else's claim: the code has none and this phase adds none (P-2).
 */
export function approvalHeader(c: HeaderCtx): { primary: ApprovalVerb | null; reject: boolean; more: ApprovalVerb[] } {
  if (!c.canAct) return NONE;
  switch (c.state) {
    case "PENDING": return { primary: "approve-now", reject: true, more: ["claim", "escalate"] };
    case "CLAIMED":
      if (c.mine) return { primary: "approve", reject: true, more: ["release", "escalate"] };
      if (c.isAdmin) return { primary: null, reject: true, more: ["release", "escalate"] };
      return NONE;
    case "EXECUTION_FAILED": return { primary: "retry", reject: true, more: [] };
    default: return NONE;
  }
}
