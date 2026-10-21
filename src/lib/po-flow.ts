import type { AssetClass, Role } from "@prisma/client";
import type { Team } from "./intake-rules";

/**
 * Purchase orders (spec: three-team intake). Pure rules for where a PO sits and who may register its lines.
 * PoState mirrors the Prisma enum added in Task 2; it is a string union here so src/lib stays free of
 * runtime @prisma/client imports.
 */
export type PoState = "WITH_IT" | "SENT_BACK" | "READY" | "CANCELLED";

export const PO_STATE_LABEL: Record<PoState, string> = {
  WITH_IT: "With IT",
  SENT_BACK: "Sent back to Purchasing",
  READY: "Ready to register",
  CANCELLED: "Cancelled",
};

/** Who may create and edit a PO (Purchasing writes it; admin is every party). Replaces the old DRAFT_ROLES. */
export const PO_WRITE_ROLES: Role[] = ["purchasing_staff", "admin"];

/** Saving a PO: any IT line, or a legacy line with no class, needs IT's look first. */
export function stateAfterSave(lines: { cls: AssetClass | null }[]): "WITH_IT" | "READY" {
  return lines.some((l) => l.cls === null || l.cls === "IT") ? "WITH_IT" : "READY";
}

/** Purchasing replies to a send-back: IT's goes back to IT, Finance's straight to registering. */
export function stateAfterResubmit(sentBackBy: Team): "WITH_IT" | "READY" {
  return sentBackBy === "IT" ? "WITH_IT" : "READY";
}

export function lineProgress(l: { qty: number; registered: number; closedShort: number }): { remaining: number; label: string } {
  const remaining = Math.max(0, l.qty - l.registered - l.closedShort);
  const short = l.closedShort > 0 ? ` · ${l.closedShort} closed short` : "";
  return { remaining, label: `${l.registered} of ${l.qty} registered${short}` };
}

export function poProgress(
  lines: { qty: number; registered: number; closedShort: number }[],
  approvedAll: boolean,
): "Partly registered" | "Registered" | "Approved" | null {
  const anyRegistered = lines.some((l) => l.registered > 0);
  if (!anyRegistered) return null;
  const done = lines.every((l) => lineProgress(l).remaining === 0);
  if (!done) return "Partly registered";
  return approvedAll ? "Approved" : "Registered";
}

export function canRegisterLine(role: Role, lineCls: AssetClass, state: PoState): { ok: true } | { ok: false; why: string } {
  if (state === "SENT_BACK") return { ok: false, why: "It's been sent back to Purchasing" };
  if (state === "CANCELLED") return { ok: false, why: "This purchase order is cancelled" };
  if (role === "admin") return { ok: true };
  if (lineCls === "IT") {
    return role === "it_staff" ? { ok: true } : { ok: false, why: "IT registers IT gear" };
  }
  return role === "purchasing_staff" ? { ok: true } : { ok: false, why: "Purchasing registers these items" };
}

/** The migration's mapping from the old PurchaseRequest states. */
export function legacyPoState(old: "DRAFT" | "SUBMITTED" | "IT_REVIEWED" | "COMPLETED" | "CANCELLED"): PoState {
  switch (old) {
    case "DRAFT": return "SENT_BACK";
    case "SUBMITTED":
    case "IT_REVIEWED": return "WITH_IT";
    case "COMPLETED": return "READY";
    case "CANCELLED": return "CANCELLED";
  }
}

/** `PO-0188`. Four digits minimum; a bigger number keeps all its digits. */
export function poRefNo(n: number): string {
  return `PO-${String(n).padStart(4, "0")}`;
}

/**
 * What a person typed into a search box, with a leading old printed `PR-` read as `PO-` — a number on paper from
 * before migration 38 (PR-0188) still finds PO-0188. Only a leading `PR-` is touched, so "printer" and "x PR-1" stay.
 */
export function poRefSearch(q: string): string {
  const t = q.trim();
  return /^pr-/i.test(t) ? `PO-${t.slice(3)}` : t;
}
