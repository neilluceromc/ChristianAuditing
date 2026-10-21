import type { AssetClass, Role } from "@prisma/client";

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

/**
 * Where a live PO sits, from what is left on its lines — the one rule every action that changes the remaining IT
 * work uses (register, a resubmit from either sender, close short, an edit). A cancelled or sent-back PO stays where
 * it is. Otherwise it is WITH_IT while some IT line, or an old line with no class, still has units to register AND no
 * IT unit has been registered from it yet (IT registering is IT's check, spec §4 way 1); in every other case READY.
 *
 * `remaining` is lineProgress's (quantity less registered and closed short). Callers that only ever move a PO out of
 * IT's queue (register, close short) apply it from WITH_IT only, so an old completed order whose lines never carried
 * the asset link isn't pulled back into IT's queue.
 */
export function poStateFor(p: {
  state: PoState;
  lines: Array<{ cls: AssetClass | null; remaining: number }>;
  itRegistered: boolean;
}): PoState {
  if (p.state === "CANCELLED" || p.state === "SENT_BACK") return p.state;
  const itLeft = p.lines.some((l) => l.cls !== "PURCHASING" && l.remaining > 0);
  return itLeft && !p.itRegistered ? "WITH_IT" : "READY";
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

/**
 * What a PO's progress pill and stepper read. Normally poProgress over the lines' registered counts. An old request
 * (migration 38) is different: its units never carried the asset link, so every line reads 0 registered even though
 * its assets are linked to the PO itself. Spec §3 maps COMPLETED → "Registered, or Approved if all its linked assets
 * are approved", so with no line link but linked assets (or a completedAt) the progress comes from the asset counts.
 * Register stays available on such a PO — that is canRegisterLine's and the controls' business, not this pill's.
 *
 * Registering on a migrated PO today links the new asset to its line, so a line link no longer proves the PO is
 * new-style. The asset counts decide whenever the old flow completed it, or some asset is linked to the PO but to no
 * line (an old one the lines can't count): one new laptop on an old completed order must not turn it "Partly registered".
 */
export function derivePoProgress(
  lines: { qty: number; registered: number; closedShort: number }[],
  p: { assetCount: number; approvedCount: number; completed: boolean },
): ReturnType<typeof poProgress> {
  const lineLinked = lines.reduce((s, l) => s + l.registered, 0);
  if (p.completed || p.assetCount > lineLinked) {
    return p.assetCount > 0 && p.approvedCount === p.assetCount ? "Approved" : "Registered";
  }
  return poProgress(lines, p.assetCount > 0 && p.approvedCount === p.assetCount);
}
