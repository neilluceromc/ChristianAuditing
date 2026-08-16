import type { ApprovalType, AssetStatus } from "@prisma/client";
import { APPROVAL_TYPE_LABEL } from "./labels";

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
      if (!to || to.status !== "SPARE") {
        return { ok: false, error: `Malformed lifecycle.return payload: expected to.status SPARE, got ${JSON.stringify(payload)}` };
      }
      return { ok: true, updates: { assigneeId: null, status: "SPARE" } };
    }
    case "lifecycle_change_status": {
      const to = obj(p.to);
      const status = to ? str(to.status) : null;
      if (!status) {
        return { ok: false, error: `Malformed lifecycle.change-status payload: expected to.status, got ${JSON.stringify(payload)}` };
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
      return { line1, line2: withReason(`${who}→ SPARE`) };
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
