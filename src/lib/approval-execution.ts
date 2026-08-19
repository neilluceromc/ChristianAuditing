import type { ApprovalType, AssetStatus } from "@prisma/client";
import { APPROVAL_TYPE_LABEL } from "./labels";
import { ASSET_STATUSES } from "./inventory-list";

/**
 * Pure payload → planned asset update. The worker re-validates LIVE state
 * (employment, current holder, current status) inside its transaction —
 * this module only decides what a well-formed payload MEANS. Failures
 * become EXECUTION_FAILED with the error stored verbatim.
 */
export type ExecutionPlan =
  | { ok: true; updates: { assigneeId?: string | null; status: AssetStatus } }
  | { ok: false; error: string };

type Payload = Record<string, unknown>;

const obj = (v: unknown): Payload | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Payload) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** The four outcomes an item can come back in (README 3e). */
export const RETURN_STATUSES = ["SPARE", "DEFECTIVE", "BUYOUT", "MISSING"] as const satisfies readonly AssetStatus[];

export function executionPlan(type: ApprovalType, payload: unknown): ExecutionPlan {
  const p = obj(payload) ?? {};
  switch (type) {
    case "lifecycle_assign": {
      const to = obj(p.to);
      const assigneeId = to ? str(to.assigneeId) : null;
      const status = to ? str(to.status) : null;
      if (!assigneeId || !status) {
        return { ok: false, error: `Malformed lifecycle.assign payload: expected to.assigneeId and to.status, got ${JSON.stringify(payload)}` };
      }
      if (status !== "DEPLOYED" && status !== "TEMPORARY") {
        return { ok: false, error: `lifecycle.assign target status must be DEPLOYED or TEMPORARY, got ${status}` };
      }
      return { ok: true, updates: { assigneeId, status } };
    }
    case "lifecycle_return": {
      const to = obj(p.to);
      const status = to ? str(to.status) : null;
      // A return is the item coming back from a person; WHAT STATE it comes
      // back in is exactly what the offboarding wizard asks (README 3e:
      // Returned / Defective / Buyout / Missing, with Missing first-class).
      // The holder is cleared either way — the person has left, and who it
      // came from survives in from.assigneeId and in the audit diff.
      if (!status) {
        return { ok: false, error: `Malformed lifecycle.return payload: expected to.status, got ${JSON.stringify(payload)}` };
      }
      // A disallowed target is not a malformed payload, and the operator reading
      // this in the retry UI needs the offending value, not a JSON blob.
      if (!(RETURN_STATUSES as readonly string[]).includes(status)) {
        return {
          ok: false,
          error: `lifecycle.return target status must be one of ${RETURN_STATUSES.join(", ")}, got ${status}`,
        };
      }
      return { ok: true, updates: { assigneeId: null, status: status as AssetStatus } };
    }
    case "lifecycle_change_status": {
      const to = obj(p.to);
      const status = to ? str(to.status) : null;
      if (!status) {
        return { ok: false, error: `Malformed lifecycle.change-status payload: expected to.status, got ${JSON.stringify(payload)}` };
      }
      if (!(ASSET_STATUSES as readonly string[]).includes(status)) {
        // A blind cast here once let an out-of-enum value throw INSIDE the
        // execution transaction — stranding the approval in APPROVED.
        return { ok: false, error: `lifecycle.change-status target ${status} is not a valid asset status` };
      }
      return { ok: true, updates: { status: status as AssetStatus } };
    }
    default:
      return { ok: false, error: `Execution guard: ${APPROVAL_TYPE_LABEL[type]} has no executor yet (arrives with its producing flow).` };
  }
}

/** The queue's two-line change cell: line1 = type · tag, line2 = the movement — reason. */
export function summarizeApproval(
  type: ApprovalType,
  payload: unknown,
  names: { assetTag?: string | null; employeeName?: string | null },
): { line1: string; line2: string } {
  const p = obj(payload) ?? {};
  const from = obj(p.from);
  const to = obj(p.to);
  const reason = str(p.reason);
  const line1 = names.assetTag ? `${APPROVAL_TYPE_LABEL[type]} · ${names.assetTag}` : APPROVAL_TYPE_LABEL[type];
  const withReason = (core: string) => (reason ? `${core} — ${reason}` : core);

  switch (type) {
    case "lifecycle_assign": {
      const status = to ? str(to.status) ?? "DEPLOYED" : "DEPLOYED";
      const who = names.employeeName ? ` · ${names.employeeName}` : "";
      return { line1, line2: withReason(`→ ${status}${who}`) };
    }
    case "lifecycle_return": {
      const who = names.employeeName ? `${names.employeeName} ` : "";
      // Four outcomes now, so a hard-coded "→ SPARE" would make the queue's
      // change cell lie about three of them. And a return with no target at all
      // (seeded APR-2040) gets "?", not an invented SPARE: the detail page shows
      // this line beside a system check that says the target is missing, and the
      // two panes must not contradict each other.
      const status = (to ? str(to.status) : null) ?? "?";
      return { line1, line2: withReason(`${who}→ ${status}`) };
    }
    case "lifecycle_change_status": {
      const f = from ? str(from.status) : null;
      const t = to ? str(to.status) : null;
      return { line1, line2: withReason(f && t ? `${f} → ${t}` : t ? `→ ${t}` : "status change") };
    }
    default:
      return { line1, line2: withReason(str(p.note) ?? "") };
  }
}
