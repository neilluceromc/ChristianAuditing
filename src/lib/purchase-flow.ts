import type { NoteKind, PurchaseRequestState, Role } from "@prisma/client";

/**
 * Brief §6.1 verbatim: submit only from DRAFT · it-review only from SUBMITTED ·
 * it-reject SUBMITTED → DRAFT (reason appended, never overwritten) ·
 * request-info IT_REVIEWED → SUBMITTED (finance's bounce-back — nothing is
 * cleared) · cancel from any non-terminal state, reason required · complete
 * only from IT_REVIEWED. COMPLETED and CANCELLED are terminal.
 *
 * Pure. Server actions are the only callers, and they write through a
 * state-guarded updateMany so a concurrent transition conflicts instead of
 * silently winning. The UI asks canAct() so an affordance never renders for a
 * transition the server would refuse.
 */
export type PurchaseAction = "submit" | "it-review" | "it-reject" | "request-info" | "cancel" | "complete";

export type PurchaseTransitionResult =
  | { ok: true; next: PurchaseRequestState }
  | { ok: false; error: string };

/** Per-operation authorization (HANDOVER §6.5). admin is every party; viewer is none. */
export const PURCHASE_ACTION_ROLES: Record<PurchaseAction, Role[]> = {
  submit: ["purchasing_staff", "admin"],
  "it-review": ["it_staff", "admin"],
  "it-reject": ["it_staff", "admin"],
  "request-info": ["finance_staff", "admin"],
  cancel: ["purchasing_staff", "admin"],
  complete: ["finance_staff", "admin"],
};

/** Every transition appends a NoteEntry of this kind — the thread IS the history. */
export const PURCHASE_NOTE_KIND: Record<PurchaseAction, NoteKind> = {
  submit: "SUBMIT",
  "it-review": "IT_REVIEW",
  "it-reject": "IT_REJECT",
  "request-info": "REQUEST_INFO",
  cancel: "CANCEL",
  complete: "COMPLETE",
};

/** Bounce-backs and withdrawals must say why; the rest may. */
export const REASON_REQUIRED: readonly PurchaseAction[] = ["it-reject", "request-info", "cancel"];

/** Fallback thread text when an optional-reason transition carries none. */
export const CANONICAL_NOTE: Record<PurchaseAction, string> = {
  submit: "Submitted for IT review.",
  "it-review": "Specs reviewed — passed to finance.",
  "it-reject": "",
  "request-info": "",
  cancel: "",
  complete: "Approved and completed.",
};

/**
 * These land in a conflict banner, so they are written out rather than
 * derived: "complete" + "ed" is "completeed", and "request-info" has no
 * suffix form at all.
 */
const VERB: Record<PurchaseAction, { present: string; past: string }> = {
  submit: { present: "submit", past: "submitted" },
  "it-review": { present: "mark IT-reviewed", past: "marked IT-reviewed" },
  "it-reject": { present: "send back", past: "sent back" },
  "request-info": { present: "send back for more information", past: "sent back for more information" },
  cancel: { present: "cancel", past: "cancelled" },
  complete: { present: "complete", past: "completed" },
};

const RULES: Record<PurchaseAction, { from: PurchaseRequestState[]; to: PurchaseRequestState; party: string }> = {
  submit: { from: ["DRAFT"], to: "SUBMITTED", party: "Purchasing" },
  "it-review": { from: ["SUBMITTED"], to: "IT_REVIEWED", party: "IT" },
  "it-reject": { from: ["SUBMITTED"], to: "DRAFT", party: "IT" },
  "request-info": { from: ["IT_REVIEWED"], to: "SUBMITTED", party: "Finance" },
  cancel: { from: ["DRAFT", "SUBMITTED", "IT_REVIEWED"], to: "CANCELLED", party: "Purchasing" },
  complete: { from: ["IT_REVIEWED"], to: "COMPLETED", party: "Finance" },
};

export function purchaseTransition(
  state: PurchaseRequestState,
  action: PurchaseAction,
  role: Role,
): PurchaseTransitionResult {
  const rule = RULES[action];
  if (!PURCHASE_ACTION_ROLES[action].includes(role)) {
    return { ok: false, error: `Only ${rule.party} (or an admin) can ${VERB[action].present} a request.` };
  }
  if (!rule.from.includes(state)) {
    return {
      ok: false,
      error: `A ${state} request can't be ${VERB[action].past} — it must be ${rule.from.join(" or ")}.`,
    };
  }
  return { ok: true, next: rule.to };
}

/** Render-layer twin: the button exists only when the transition would pass. */
export function canAct(state: PurchaseRequestState, action: PurchaseAction, role: Role): boolean {
  return purchaseTransition(state, action, role).ok;
}

/**
 * Which unit editor a person gets: the request's state × their role (README
 * 1j — both editors live inline on the same detail page). Pure, and it lives
 * here rather than beside the action because a `"use server"` module may only
 * export async functions.
 */
export function unitEditorMode(state: PurchaseRequestState, role: Role): "it" | "finance" | null {
  if (state === "SUBMITTED" && (role === "it_staff" || role === "admin")) return "it";
  if (state === "IT_REVIEWED" && (role === "finance_staff" || role === "admin")) return "finance";
  return null;
}
