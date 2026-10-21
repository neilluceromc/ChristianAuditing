import type { AssetClass, Role } from "@prisma/client";
import { canEditField, poMoneyStage } from "./intake-rules";
import { PO_WRITE_ROLES, canRegisterLine, lineProgress, type PoState } from "./po-flow";

/**
 * Which buttons a person sees on a purchase order. Pure, and it mirrors the rules the server enforces
 * (po-actions.ts re-checks every one): the buttons only keep dead ends off the screen.
 */
export interface PoControlsInput {
  role: Role;
  state: PoState;
  /** Assets registered from the PO, and how many of those Finance has approved. */
  registeredCount: number;
  approvedCount: number;
  /** `cls` is the class of the line's category; null on a legacy line (its class is picked at Register). */
  lines: Array<{ id: string; cls: AssetClass | null; qty: number; registered: number; closedShort: number }>;
}

export interface PoControls {
  /** Register: some line has units left and this role may register it. */
  register: boolean;
  /** Send back to Purchasing (IT with the PO; Finance once it is registered and nothing is approved). */
  sendBack: boolean;
  /** Fix money details: the cross-team fix that takes a reason. */
  fix: boolean;
  /** Edit: Purchasing's own form. */
  edit: boolean;
  cancel: boolean;
  /** Close a line short (per line, and only where units are left). */
  closeShort: boolean;
}

export function poControls(p: PoControlsInput): PoControls {
  const live = p.state !== "CANCELLED";
  const stage = poMoneyStage({ state: p.state, registeredCount: p.registeredCount, approvedCount: p.approvedCount });
  const writer = PO_WRITE_ROLES.includes(p.role);

  const register = p.lines.some((l) => {
    if (lineProgress(l).remaining === 0) return false;
    // A legacy line has no class yet: whoever could register either kind of line may open Register.
    return l.cls
      ? canRegisterLine(p.role, l.cls, p.state).ok
      : canRegisterLine(p.role, "IT", p.state).ok || canRegisterLine(p.role, "PURCHASING", p.state).ok;
  });

  let sendBack = false;
  if (live && p.state !== "SENT_BACK" && p.approvedCount === 0) {
    if (p.role === "it_staff") sendBack = stage === "with-it";
    else if (p.role === "finance_staff") sendBack = stage === "with-finance";
    else if (p.role === "admin") sendBack = stage === "with-it" || stage === "with-finance";
  }

  const verdict = canEditField(p.role, "invoiceRef", "PURCHASING", stage);
  return {
    register,
    sendBack,
    fix: live && verdict.ok && verdict.reasonRequired,
    edit: live && writer && verdict.ok && (stage === "with-purchasing" || stage === "with-it"),
    cancel: live && writer && p.registeredCount === 0,
    closeShort: live && writer,
  };
}
