import type { AssetClass, AssetStatus, Role } from "@prisma/client";
import { CLASS_LABEL, canEditAsset, canManageClass, isAssignable, isAwaitingItCheck, isDirectLifecycle, statusTargets } from "./asset-class";

/** Phase 30 (spec §4.1, plan P-4): everything a record header or a list row can offer. */
export type RecordAction =
  | "triage" | "mark-checked" | "mark-corrected" | "confirm-details" | "send-back"
  | "return" | "assign" | "replace" | "reserve" | "change-status" | "set-loan-date" | "print-label";

export interface RecordState {
  cls: AssetClass;
  status: AssetStatus;
  hasHolder: boolean;
  returnedAt: Date | null;
  itVerifiedAt: Date | null;
  financeConfirmedAt: Date | null;
  financeReturnedAt: Date | null;
  /** an open (PENDING / CLAIMED / APPROVED) approval on this asset */
  pending: boolean;
  /** an ACTIVE reservation on this asset */
  held: boolean;
}

const PRIMARY_ORDER: readonly RecordAction[] = ["triage", "mark-checked", "mark-corrected", "confirm-details", "return", "assign"];
const FULL_ORDER: readonly RecordAction[] = [
  "triage", "mark-checked", "mark-corrected", "confirm-details", "send-back",
  "return", "assign", "replace", "reserve", "change-status", "set-loan-date", "print-label",
];

function applicable(a: RecordState, role: Role): Record<RecordAction, boolean> {
  const canMutate = canManageClass(role, a.cls);
  const direct = isDirectLifecycle(role, a.cls);
  const awaitingIt = isAwaitingItCheck(a);
  const assignable = isAssignable(a);
  const finance = (role === "admin" || role === "finance_staff") && a.financeConfirmedAt === null && !awaitingIt;
  const live = !a.pending; // plan P-4: only lifecycle actions wait for an open approval
  return {
    triage: direct && live && a.returnedAt !== null,
    "mark-checked": awaitingIt && canManageClass(role, "IT"),
    "mark-corrected": canMutate && a.financeReturnedAt !== null,
    "confirm-details": finance,
    "send-back": finance,
    return: canMutate && live && a.hasHolder,
    assign: canMutate && live && !a.hasHolder && assignable,
    replace: direct && live && a.hasHolder,
    reserve: direct && live && !a.hasHolder && assignable && !a.held,
    "change-status": canMutate && live && statusTargets(a).length > 0,
    "set-loan-date": direct && live && a.status === "TEMPORARY",
    "print-label": canMutate,
  };
}

/** Phase 30 (spec §4.1): the one primary, the rest in the fixed More order, and whether Edit shows. */
export function recordActions(a: RecordState, role: Role): { primary: RecordAction | null; more: RecordAction[]; edit: boolean } {
  const can = applicable(a, role);
  const primary = PRIMARY_ORDER.find((k) => can[k]) ?? null;
  return { primary, more: FULL_ORDER.filter((k) => can[k] && k !== primary), edit: canEditAsset(role, a) };
}

export function recordPrimary(a: RecordState, role: Role): RecordAction | null {
  return recordActions(a, role).primary;
}

/** Phase 30 (spec §8, plan P-5): header buttons carry no ellipsis; menu items do; the approval path keeps today's words. */
export function actionLabel(action: RecordAction, ctx: { cls: AssetClass; direct: boolean; inMenu: boolean }): string {
  const dots = ctx.inMenu ? "…" : "";
  switch (action) {
    case "triage": return `Triage${dots}`;
    case "mark-checked": return `Mark checked${dots}`;
    case "mark-corrected": return `Mark corrected${dots}`;
    case "confirm-details": return `Confirm details${dots}`;
    case "send-back": return `Send back to ${CLASS_LABEL[ctx.cls]}…`;
    case "return": return `Return${dots}`;
    case "assign": return `${ctx.direct ? "Assign" : "Assign holder"}${dots}`;
    case "replace": return "Replace…";
    case "reserve": return "Reserve…";
    case "change-status": return ctx.direct ? "Change status…" : "Request status change…";
    case "set-loan-date": return "Set loan date…";
    case "print-label": return "Print label";
  }
}
